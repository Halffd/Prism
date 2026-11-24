//! Media capabilities: image generation, inpainting, video generation
//! and 3D model generation.
//!
//! These are the non-chat capabilities. They share the core's rules: the
//! core never opens sockets itself (hosts inject a `Transport`), request
//! bodies are built by pure functions so that every target sends the same
//! bytes, and a failure is a value, not a panic.
//!
//! Every provider here is reached over HTTP and returns either a media
//! URL or a task that has to be polled. Remote providers take a JSON
//! body; the local SD backends additionally take API-format workflow
//! graphs and multipart image uploads (built here as bytes). The
//! polling is left to the host: the core answers one step at a time so
//! that a host can drive it from a UI thread without blocking.

use crate::transport::{HttpRequest, Transport};
use serde::{Deserialize, Serialize};

/// Which media capability a request belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    /// Text to image.
    Image,
    /// Image editing with a mask.
    Inpaint,
    /// Text to video.
    Video,
    /// Text to 3D model.
    Model,
}

/// A request for any media capability.
///
/// One shape covers all four capabilities: the fields that do not apply to
/// a capability are simply not set. This keeps one transport path and one
/// result type instead of four near-identical ones.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MediaRequest {
    /// Provider id (`stability`, `runway`, `meshy`, …).
    pub provider: String,
    /// Base URL of the provider's API.
    pub base_url: String,
    /// Bearer token for the provider.
    pub api_key: String,
    /// The prompt the media is generated from.
    pub prompt: String,
    /// Negative prompt, where the provider supports one.
    pub negative_prompt: Option<String>,
    /// Model id, where the provider selects one by name.
    pub model: Option<String>,
    /// Source image, as a data URL or a remote URL. Used by inpainting
    /// and by image-to-video / image-to-3D.
    pub image: Option<String>,
    /// Mask image, as a data URL. Used by inpainting.
    pub mask: Option<String>,
    /// Output aspect ratio, e.g. `16:9`.
    pub aspect_ratio: Option<String>,
    /// Clip duration in seconds.
    pub duration: Option<u32>,
    /// Random seed.
    pub seed: Option<u64>,
    /// Output format, e.g. `glb` for 3D models.
    pub format: Option<String>,
    /// Sampler steps (local backends default to 20).
    pub steps: Option<u32>,
    /// Classifier-free guidance scale (local backends default to 7.0).
    pub cfg: Option<f64>,
    /// Sampler id, e.g. `euler`, `euler_ancestral`, `dpmpp_2m`.
    pub sampler: Option<String>,
    /// Scheduler id, e.g. `normal`, `karras`.
    pub scheduler: Option<String>,
    /// Denoise strength. Defaults to 1.0 for txt2img and 0.75 for
    /// img2img.
    pub denoise: Option<f64>,
    /// Images per request.
    pub batch: Option<u32>,
    /// Explicit output width in pixels; overrides the aspect ratio.
    pub width: Option<u32>,
    /// Explicit output height in pixels; overrides the aspect ratio.
    pub height: Option<u32>,
    /// VAE name, where the backend loads one by name.
    pub vae: Option<String>,
    /// CLIP layers to skip (1 = none).
    pub clip_skip: Option<u32>,
    /// LoRA adapters applied in order.
    pub loras: Vec<LoraSpec>,
}

/// One LoRA adapter and its weight.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoraSpec {
    /// LoRA name as the local backend lists it (usually the filename).
    pub name: String,
    /// Blend weight; 1.0 is the adapter's trained strength.
    pub weight: f64,
}

impl Default for LoraSpec {
    fn default() -> Self {
        Self {
            name: String::new(),
            weight: 1.0,
        }
    }
}

/// What a media request produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind", content = "value")]
pub enum MediaOutcome {
    /// The media is ready. The value is a URL the host can fetch or show.
    Ready(String),
    /// The provider is still working. The value is a task id to poll.
    Pending(String),
    /// The provider failed. The value is the reason.
    Failed(String),
}

impl MediaOutcome {
    /// Whether the media is ready.
    pub fn is_ready(&self) -> bool {
        matches!(self, MediaOutcome::Ready(_))
    }

    /// Whether the provider is still working.
    pub fn is_pending(&self) -> bool {
        matches!(self, MediaOutcome::Pending(_))
    }

    /// The task id, when the provider is still working.
    pub fn task_id(&self) -> Option<&str> {
        match self {
            MediaOutcome::Pending(id) => Some(id.as_str()),
            _ => None,
        }
    }

    /// The media URL, when the media is ready.
    pub fn url(&self) -> Option<&str> {
        match self {
            MediaOutcome::Ready(url) => Some(url.as_str()),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Local backends (Automatic1111 / ComfyUI)
// ---------------------------------------------------------------------------
//
// Both run on the user's machine, need no API key, and expose an HTTP
// API: A1111's `sdapi/v1` answers synchronously with base64 images;
// ComfyUI takes an API-format workflow graph, answers with a
// `prompt_id`, and the host polls `/history/{id}` until the outputs
// appear. They are reached through the same Transport as every other
// provider, so the boundary rules hold unchanged.

/// Provider id of a local Automatic1111 (Stable Diffusion WebUI) install.
pub const A1111_ID: &str = "a1111";
/// Provider id of a local ComfyUI install.
pub const COMFYUI_ID: &str = "comfyui";
/// Provider id of the in-process Rust renderer (no sockets, no Python).
pub const NATIVE_ID: &str = "native";
/// Provider id of real in-process Stable Diffusion inference via Candle.
pub const CANDLE_ID: &str = "candle";

/// Steps A1111 and the built-in ComfyUI graph sample for.
pub const LOCAL_SD_STEPS: u32 = 20;
/// CFG scale A1111 and the built-in ComfyUI graph sample with.
pub const LOCAL_SD_CFG: f64 = 7.0;

/// Round a size up... down to a multiple of 8 (SD's latent grid),
/// never below 256.
fn round8(value: f64) -> u32 {
    let units = (value / 8.0).round() as i64;
    (units.max(32) as u32) * 8
}

/// Pixel size for a `width:height` aspect at roughly SD's 512² working
/// area. Unknown or malformed aspects fall back to square.
pub fn a1111_size(aspect: Option<&str>) -> (u32, u32) {
    let ratio = match aspect.map(str::trim) {
        Some(a) if !a.is_empty() => {
            let mut parts = a.split(':');
            let w: f64 = parts.next().and_then(|p| p.trim().parse().ok()).unwrap_or(1.0);
            let h: f64 = parts.next().and_then(|p| p.trim().parse().ok()).unwrap_or(1.0);
            if w <= 0.0 || h <= 0.0 {
                (1.0, 1.0)
            } else {
                (w / h, h / w)
            }
        }
        _ => (1.0, 1.0),
    };
    const AREA: f64 = 512.0 * 512.0;
    let width = (AREA * ratio.0).sqrt();
    let height = (AREA * ratio.1).sqrt();
    (round8(width), round8(height))
}

/// Default sampler when the request does not name one.
pub const DEFAULT_SAMPLER: &str = "euler";
/// Default scheduler when the request does not name one.
pub const DEFAULT_SCHEDULER: &str = "normal";
/// Largest batch a local backend is asked for.
pub const MAX_BATCH: u32 = 8;

/// Round an explicit dimension to SD's 8-pixel grid, within 64–2048.
fn round_dim(value: u32) -> u32 {
    let clamped = value.clamp(64, 2048);
    ((clamped + 4) / 8 * 8).min(2048)
}

/// Steps for a local SD request, clamped to a sane range.
pub fn sd_steps(req: &MediaRequest) -> u32 {
    req.steps.unwrap_or(LOCAL_SD_STEPS).clamp(1, 150)
}

/// CFG scale for a local SD request.
pub fn sd_cfg(req: &MediaRequest) -> f64 {
    req.cfg.unwrap_or(LOCAL_SD_CFG).clamp(0.0, 30.0)
}

/// Sampler id for a local SD request.
pub fn sd_sampler(req: &MediaRequest) -> &str {
    non_empty_opt(&req.sampler).unwrap_or(DEFAULT_SAMPLER)
}

/// Scheduler id for a local SD request.
pub fn sd_scheduler(req: &MediaRequest) -> &str {
    non_empty_opt(&req.scheduler).unwrap_or(DEFAULT_SCHEDULER)
}

/// Images per request, clamped to [`MAX_BATCH`].
pub fn sd_batch(req: &MediaRequest) -> u32 {
    req.batch.unwrap_or(1).clamp(1, MAX_BATCH)
}

/// CLIP layers to skip (1 = none).
pub fn sd_clip_skip(req: &MediaRequest) -> u32 {
    req.clip_skip.unwrap_or(1).clamp(1, 12)
}

/// Denoise strength for a request, with a capability-specific default.
pub fn sd_denoise(req: &MediaRequest, default: f64) -> f64 {
    req.denoise.unwrap_or(default).clamp(0.0, 1.0)
}

/// Output size: explicit width/height win over the aspect ratio.
pub fn sd_size(req: &MediaRequest) -> (u32, u32) {
    let (aspect_w, aspect_h) = a1111_size(req.aspect_ratio.as_deref());
    let width = req.width.map(round_dim).unwrap_or(aspect_w);
    let height = req.height.map(round_dim).unwrap_or(aspect_h);
    (width, height)
}

/// A LoRA's effective weight (0 is treated as the trained strength).
fn lora_weight(lora: &LoraSpec) -> f64 {
    if lora.weight == 0.0 {
        1.0
    } else {
        lora.weight
    }
}

/// The A1111 prompt with LoRA tags appended (`<lora:name:weight>`).
pub fn a1111_prompt(req: &MediaRequest) -> String {
    let mut prompt = req.prompt.clone();
    for lora in &req.loras {
        let name = lora.name.trim();
        if !name.is_empty() {
            prompt.push_str(&format!(" <lora:{}:{}>", name, lora_weight(lora)));
        }
    }
    prompt
}

/// Map a canonical sampler/scheduler pair to A1111's display name.
pub fn a1111_sampler(req: &MediaRequest) -> String {
    let base = match sd_sampler(req) {
        "euler" => "Euler",
        "euler_ancestral" => "Euler a",
        "heun" => "Heun",
        "dpm_2" => "DPM2",
        "dpmpp_2m" => "DPM++ 2M",
        "dpmpp_2m_sde" => "DPM++ 2M SDE",
        "ddim" => "DDIM",
        "uni_pc" => "UniPC",
        "lms" => "LMS",
        other => other,
    };
    match sd_scheduler(req) {
        "karras" => format!("{base} Karras"),
        "exponential" => format!("{base} Exponential"),
        _ => base.to_string(),
    }
}

/// Strip a data-URL prefix, leaving the raw base64 the SD APIs expect.
fn strip_data_url(url: &str) -> String {
    match url.find(";base64,") {
        Some(index) => url[index + ";base64,".len()..].to_string(),
        None => url.to_string(),
    }
}

/// Decode standard base64 (with `=` padding, newlines and spaces
/// tolerated). The core carries no base64 dependency: this is the one
/// place that needs it, and a small decoder keeps the dependency graph
/// flat on every target.
pub fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            // Padding ends the data.
            b'=' => break,
            // Whitespace is not data.
            b'\n' | b'\r' | b' ' | b'\t' => continue,
            other => return Err(format!("invalid base64 byte: {other}")),
        };
        buf = (buf << 6) | value as u32;
        bits += 6;
        while bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
        // Drop the bits already emitted so `buf` stays bounded.
        buf &= (1u32 << bits) - 1;
    }
    Ok(out)
}

/// Encode bytes as standard base64 with `=` padding.
pub fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Decode a `data:<mime>;base64,<payload>` URL.
/// `Ok(None)` means the input is not a data URL (a remote URL, say) and
/// the caller should fetch it through the transport instead.
pub fn decode_data_url(text: &str) -> Result<Option<(Vec<u8>, String)>, String> {
    if !text.starts_with("data:") {
        return Ok(None);
    }
    let comma = text
        .find(',')
        .ok_or_else(|| "malformed data URL: no comma".to_string())?;
    let header = &text[..comma];
    if !header.ends_with(";base64") {
        return Err("data URL is not base64-encoded".to_string());
    }
    let mime = header
        .trim_start_matches("data:")
        .trim_end_matches(";base64");
    let mime = if mime.trim().is_empty() {
        "application/octet-stream"
    } else {
        mime.trim()
    };
    let bytes = base64_decode(&text[comma + 1..])?;
    Ok(Some((bytes, mime.to_string())))
}

/// A file extension for an image mime type.
fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}


/// A1111 txt2img body (`POST /sdapi/v1/txt2img`). Model, VAE and CLIP
/// skip switch for this one request and are restored afterwards; LoRAs
/// are appended to the prompt as `<lora:name:weight>` tags.
pub fn a1111_txt2img_body(req: &MediaRequest) -> serde_json::Value {
    let (width, height) = sd_size(req);
    let mut body = serde_json::json!({
        "prompt": a1111_prompt(req),
        "steps": sd_steps(req),
        "cfg_scale": sd_cfg(req),
        "width": width,
        "height": height,
        "batch_size": sd_batch(req),
        "sampler_name": a1111_sampler(req),
        "seed": req.seed.map(|s| s as i64).unwrap_or(-1),
    });
    if let Some(neg) = &req.negative_prompt {
        if !neg.trim().is_empty() {
            body["negative_prompt"] = serde_json::json!(neg);
        }
    }

    let mut overrides = serde_json::Map::new();
    if let Some(model) = non_empty_opt(&req.model) {
        overrides.insert(
            "sd_model_checkpoint".to_string(),
            serde_json::json!(model),
        );
    }
    if let Some(vae) = non_empty_opt(&req.vae) {
        overrides.insert("sd_vae".to_string(), serde_json::json!(vae));
    }
    let clip_skip = sd_clip_skip(req);
    if clip_skip > 1 {
        overrides.insert(
            "CLIP_stop_at_last_layers".to_string(),
            serde_json::json!(clip_skip),
        );
    }
    if !overrides.is_empty() {
        body["override_settings"] = serde_json::Value::Object(overrides);
        body["override_settings_restore_afterwards"] = serde_json::json!(true);
    }
    body
}

/// A1111 img2img body (`POST /sdapi/v1/img2img`): the txt2img fields
/// plus the source image, denoise strength, and the mask when
/// inpainting.
pub fn a1111_img2img_body(req: &MediaRequest) -> serde_json::Value {
    let mut body = a1111_txt2img_body(req);
    let source = req
        .image
        .as_deref()
        .map(strip_data_url)
        .unwrap_or_default();
    body["init_images"] = serde_json::json!([source]);
    body["denoising_strength"] = serde_json::json!(sd_denoise(req, 0.75));
    if let Some(mask) = &req.mask {
        body["mask"] = serde_json::json!(strip_data_url(mask));
        body["inpaint_full_res"] = serde_json::json!(true);
    }
    body
}

/// Pull every image out of an A1111 response (`{"images": [b64]}`) and
/// wrap each in a data URL, preserving batch order.
pub fn a1111_images(text: &str) -> Result<Vec<String>, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let images: Vec<String> = v
        .get("images")
        .and_then(|i| i.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .filter(|image| !image.is_empty())
                .map(|image| {
                    if image.starts_with("data:") {
                        image.to_string()
                    } else {
                        format!("data:image/png;base64,{image}")
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    if images.is_empty() {
        return Err(format!(
            "no image in A1111 response: {}",
            truncate(text, 200)
        ));
    }
    Ok(images)
}

/// Pull the first image out of an A1111 response.
pub fn parse_a1111_image(text: &str) -> Result<String, String> {
    a1111_images(text)?
        .into_iter()
        .next()
        .ok_or_else(|| format!("no image in A1111 response: {}", truncate(text, 200)))
}

/// The default filename prefix ComfyUI's SaveImage node writes under.
pub const COMFYUI_FILENAME_PREFIX: &str = "prism";

/// Node ids and wiring shared by the built-in graphs: checkpoint, CLIP
/// skip, the LoRA chain and an optional VAE. Optional nodes take ids
/// from 8 upward, so the base nodes keep stable ids.
struct ComfySources {
    nodes: serde_json::Map<String, serde_json::Value>,
    clip: serde_json::Value,
    model: serde_json::Value,
    vae: serde_json::Value,
}

fn comfyui_sources(req: &MediaRequest, checkpoint: &str) -> ComfySources {
    let mut nodes = serde_json::Map::new();
    nodes.insert(
        "1".to_string(),
        serde_json::json!({
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": checkpoint },
        }),
    );
    let mut next = 8u32;

    let mut clip = serde_json::json!(["1", 1]);
    let clip_skip = sd_clip_skip(req);
    if clip_skip > 1 {
        let id = next.to_string();
        next += 1;
        nodes.insert(
            id.clone(),
            serde_json::json!({
                "class_type": "CLIPSetLastLayer",
                "inputs": { "clip": clip, "stop_at_clip_layer": -(clip_skip as i64) },
            }),
        );
        clip = serde_json::json!([id, 0]);
    }

    let mut model = serde_json::json!(["1", 0]);
    for lora in &req.loras {
        let name = lora.name.trim();
        if name.is_empty() {
            continue;
        }
        let id = next.to_string();
        next += 1;
        nodes.insert(
            id.clone(),
            serde_json::json!({
                "class_type": "LoraLoader",
                "inputs": {
                    "model": model,
                    "clip": clip,
                    "lora_name": name,
                    "strength_model": lora_weight(lora),
                    "strength_clip": lora_weight(lora),
                },
            }),
        );
        model = serde_json::json!([id, 0]);
        clip = serde_json::json!([id, 1]);
    }

    let mut vae = serde_json::json!(["1", 2]);
    if let Some(name) = non_empty_opt(&req.vae) {
        let id = next.to_string();
        nodes.insert(
            id.clone(),
            serde_json::json!({ "class_type": "VAELoader", "inputs": { "vae_name": name } }),
        );
        vae = serde_json::json!([id, 0]);
    }

    ComfySources {
        nodes,
        clip,
        model,
        vae,
    }
}

/// The KSampler inputs every graph shares.
fn ksampler_inputs(
    req: &MediaRequest,
    model: &serde_json::Value,
    positive: &serde_json::Value,
    negative: &serde_json::Value,
    latent: &serde_json::Value,
    denoise: f64,
) -> serde_json::Value {
    serde_json::json!({
        "seed": req.seed.unwrap_or(0),
        "steps": sd_steps(req),
        "cfg": sd_cfg(req),
        "sampler_name": sd_sampler(req),
        "scheduler": sd_scheduler(req),
        "denoise": denoise,
        "model": model,
        "positive": positive,
        "negative": negative,
        "latent_image": latent,
    })
}

/// The built-in ComfyUI graph: txt2img over the default checkpoint,
/// sampler and size — API format (`POST /prompt`). `checkpoint` must be
/// a name the install actually has (see [`comfyui_pick_checkpoint`]).
pub fn comfyui_workflow_body(req: &MediaRequest, checkpoint: &str) -> serde_json::Value {
    let ComfySources {
        mut nodes,
        clip,
        model,
        vae,
    } = comfyui_sources(req, checkpoint);
    let (width, height) = sd_size(req);
    let negative = req.negative_prompt.as_deref().unwrap_or_default();

    nodes.insert(
        "2".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": req.prompt, "clip": clip.clone() } }),
    );
    nodes.insert(
        "3".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": clip } }),
    );
    nodes.insert(
        "4".to_string(),
        serde_json::json!({
            "class_type": "EmptyLatentImage",
            "inputs": { "width": width, "height": height, "batch_size": sd_batch(req) },
        }),
    );
    nodes.insert(
        "5".to_string(),
        serde_json::json!({
            "class_type": "KSampler",
            "inputs": ksampler_inputs(
                req,
                &model,
                &serde_json::json!(["2", 0]),
                &serde_json::json!(["3", 0]),
                &serde_json::json!(["4", 0]),
                sd_denoise(req, 1.0),
            ),
        }),
    );
    nodes.insert(
        "6".to_string(),
        serde_json::json!({ "class_type": "VAEDecode", "inputs": { "samples": ["5", 0], "vae": vae } }),
    );
    nodes.insert(
        "7".to_string(),
        serde_json::json!({
            "class_type": "SaveImage",
            "inputs": { "images": ["6", 0], "filename_prefix": COMFYUI_FILENAME_PREFIX },
        }),
    );
    serde_json::Value::Object(nodes)
}

/// Frames the built-in AnimateDiff graph renders for a clip.
///
/// AnimateDiff is happiest with short batches; the requested duration
/// maps to 8 fps, clamped to 8–32 frames, and an unset duration uses 16.
pub fn comfyui_frames(duration: Option<u32>) -> u32 {
    match duration {
        Some(seconds) if seconds > 0 => (seconds.saturating_mul(8)).clamp(8, 32),
        _ => 16,
    }
}

/// The built-in ComfyUI img2img graph: the uploaded image is encoded to
/// a latent and re-sampled at 75% denoise. `image` is the name the
/// install gave the upload (see [`comfyui_upload_name`]).
pub fn comfyui_img2img_workflow(
    req: &MediaRequest,
    checkpoint: &str,
    image: &str,
) -> serde_json::Value {
    let ComfySources {
        mut nodes,
        clip,
        model,
        vae,
    } = comfyui_sources(req, checkpoint);
    let negative = req.negative_prompt.as_deref().unwrap_or_default();

    nodes.insert(
        "2".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": req.prompt, "clip": clip.clone() } }),
    );
    nodes.insert(
        "3".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": clip } }),
    );
    nodes.insert(
        "4".to_string(),
        serde_json::json!({ "class_type": "LoadImage", "inputs": { "image": image } }),
    );
    nodes.insert(
        "5".to_string(),
        serde_json::json!({
            "class_type": "VAEEncode",
            "inputs": { "pixels": ["4", 0], "vae": vae.clone() },
        }),
    );
    nodes.insert(
        "6".to_string(),
        serde_json::json!({
            "class_type": "KSampler",
            "inputs": ksampler_inputs(
                req,
                &model,
                &serde_json::json!(["2", 0]),
                &serde_json::json!(["3", 0]),
                &serde_json::json!(["5", 0]),
                sd_denoise(req, 0.75),
            ),
        }),
    );
    nodes.insert(
        "7".to_string(),
        serde_json::json!({ "class_type": "VAEDecode", "inputs": { "samples": ["6", 0], "vae": vae } }),
    );
    nodes.insert(
        "8".to_string(),
        serde_json::json!({
            "class_type": "SaveImage",
            "inputs": { "images": ["7", 0], "filename_prefix": COMFYUI_FILENAME_PREFIX },
        }),
    );
    serde_json::Value::Object(nodes)
}

/// The built-in ComfyUI inpaint graph: the source and a red-channel
/// mask are uploaded, then `VAEEncodeForInpaint` grows the mask by 6 px
/// and the sampler repaints the hole at full denoise.
pub fn comfyui_inpaint_workflow(
    req: &MediaRequest,
    checkpoint: &str,
    image: &str,
    mask: &str,
) -> serde_json::Value {
    let ComfySources {
        mut nodes,
        clip,
        model,
        vae,
    } = comfyui_sources(req, checkpoint);
    let negative = req.negative_prompt.as_deref().unwrap_or_default();

    nodes.insert(
        "2".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": req.prompt, "clip": clip.clone() } }),
    );
    nodes.insert(
        "3".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": clip } }),
    );
    nodes.insert(
        "4".to_string(),
        serde_json::json!({ "class_type": "LoadImage", "inputs": { "image": image } }),
    );
    nodes.insert(
        "5".to_string(),
        serde_json::json!({ "class_type": "LoadImageMask", "inputs": { "image": mask, "channel": "red" } }),
    );
    nodes.insert(
        "6".to_string(),
        serde_json::json!({
            "class_type": "VAEEncodeForInpaint",
            "inputs": {
                "pixels": ["4", 0],
                "vae": vae.clone(),
                "mask": ["5", 0],
                "grow_mask_by": 6,
            },
        }),
    );
    nodes.insert(
        "7".to_string(),
        serde_json::json!({
            "class_type": "KSampler",
            "inputs": ksampler_inputs(
                req,
                &model,
                &serde_json::json!(["2", 0]),
                &serde_json::json!(["3", 0]),
                &serde_json::json!(["6", 0]),
                sd_denoise(req, 1.0),
            ),
        }),
    );
    nodes.insert(
        "8".to_string(),
        serde_json::json!({ "class_type": "VAEDecode", "inputs": { "samples": ["7", 0], "vae": vae } }),
    );
    nodes.insert(
        "9".to_string(),
        serde_json::json!({
            "class_type": "SaveImage",
            "inputs": { "images": ["8", 0], "filename_prefix": COMFYUI_FILENAME_PREFIX },
        }),
    );
    serde_json::Value::Object(nodes)
}

/// Frames per second the built-in video graph encodes at.
pub const COMFYUI_VIDEO_FPS: u32 = 8;

/// The built-in AnimateDiff graph: an AnimateDiff-Evolved motion module
/// is loaded over the checkpoint, an empty latent batch of
/// [`comfyui_frames`] frames is sampled, and VideoHelperSuite's
/// `VHS_VideoCombine` writes an H.264 MP4. Both custom node packs are
/// resolved from the install's `object_info` first.
pub fn comfyui_animatediff_workflow(
    req: &MediaRequest,
    checkpoint: &str,
    motion_model: &str,
) -> serde_json::Value {
    let ComfySources {
        mut nodes,
        clip,
        model,
        vae,
    } = comfyui_sources(req, checkpoint);
    let (width, height) = sd_size(req);
    let negative = req.negative_prompt.as_deref().unwrap_or_default();
    let frames = comfyui_frames(req.duration);

    nodes.insert(
        "2".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": req.prompt, "clip": clip.clone() } }),
    );
    nodes.insert(
        "3".to_string(),
        serde_json::json!({ "class_type": "CLIPTextEncode", "inputs": { "text": negative, "clip": clip } }),
    );
    nodes.insert(
        "4".to_string(),
        serde_json::json!({
            "class_type": "ADE_AnimateDiffLoaderGen1",
            "inputs": {
                "model": model,
                "model_name": motion_model,
                "beta_schedule": "autoselect",
            },
        }),
    );
    nodes.insert(
        "5".to_string(),
        serde_json::json!({
            "class_type": "EmptyLatentImage",
            "inputs": { "width": width, "height": height, "batch_size": frames },
        }),
    );
    nodes.insert(
        "6".to_string(),
        serde_json::json!({
            "class_type": "KSampler",
            "inputs": ksampler_inputs(
                req,
                &serde_json::json!(["4", 0]),
                &serde_json::json!(["2", 0]),
                &serde_json::json!(["3", 0]),
                &serde_json::json!(["5", 0]),
                sd_denoise(req, 1.0),
            ),
        }),
    );
    nodes.insert(
        "7".to_string(),
        serde_json::json!({ "class_type": "VAEDecode", "inputs": { "samples": ["6", 0], "vae": vae } }),
    );
    nodes.insert(
        "8".to_string(),
        serde_json::json!({
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["7", 0],
                "frame_rate": COMFYUI_VIDEO_FPS,
                "loop_count": 0,
                "filename_prefix": COMFYUI_FILENAME_PREFIX,
                "format": "video/h264-mp4",
                "pingpong": false,
                "save_output": true,
            },
        }),
    );
    serde_json::Value::Object(nodes)
}

/// Pick a checkpoint from ComfyUI's `/object_info/CheckpointLoaderSimple`
/// response. The requested model wins when the install has it;
/// otherwise the first available one is used.
pub fn comfyui_pick_checkpoint(text: &str, wanted: Option<&str>) -> Result<String, String> {
    comfyui_pick_option(text, "CheckpointLoaderSimple", "ckpt_name", wanted)
}

/// Pick one option out of a ComfyUI `/object_info/<node>` response.
///
/// `node` is the class name, `input` the input name (e.g. `ckpt_name`
/// or `model_name`). The wanted value wins when the install has it;
/// otherwise the first available option is used. A missing node or
/// option list is an error, so the caller can report "not installed"
/// instead of queueing a graph that cannot run.
pub fn comfyui_pick_option(
    text: &str,
    node: &str,
    input: &str,
    wanted: Option<&str>,
) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let names: Vec<String> = v
        .get(node)
        .and_then(|n| n.get("input"))
        .and_then(|i| i.get("required"))
        .and_then(|r| r.get(input))
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if names.is_empty() {
        return Err(format!("no {input} options for {node} in ComfyUI object_info"));
    }
    let wanted = wanted.map(str::trim).filter(|w| !w.is_empty());
    if let Some(wanted) = wanted {
        if names.iter().any(|n| n == wanted) {
            return Ok(wanted.to_string());
        }
    }
    Ok(names[0].clone())
}

/// The multipart boundary the ComfyUI upload body uses.
pub const COMFYUI_UPLOAD_BOUNDARY: &str = "----prism-comfyui-boundary";

/// A pre-serialized multipart body and its `Content-Type`.
pub struct MultipartBody {
    pub content_type: String,
    pub body: Vec<u8>,
}

fn push_part_header(body: &mut Vec<u8>, boundary: &str) {
    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"\r\n");
}

fn push_text_part(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    push_part_header(body, boundary);
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(value.as_bytes());
    body.extend_from_slice(b"\r\n");
}

/// Strip quotes and line breaks from a filename used in a part header.
fn header_safe(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '"' | '\r' | '\n' => '_',
            c => c,
        })
        .collect()
}

/// The multipart body for `POST /upload/image`.
///
/// ComfyUI expects the file under `image`, `overwrite=true`, and
/// `type=input` so the graph's `LoadImage` can find it afterwards. The
/// body is built here, as bytes, so every host sends the same parts.
pub fn comfyui_upload_body(filename: &str, bytes: &[u8]) -> MultipartBody {
    let boundary = COMFYUI_UPLOAD_BOUNDARY;
    let mut body = Vec::with_capacity(bytes.len() + 512);
    push_part_header(&mut body, boundary);
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"image\"; filename=\"{}\"\r\n",
            header_safe(filename)
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
    push_text_part(&mut body, boundary, "overwrite", "true");
    push_text_part(&mut body, boundary, "type", "input");
    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"--\r\n");
    MultipartBody {
        content_type: format!("multipart/form-data; boundary={boundary}"),
        body,
    }
}

/// The name ComfyUI assigned to an uploaded file
/// (`{"name":"prism-source.png","subfolder":"","type":"input"}`).
pub fn comfyui_upload_name(text: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").trim();
    if name.is_empty() {
        return Err(format!(
            "no name in ComfyUI upload response: {}",
            truncate(text, 200)
        ));
    }
    let subfolder = v
        .get("subfolder")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim_matches('/');
    if subfolder.is_empty() {
        Ok(name.to_string())
    } else {
        Ok(format!("{subfolder}/{name}"))
    }
}


/// The fetch URL for an image ComfyUI reported in its history.
pub fn comfyui_view_url(base: &str, filename: &str, subfolder: &str, kind: &str) -> String {
    format!(
        "{base}/view?filename={}&subfolder={}&type={}",
        urlencode(filename),
        urlencode(subfolder),
        urlencode(kind)
    )
}

/// Pull the output media of a completed ComfyUI history entry.
///
/// The history is keyed by prompt id; its `outputs` map carries one or
/// more save nodes. `SaveImage` reports `images`, VideoHelperSuite
/// reports `gifs` (even for MP4s) or `videos`. The first entry of the
/// first non-empty list wins.
pub fn comfyui_output_from_history(text: &str) -> Result<(String, String, String), String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let outputs = v
        .as_object()
        .and_then(|map| map.values().next())
        .and_then(|entry| entry.get("outputs"))
        .and_then(|o| o.as_object());
    let Some(outputs) = outputs else {
        return Err("no outputs in ComfyUI history".to_string());
    };
    for node in outputs.values() {
        for list in ["images", "gifs", "videos"] {
            if let Some(item) = node
                .get(list)
                .and_then(|i| i.as_array())
                .and_then(|items| items.first())
            {
                let filename = item.get("filename").and_then(|f| f.as_str()).unwrap_or("");
                let subfolder = item.get("subfolder").and_then(|f| f.as_str()).unwrap_or("");
                let kind = item.get("type").and_then(|f| f.as_str()).unwrap_or("output");
                if !filename.is_empty() {
                    return Ok((
                        filename.to_string(),
                        subfolder.to_string(),
                        kind.to_string(),
                    ));
                }
            }
        }
    }
    Err("no media in ComfyUI history".to_string())
}

/// Image-only history reader, kept for callers that know the graph
/// saves images. Video outputs go through [`comfyui_output_from_history`].
pub fn comfyui_image_from_history(text: &str) -> Result<(String, String, String), String> {
    comfyui_output_from_history(text)
}

fn non_empty_opt(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|t| !t.is_empty())
}

/// Minimal percent-encoding for the `/view` query string.
fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/// Stability image-generation request body (`POST /v2beta/stable-image/generate`).
pub fn stability_image_body(req: &MediaRequest) -> serde_json::Value {
    serde_json::json!({
        "prompt": req.prompt,
        "output_format": "png",
    })
}

/// Stability inpainting request body.
///
/// The image and the mask are sent as multipart form fields in the real
/// API; the JSON body here carries the textual fields, and the host adds
/// the binary parts. `multipart_fields` lists the parts in order so that
/// every target builds the same multipart body.
pub fn stability_inpaint_fields(req: &MediaRequest) -> Vec<(String, String)> {
    let mut fields = vec![
        ("prompt".to_string(), req.prompt.clone()),
        ("output_format".to_string(), "png".to_string()),
    ];
    if let Some(neg) = &req.negative_prompt {
        fields.push(("negative_prompt".to_string(), neg.clone()));
    }
    fields
}

/// Runway video-generation request body (`POST /v1/image_to_video`).
pub fn runway_video_body(req: &MediaRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "promptText": req.prompt,
        "ratio": req.aspect_ratio.clone().unwrap_or_else(|| "16:9".to_string()),
        "duration": req.duration.unwrap_or(5),
    });
    if let Some(seed) = req.seed {
        body["seed"] = serde_json::json!(seed);
    }
    if let Some(image) = &req.image {
        body["promptImage"] = serde_json::json!(image);
    }
    body
}

/// Meshy 3D-model request body (`POST /v2/text-to-3d`).
pub fn meshy_model_body(req: &MediaRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "mode": "text_to_3d",
        "prompt": req.prompt,
        "art_style": "realistic",
        "negative_prompt": "low quality, low resolution, bad anatomy",
    });
    if let Some(image) = &req.image {
        body["mode"] = serde_json::json!("image_to_3d");
        body["image_url"] = serde_json::json!(image);
    }
    body
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// Pull a media URL out of a provider response.
///
/// The providers disagree about where the URL lives, so the known keys are
/// tried in order. A response that carries none of them is a failure, not
/// an empty success.
pub fn parse_media_url(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    for key in ["url", "image", "output", "video"] {
        if let Some(s) = v.get(key).and_then(|i| i.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
    }
    // Nested shapes: `{ "output": { "url": ... } }` and
    // `{ "data": [{ "url": ... }] }`.
    for key in ["output", "data", "result"] {
        match v.get(key) {
            Some(serde_json::Value::Object(map)) => {
                if let Some(s) = map.get("url").and_then(|i| i.as_str()) {
                    if !s.is_empty() {
                        return Ok(s.to_string());
                    }
                }
            }
            Some(serde_json::Value::Array(items)) => {
                for item in items {
                    if let Some(s) = item.get("url").and_then(|i| i.as_str()) {
                        if !s.is_empty() {
                            return Ok(s.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Err("no media URL in response".to_string())
}

/// Pull a task id out of a provider response.
///
/// Providers that work asynchronously answer with a task id first; the
/// host polls with it until the task is done.
pub fn parse_task_id(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    for key in ["task_id", "taskId", "id", "result"] {
        if let Some(s) = v.get(key).and_then(|i| i.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
    }
    if let Some(s) = v
        .get("result")
        .and_then(|r| r.get("task_id"))
        .and_then(|i| i.as_str())
    {
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    Err("no task id in response".to_string())
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

/// Default base URL of a media provider.
pub fn default_base_url(provider: &str) -> &'static str {
    match provider {
        "stability" => "https://api.stability.ai/v2beta",
        "huggingface" => "https://api-inference.huggingface.co/models",
        "fireworks" => "https://api.fireworks.ai/inference/v1",
        "runway" => "https://api.dev.runwayml.com/v1",
        "kling" => "https://api.klingai.com/v1",
        "luma" => "https://api.lumalabs.ai/dream-machine/v1",
        "meshy" => "https://api.meshy.ai/v2",
        "tripo" => "https://api.tripo3d.ai/v2/openapi",
        // Local installs, on the user's machine.
        "a1111" => "http://127.0.0.1:7860",
        "comfyui" => "http://127.0.0.1:8188",
        _ => "",
    }
}

/// Whether the provider works asynchronously (it answers with a task id
/// that has to be polled).
pub fn is_async_provider(provider: &str) -> bool {
matches!(
        provider,
        "runway" | "kling" | "luma" | "meshy" | "tripo" | "comfyui"
    )
}

/// Sends a media request and reads the provider's answer.
///
/// A provider that works asynchronously answers with a task id, which is
/// returned as `Pending`. The host polls with [`poll_media`] until the
/// task is done.
pub async fn run_media<T: Transport + ?Sized>(
    transport: &T,
    kind: MediaKind,
    req: &MediaRequest,
) -> Result<MediaOutcome, String> {
    // The native renderer runs in-process: no base URL, no transport.
    if req.provider == NATIVE_ID {
        return crate::native_sd::run(kind, req).map(MediaOutcome::Ready);
    }
    // Candle also runs in-process, but loads local neural weights instead
    // of drawing a deterministic preview. `base_url` is the model dir.
    if req.provider == CANDLE_ID {
        #[cfg(feature = "candle-sd")]
        return crate::candle_sd::run(kind, req).map(MediaOutcome::Ready);
        #[cfg(not(feature = "candle-sd"))]
        return Err(
            "the Candle backend requires prism-core to be built with the candle-sd feature"
                .to_string(),
        );
    }
    let base = if req.base_url.trim().is_empty() {
        default_base_url(&req.provider).to_string()
    } else {
        req.base_url.trim().trim_end_matches('/').to_string()
    };
    if base.is_empty() {
        return Err(format!("unknown media provider: {}", req.provider));
    }

    // ComfyUI needs a checkpoint resolved from the install before it can
    // take the workflow, so it runs its own two-call flow.
    if req.provider == COMFYUI_ID {
        return run_comfyui(transport, kind, req, &base).await;
    }
    // A1111 supports image (+ inpaint via img2img + mask) only; say so
    // instead of posting a body the install cannot answer.
    if req.provider == A1111_ID && !matches!(kind, MediaKind::Image | MediaKind::Inpaint) {
        return Err(format!(
            "A1111 does not support the {:?} capability (image and inpaint only)",
            kind
        ));
    }

    let (url, body, extra_headers) = match kind {
        MediaKind::Image => (
            match req.provider.as_str() {
                "stability" => format!("{base}/stable-image/generate"),
                A1111_ID => {
                    if req.image.is_some() {
                        format!("{base}/sdapi/v1/img2img")
                    } else {
                        format!("{base}/sdapi/v1/txt2img")
                    }
                }
                _ => format!("{base}"),
            },
            match req.provider.as_str() {
                A1111_ID if req.image.is_some() => a1111_img2img_body(req),
                A1111_ID => a1111_txt2img_body(req),
                _ => stability_image_body(req),
            },
            Vec::new(),
        ),
        MediaKind::Inpaint => (
            match req.provider.as_str() {
                A1111_ID => format!("{base}/sdapi/v1/img2img"),
                _ => format!("{base}/stable-image/edit/inpaint"),
            },
            match req.provider.as_str() {
                A1111_ID => a1111_img2img_body(req),
                _ => serde_json::json!({}),
            },
            Vec::new(),
        ),
        MediaKind::Video => (
            match req.provider.as_str() {
                "runway" => format!("{base}/image_to_video"),
                "kling" => format!("{base}/videos/image2video"),
                "luma" => format!("{base}/generations"),
                _ => format!("{base}"),
            },
            runway_video_body(req),
            vec![("X-Runway-Version".to_string(), "2024-11-06".to_string())],
        ),
        MediaKind::Model => (
            match req.provider.as_str() {
                "meshy" => format!("{base}/text-to-3d"),
                "tripo" => format!("{base}/task"),
                _ => format!("{base}"),
            },
            meshy_model_body(req),
            Vec::new(),
        ),
    };

    let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
    if !req.api_key.is_empty() {
        headers.push((
            "Authorization".to_string(),
            format!("Bearer {}", req.api_key),
        ));
    }
    headers.extend(extra_headers);

    let http_req = HttpRequest {
        url,
        headers,
        body: Some(body.to_string()),
    };
    let resp = transport.post_body(http_req).await?;
    let text = String::from_utf8_lossy(&resp).to_string();

    if is_async_provider(&req.provider) {
        match parse_task_id(&text) {
            Ok(id) => Ok(MediaOutcome::Pending(id)),
            // A provider that is supposed to work asynchronously may still
            // answer with the finished media.
            Err(_) => parse_media_url(&text)
                .map(MediaOutcome::Ready)
                .map_err(|e| format!("{e}: {}", truncate(&text, 200))),
        }
    } else if req.provider == A1111_ID {
        // A1111 answers synchronously with base64 images.
        parse_a1111_image(&text).map(MediaOutcome::Ready)
    } else {
        parse_media_url(&text)
            .map(MediaOutcome::Ready)
            .map_err(|e| format!("{e}: {}", truncate(&text, 200)))
    }
}

/// Runs the ComfyUI flow: resolve the pieces the install actually has,
/// build the matching graph, and queue it. The answer is the
/// `prompt_id` to poll.
async fn run_comfyui<T: Transport + ?Sized>(
    transport: &T,
    kind: MediaKind,
    req: &MediaRequest,
    base: &str,
) -> Result<MediaOutcome, String> {
    if kind == MediaKind::Model {
        return Err("ComfyUI does not support 3D model generation".to_string());
    }
    if kind == MediaKind::Inpaint {
        let present = |value: &Option<String>| {
            value
                .as_deref()
                .map(str::trim)
                .is_some_and(|s| !s.is_empty())
        };
        if !present(&req.image) {
            return Err("inpainting needs a source image".to_string());
        }
        if !present(&req.mask) {
            return Err("inpainting needs a mask image".to_string());
        }
    }

    // Video's `model` names the motion module, not the checkpoint, so
    // the checkpoint is resolved from the install's first one.
    let checkpoint_wanted = if kind == MediaKind::Video {
        None
    } else {
        req.model.as_deref()
    };
    let checkpoint = {
        let info = transport
            .get_body(HttpRequest {
                url: format!("{base}/object_info/CheckpointLoaderSimple"),
                headers: Vec::new(),
                body: None,
            })
            .await?;
        let text = String::from_utf8_lossy(&info).to_string();
        comfyui_pick_checkpoint(&text, checkpoint_wanted)?
    };

    let workflow = match kind {
        MediaKind::Image => match req.image.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(source) => {
                let name =
                    comfyui_upload_image(transport, base, source, "prism-source").await?;
                comfyui_img2img_workflow(req, &checkpoint, &name)
            }
            None => comfyui_workflow_body(req, &checkpoint),
        },
        MediaKind::Inpaint => {
            let image = req
                .image
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("inpainting needs a source image")?;
            let mask = req
                .mask
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or("inpainting needs a mask image")?;
            let image_name =
                comfyui_upload_image(transport, base, image, "prism-source").await?;
            let mask_name = comfyui_upload_image(transport, base, mask, "prism-mask").await?;
            comfyui_inpaint_workflow(req, &checkpoint, &image_name, &mask_name)
        }
        MediaKind::Video => {
            let info = transport
                .get_body(HttpRequest {
                    url: format!("{base}/object_info/ADE_AnimateDiffLoaderGen1"),
                    headers: Vec::new(),
                    body: None,
                })
                .await?;
            let text = String::from_utf8_lossy(&info).to_string();
            let motion = comfyui_pick_option(
                &text,
                "ADE_AnimateDiffLoaderGen1",
                "model_name",
                req.model.as_deref(),
            )
            .map_err(|e| {
                format!("{e} (is ComfyUI-AnimateDiff-Evolved installed?)")
            })?;
            comfyui_animatediff_workflow(req, &checkpoint, &motion)
        }
        MediaKind::Model => unreachable!("rejected above"),
    };

    let http_req = HttpRequest {
        url: format!("{base}/prompt"),
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: Some(workflow.to_string()),
    };
    let resp = transport.post_body(http_req).await?;
    let text = String::from_utf8_lossy(&resp).to_string();
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid JSON: {e}"))?;
    match v.get("prompt_id").and_then(|i| i.as_str()) {
        Some(id) if !id.is_empty() => Ok(MediaOutcome::Pending(id.to_string())),
        _ => Err(format!(
            "no prompt_id in ComfyUI response: {}",
            truncate(&text, 200)
        )),
    }
}

/// Upload a source image to ComfyUI's `/upload/image` and return the
/// name a `LoadImage` node should reference.
///
/// The source is either a data URL (decoded locally) or a remote URL
/// (fetched through the same transport as everything else).
async fn comfyui_upload_image<T: Transport + ?Sized>(
    transport: &T,
    base: &str,
    source: &str,
    stem: &str,
) -> Result<String, String> {
    let (bytes, mime) = match decode_data_url(source)? {
        Some(decoded) => decoded,
        None => {
            let bytes = transport
                .get_body(HttpRequest {
                    url: source.to_string(),
                    headers: Vec::new(),
                    body: None,
                })
                .await?;
            let extension = source
                .split('?')
                .next()
                .unwrap_or("")
                .rsplit('.')
                .next()
                .unwrap_or("png");
            let extension = match extension.to_ascii_lowercase().as_str() {
                "jpg" | "jpeg" | "webp" | "gif" | "png" => extension.to_ascii_lowercase(),
                _ => "png".to_string(),
            };
            (bytes, format!("image/{extension}"))
        }
    };

    let filename = format!("{stem}.{}", extension_for_mime(&mime));
    let multipart = comfyui_upload_body(&filename, &bytes);
    let resp = transport
        .post_bytes(
            HttpRequest {
                url: format!("{base}/upload/image"),
                headers: Vec::new(),
                body: None,
            },
            multipart.body,
            &multipart.content_type,
        )
        .await?;
    let text = String::from_utf8_lossy(&resp).to_string();
    comfyui_upload_name(&text)
}

/// Asks an asynchronous provider about a task.
///
/// Returns `Ready` once the task is done and `Pending` while it is still
/// running. A provider that reports the task as failed answers `Failed`.
pub async fn poll_media<T: Transport + ?Sized>(
    transport: &T,
    provider: &str,
    base_url: &str,
    api_key: &str,
    task_id: &str,
) -> Result<MediaOutcome, String> {
    let base = if base_url.trim().is_empty() {
        default_base_url(provider).to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let url = match provider {
        "runway" => format!("{base}/tasks/{task_id}"),
        "kling" => format!("{base}/videos/image2video/{task_id}"),
        "luma" => format!("{base}/generations/{task_id}"),
        "meshy" => format!("{base}/meshy-3d/text-to-3d/{task_id}"),
        "tripo" => format!("{base}/task/{task_id}"),
        "comfyui" => format!("{base}/history/{task_id}"),
        other => return Err(format!("unknown media provider: {other}")),
    };

    let mut headers = Vec::new();
    if !api_key.is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", api_key)));
    }
    headers.push(("X-Runway-Version".to_string(), "2024-11-06".to_string()));

    let http_req = HttpRequest {
        url,
        headers,
        body: None,
    };
    let resp = transport.get_body(http_req).await?;
    let text = String::from_utf8_lossy(&resp).to_string();

    // ComfyUI reports status as an object (`status.status_str`) and its
    // outputs as filenames that still need a `/view` fetch.
    if provider == COMFYUI_ID {
        if let Some(status) = text_status_str(&text) {
            if status == "error" {
                return Ok(MediaOutcome::Failed("ComfyUI reported an error".to_string()));
            }
            if status != "success" {
                return Ok(MediaOutcome::Pending(task_id.to_string()));
            }
        }
        return match comfyui_output_from_history(&text) {
            Ok((filename, subfolder, kind)) => {
                let url = comfyui_view_url(&base, &filename, &subfolder, &kind);
                Ok(MediaOutcome::Ready(url))
            }
            Err(_) => Ok(MediaOutcome::Pending(task_id.to_string())),
        };
    }

    // A task that failed says so in its status.
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    if let Some(status) = v.get("status").and_then(|s| s.as_str()) {
        let status = status.to_ascii_lowercase();
        if status == "failed" || status == "error" || status == "cancelled" {
            let reason = v
                .get("failure_reason")
                .or_else(|| v.get("error"))
                .and_then(|e| e.as_str())
                .unwrap_or(status.as_str());
            return Ok(MediaOutcome::Failed(reason.to_string()));
        }
        if status == "succeeded" || status == "completed" || status == "done" {
            return parse_media_url(&text)
                .map(MediaOutcome::Ready)
                .map_err(|e| format!("{e}: {}", truncate(&text, 200)));
        }
    }

    // Providers that do not report a status answer with the media once
    // it is there.
    match parse_media_url(&text) {
        Ok(url) => Ok(MediaOutcome::Ready(url)),
        Err(_) => Ok(MediaOutcome::Pending(task_id.to_string())),
    }
}

/// Truncate an error excerpt on a char boundary.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &s[..cut])
    }
}

/// The ComfyUI `status.status_str` of a history response, when present.
fn text_status_str(text: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    v.as_object()
        .and_then(|map| map.values().next())
        .and_then(|entry| entry.get("status"))
        .and_then(|status| status.get("status_str"))
        .and_then(|s| s.as_str())
        .map(str::to_ascii_lowercase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plain_url() {
        assert_eq!(
            parse_media_url(r#"{"url":"https://cdn.test/a.png"}"#).unwrap(),
            "https://cdn.test/a.png"
        );
    }

    #[test]
    fn parses_a_nested_url() {
        assert_eq!(
            parse_media_url(r#"{"output":{"url":"https://cdn.test/b.png"}}"#).unwrap(),
            "https://cdn.test/b.png"
        );
    }

    #[test]
    fn parses_a_url_in_a_list() {
        assert_eq!(
            parse_media_url(r#"{"data":[{"url":"https://cdn.test/c.png"}]}"#).unwrap(),
            "https://cdn.test/c.png"
        );
    }

    #[test]
    fn a_response_without_a_url_is_a_failure() {
        assert!(parse_media_url(r#"{"status":"queued"}"#).is_err());
    }

    #[test]
    fn a_broken_body_is_a_failure() {
        assert!(parse_media_url("not json").is_err());
    }

    #[test]
    fn parses_task_ids_in_the_shapes_providers_use() {
        assert_eq!(parse_task_id(r#"{"id":"t1"}"#).unwrap(), "t1");
        assert_eq!(parse_task_id(r#"{"task_id":"t2"}"#).unwrap(), "t2");
        assert_eq!(parse_task_id(r#"{"result":"t3"}"#).unwrap(), "t3");
    }

    #[test]
    fn a_response_without_a_task_id_is_a_failure() {
        assert!(parse_task_id(r#"{"status":"queued"}"#).is_err());
    }

    #[test]
    fn image_body_carries_the_prompt() {
        let req = MediaRequest {
            provider: "stability".into(),
            prompt: "a red fox".into(),
            ..Default::default()
        };
        let body = stability_image_body(&req);
        assert_eq!(body["prompt"], "a red fox");
        assert_eq!(body["output_format"], "png");
    }

    #[test]
    fn video_body_carries_the_prompt_and_ratio() {
        let req = MediaRequest {
            provider: "runway".into(),
            prompt: "a wave".into(),
            aspect_ratio: Some("9:16".into()),
            ..Default::default()
        };
        let body = runway_video_body(&req);
        assert_eq!(body["promptText"], "a wave");
        assert_eq!(body["ratio"], "9:16");
        assert_eq!(body["duration"], 5);
    }

    #[test]
    fn video_body_carries_the_seed_when_given() {
        let req = MediaRequest {
            provider: "runway".into(),
            prompt: "a wave".into(),
            seed: Some(42),
            ..Default::default()
        };
        assert_eq!(runway_video_body(&req)["seed"], 42);
    }

    #[test]
    fn model_body_switches_to_image_mode_with_an_image() {
        let req = MediaRequest {
            provider: "meshy".into(),
            prompt: "a chair".into(),
            image: Some("data:image/png;base64,AAA".into()),
            ..Default::default()
        };
        let body = meshy_model_body(&req);
        assert_eq!(body["mode"], "image_to_3d");
        assert_eq!(body["image_url"], "data:image/png;base64,AAA");
    }

    #[test]
    fn inpaint_fields_carry_the_prompt_and_the_negative_prompt() {
        let req = MediaRequest {
            provider: "stability".into(),
            prompt: "a red fox".into(),
            negative_prompt: Some("blurry".into()),
            ..Default::default()
        };
        let fields = stability_inpaint_fields(&req);
        assert!(fields.contains(&("prompt".to_string(), "a red fox".to_string())));
        assert!(fields.contains(&("negative_prompt".to_string(), "blurry".to_string())));
    }

    #[test]
    fn outcomes_expose_their_state() {
        let ready = MediaOutcome::Ready("https://cdn.test/a.png".into());
        assert!(ready.is_ready());
        assert_eq!(ready.url(), Some("https://cdn.test/a.png"));
        assert_eq!(ready.task_id(), None);

        let pending = MediaOutcome::Pending("t1".into());
        assert!(pending.is_pending());
        assert_eq!(pending.task_id(), Some("t1"));
        assert_eq!(pending.url(), None);
    }

    // ---- local backends (A1111 / ComfyUI) ----

    #[test]
    fn local_providers_default_to_localhost() {
        assert_eq!(default_base_url(A1111_ID), "http://127.0.0.1:7860");
        assert_eq!(default_base_url(COMFYUI_ID), "http://127.0.0.1:8188");
    }

    #[test]
    fn comfyui_works_asynchronously_but_a1111_does_not() {
        assert!(is_async_provider(COMFYUI_ID));
        assert!(!is_async_provider(A1111_ID));
    }

    #[test]
    fn aspect_sizes_cover_the_ratio_at_the_working_area() {
        assert_eq!(a1111_size(None), (512, 512));
        assert_eq!(a1111_size(Some("1:1")), (512, 512));
        // 16:9 → 680x384: multiples of 8, ~512² area, exact 680/384 ratio.
        let (w, h) = a1111_size(Some("16:9"));
        assert_eq!((w, h), (680, 384));
        // Portraits mirror the landscape numbers.
        assert_eq!(a1111_size(Some("9:16")), (384, 680));
        // Malformed aspects fall back to square.
        assert_eq!(a1111_size(Some("garbage")), (512, 512));
        assert_eq!(a1111_size(Some("0:0")), (512, 512));
    }

    #[test]
    fn a1111_txt2img_carries_prompt_steps_and_seed() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a red fox".into(),
            negative_prompt: Some("blurry".into()),
            aspect_ratio: Some("16:9".into()),
            seed: Some(7),
            ..Default::default()
        };
        let body = a1111_txt2img_body(&req);
        assert_eq!(body["prompt"], "a red fox");
        assert_eq!(body["negative_prompt"], "blurry");
        assert_eq!(body["steps"], LOCAL_SD_STEPS);
        assert_eq!(body["cfg_scale"], LOCAL_SD_CFG);
        assert_eq!(body["width"], 680);
        assert_eq!(body["height"], 384);
        assert_eq!(body["seed"], 7);
    }

    #[test]
    fn a1111_txt2img_defaults_to_a_random_seed() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a red fox".into(),
            ..Default::default()
        };
        assert_eq!(a1111_txt2img_body(&req)["seed"], -1);
    }

    #[test]
    fn a1111_switches_the_checkpoint_when_a_model_is_set() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a red fox".into(),
            model: Some("dreamshaper_8.safetensors".into()),
            ..Default::default()
        };
        let body = a1111_txt2img_body(&req);
        assert_eq!(body["override_settings"]["sd_model_checkpoint"], "dreamshaper_8.safetensors");
        assert_eq!(body["override_settings_restore_afterwards"], true);

        let no_model = a1111_txt2img_body(&MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a red fox".into(),
            ..Default::default()
        });
        assert!(no_model.get("override_settings").is_none());
    }

    #[test]
    fn a1111_img2img_carries_the_source_and_the_mask() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a red fox".into(),
            image: Some("data:image/png;base64,AAA".into()),
            mask: Some("data:image/png;base64,BBB".into()),
            ..Default::default()
        };
        let body = a1111_img2img_body(&req);
        assert_eq!(body["init_images"][0], "AAA");
        assert_eq!(body["mask"], "BBB");
        assert_eq!(body["denoising_strength"], 0.75);
        assert_eq!(body["inpaint_full_res"], true);
    }

    #[test]
    fn a1111_images_come_back_as_data_urls() {
        assert_eq!(
            parse_a1111_image(r#"{"images":["AAAA"]}"#).unwrap(),
            "data:image/png;base64,AAAA"
        );
        assert_eq!(
            parse_a1111_image(r#"{"images":["data:image/png;base64,AAAA"]}"#).unwrap(),
            "data:image/png;base64,AAAA"
        );
        assert!(parse_a1111_image(r#"{"images":[]}"#).is_err());
        assert!(parse_a1111_image("not json").is_err());
    }

    #[test]
    fn data_urls_are_stripped_to_raw_base64() {
        assert_eq!(strip_data_url("data:image/png;base64,AAA"), "AAA");
        assert_eq!(strip_data_url("AAA"), "AAA");
    }

    #[test]
    fn the_comfyui_graph_is_a_wired_txt2img_chain() {
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a red fox".into(),
            aspect_ratio: Some("16:9".into()),
            seed: Some(9),
            ..Default::default()
        };
        let wf = comfyui_workflow_body(&req, "v1-5-pruned.safetensors");
        assert_eq!(wf["1"]["class_type"], "CheckpointLoaderSimple");
        assert_eq!(wf["1"]["inputs"]["ckpt_name"], "v1-5-pruned.safetensors");
        assert_eq!(wf["2"]["inputs"]["text"], "a red fox");
        assert_eq!(wf["2"]["inputs"]["clip"], serde_json::json!(["1", 1]));
        assert_eq!(wf["4"]["inputs"]["width"], 680);
        assert_eq!(wf["5"]["inputs"]["seed"], 9);
        assert_eq!(wf["5"]["inputs"]["positive"], serde_json::json!(["2", 0]));
        assert_eq!(wf["6"]["inputs"]["samples"], serde_json::json!(["5", 0]));
        assert_eq!(wf["7"]["inputs"]["images"], serde_json::json!(["6", 0]));
        assert_eq!(wf["7"]["inputs"]["filename_prefix"], COMFYUI_FILENAME_PREFIX);
    }

    #[test]
    fn the_checkpoint_is_resolved_from_object_info() {
        let info = r#"{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["a.safetensors","b.safetensors"],{"foo":1}]}}}}"#;
        assert_eq!(comfyui_pick_checkpoint(info, Some("b.safetensors")).unwrap(), "b.safetensors");
        // A model the install does not have falls back to the first.
        assert_eq!(comfyui_pick_checkpoint(info, Some("missing.safetensors")).unwrap(), "a.safetensors");
        assert_eq!(comfyui_pick_checkpoint(info, None).unwrap(), "a.safetensors");
        assert!(comfyui_pick_checkpoint("{}", None).is_err());
    }

    #[test]
    fn history_images_become_view_urls() {
        assert_eq!(
            comfyui_view_url("http://127.0.0.1:8188", "prism_00001_.png", "", "output"),
            "http://127.0.0.1:8188/view?filename=prism_00001_.png&subfolder=&type=output"
        );
        // Filenames with reserved characters are encoded.
        assert_eq!(
            comfyui_view_url("http://h", "a b&c.png", "sub/1", "output"),
            "http://h/view?filename=a%20b%26c.png&subfolder=sub%2F1&type=output"
        );
    }

    #[test]
    fn the_first_history_image_wins() {
        let history = r#"{"abc":{"outputs":{"7":{"images":[{"filename":"prism_00001_.png","subfolder":"","type":"output"}]}}}}"#;
        let (filename, subfolder, kind) = comfyui_image_from_history(history).unwrap();
        assert_eq!(filename, "prism_00001_.png");
        assert_eq!(subfolder, "");
        assert_eq!(kind, "output");
        assert!(comfyui_image_from_history(r#"{"abc":{"outputs":{}}}"#).is_err());
        assert!(comfyui_image_from_history("not json").is_err());
    }

    #[test]
    fn a_history_status_is_read_from_the_first_entry() {
        assert_eq!(
            text_status_str(r#"{"abc":{"status":{"status_str":"error","completed":false}}}"#),
            Some("error".to_string())
        );
        assert_eq!(
            text_status_str(r#"{"abc":{"status":{"status_str":"success"}}}"#),
            Some("success".to_string())
        );
        assert_eq!(text_status_str("not json"), None);
    }

    // ---- ComfyUI img2img / inpaint / AnimateDiff ----

    #[test]
    fn base64_decodes_with_and_without_padding() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("aGVsbG8").unwrap(), b"hello");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert_eq!(base64_decode("AA==\n").unwrap(), vec![0]);
        assert!(base64_decode("a$b").is_err());
    }

    #[test]
    fn data_urls_decode_to_bytes_and_mime() {
        let (bytes, mime) = decode_data_url("data:image/png;base64,aGVsbG8=")
            .unwrap()
            .unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(mime, "image/png");
        // Remote URLs are not data URLs; the caller fetches them.
        assert!(decode_data_url("https://cdn.test/a.png").unwrap().is_none());
        assert!(decode_data_url("data:image/png,raw").is_err());
        assert!(decode_data_url("data:image/png;base64").is_err());
    }

    #[test]
    fn the_upload_body_is_multipart_with_the_file_and_flags() {
        let upload = comfyui_upload_body("prism-source.png", b"\x89PNG");
        assert_eq!(
            upload.content_type,
            format!("multipart/form-data; boundary={COMFYUI_UPLOAD_BOUNDARY}")
        );
        let text = String::from_utf8_lossy(&upload.body);
        assert!(text.contains("name=\"image\"; filename=\"prism-source.png\""));
        assert!(text.contains("name=\"overwrite\""));
        assert!(text.contains("name=\"type\""));
        assert!(text.contains("input"));
        assert!(text.ends_with("--\r\n"));
        assert!(upload.body.windows(4).any(|w| w == b"\x89PNG"));
    }

    #[test]
    fn upload_filenames_strip_header_breakers() {
        let upload = comfyui_upload_body("a\"b\r\nc.png", b"x");
        let text = String::from_utf8_lossy(&upload.body);
        assert!(text.contains("filename=\"a_b__c.png\""));
    }

    #[test]
    fn the_upload_name_is_read_from_the_response() {
        assert_eq!(
            comfyui_upload_name(r#"{"name":"prism-source.png","subfolder":"","type":"input"}"#)
                .unwrap(),
            "prism-source.png"
        );
        assert_eq!(
            comfyui_upload_name(r#"{"name":"a.png","subfolder":"sub"}"#).unwrap(),
            "sub/a.png"
        );
        assert!(comfyui_upload_name(r#"{"name":""}"#).is_err());
        assert!(comfyui_upload_name("not json").is_err());
    }

    #[test]
    fn the_img2img_graph_encodes_the_uploaded_image() {
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a red fox".into(),
            seed: Some(3),
            ..Default::default()
        };
        let wf = comfyui_img2img_workflow(&req, "v1-5.safetensors", "prism-source.png");
        assert_eq!(wf["4"]["class_type"], "LoadImage");
        assert_eq!(wf["4"]["inputs"]["image"], "prism-source.png");
        assert_eq!(wf["5"]["class_type"], "VAEEncode");
        assert_eq!(wf["5"]["inputs"]["pixels"], serde_json::json!(["4", 0]));
        assert_eq!(wf["6"]["inputs"]["latent_image"], serde_json::json!(["5", 0]));
        assert_eq!(wf["6"]["inputs"]["denoise"], 0.75);
        assert_eq!(wf["8"]["inputs"]["images"], serde_json::json!(["7", 0]));
    }

    #[test]
    fn the_inpaint_graph_masks_and_grows_the_hole() {
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a red fox".into(),
            ..Default::default()
        };
        let wf = comfyui_inpaint_workflow(&req, "v1-5.safetensors", "src.png", "mask.png");
        assert_eq!(wf["4"]["class_type"], "LoadImage");
        assert_eq!(wf["5"]["class_type"], "LoadImageMask");
        assert_eq!(wf["5"]["inputs"]["channel"], "red");
        assert_eq!(wf["6"]["class_type"], "VAEEncodeForInpaint");
        assert_eq!(wf["6"]["inputs"]["mask"], serde_json::json!(["5", 0]));
        assert_eq!(wf["6"]["inputs"]["grow_mask_by"], 6);
        assert_eq!(wf["7"]["inputs"]["latent_image"], serde_json::json!(["6", 0]));
        assert_eq!(wf["9"]["inputs"]["images"], serde_json::json!(["8", 0]));
    }

    #[test]
    fn the_animatediff_graph_batches_frames_and_saves_mp4() {
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a wave".into(),
            duration: Some(2),
            seed: Some(4),
            ..Default::default()
        };
        let wf = comfyui_animatediff_workflow(&req, "v1-5.safetensors", "mm_sd15_v3.ckpt");
        assert_eq!(wf["4"]["class_type"], "ADE_AnimateDiffLoaderGen1");
        assert_eq!(wf["4"]["inputs"]["model_name"], "mm_sd15_v3.ckpt");
        assert_eq!(wf["4"]["inputs"]["model"], serde_json::json!(["1", 0]));
        assert_eq!(wf["5"]["inputs"]["batch_size"], 16);
        assert_eq!(wf["6"]["inputs"]["model"], serde_json::json!(["4", 0]));
        assert_eq!(wf["8"]["class_type"], "VHS_VideoCombine");
        assert_eq!(wf["8"]["inputs"]["format"], "video/h264-mp4");
        assert_eq!(wf["8"]["inputs"]["frame_rate"], COMFYUI_VIDEO_FPS);
        assert_eq!(wf["8"]["inputs"]["images"], serde_json::json!(["7", 0]));
    }

    #[test]
    fn frames_follow_the_duration_with_a_sane_default() {
        assert_eq!(comfyui_frames(None), 16);
        assert_eq!(comfyui_frames(Some(0)), 16);
        assert_eq!(comfyui_frames(Some(1)), 8);
        assert_eq!(comfyui_frames(Some(2)), 16);
        assert_eq!(comfyui_frames(Some(10)), 32);
    }

    #[test]
    fn the_motion_module_is_resolved_from_its_own_node() {
        let info = r#"{"ADE_AnimateDiffLoaderGen1":{"input":{"required":{"model_name":[["mm_sd15_v3.ckpt","mm_sdxl.ckpt"],{}]}}}}"#;
        assert_eq!(
            comfyui_pick_option(
                info,
                "ADE_AnimateDiffLoaderGen1",
                "model_name",
                Some("mm_sdxl.ckpt")
            )
            .unwrap(),
            "mm_sdxl.ckpt"
        );
        assert_eq!(
            comfyui_pick_option(info, "ADE_AnimateDiffLoaderGen1", "model_name", None).unwrap(),
            "mm_sd15_v3.ckpt"
        );
        assert!(comfyui_pick_option("{}", "ADE_AnimateDiffLoaderGen1", "model_name", None).is_err());
    }

    #[test]
    fn video_history_outputs_are_found_under_gifs_and_videos() {
        let history = r#"{"abc":{"outputs":{"8":{"gifs":[{"filename":"prism_00001.mp4","subfolder":"","type":"output","format":"video/h264-mp4"}]}}}}"#;
        let (filename, _, kind) = comfyui_output_from_history(history).unwrap();
        assert_eq!(filename, "prism_00001.mp4");
        assert_eq!(kind, "output");

        let videos = r#"{"abc":{"outputs":{"8":{"videos":[{"filename":"clip.webm","subfolder":"v","type":"output"}]}}}}"#;
        assert_eq!(
            comfyui_output_from_history(videos).unwrap(),
            ("clip.webm".to_string(), "v".to_string(), "output".to_string())
        );
    }

    // ---- full SD option set ----

    #[test]
    fn base64_roundtrips_with_padding() {
        for sample in [b"".as_slice(), b"a", b"ab", b"abc", b"\x00\xFF\x10"] {
            assert_eq!(base64_decode(&base64_encode(sample)).unwrap(), sample);
        }
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn explicit_size_overrides_the_aspect_and_clamps() {
        let req = MediaRequest {
            aspect_ratio: Some("16:9".into()),
            ..Default::default()
        };
        assert_eq!(sd_size(&req), (680, 384));

        let req = MediaRequest {
            width: Some(100),
            height: Some(70),
            ..Default::default()
        };
        assert_eq!(sd_size(&req), (104, 72));

        let req = MediaRequest {
            width: Some(4000),
            ..Default::default()
        };
        assert_eq!(sd_size(&req).0, 2048);
    }

    #[test]
    fn sd_knobs_are_clamped_to_sane_ranges() {
        let req = MediaRequest {
            steps: Some(0),
            cfg: Some(99.0),
            batch: Some(99),
            clip_skip: Some(0),
            denoise: Some(3.0),
            ..Default::default()
        };
        assert_eq!(sd_steps(&req), 1);
        assert_eq!(sd_cfg(&req), 30.0);
        assert_eq!(sd_batch(&req), MAX_BATCH);
        assert_eq!(sd_clip_skip(&req), 1);
        assert_eq!(sd_denoise(&req, 1.0), 1.0);
        assert_eq!(sd_sampler(&req), DEFAULT_SAMPLER);
        assert_eq!(sd_scheduler(&req), DEFAULT_SCHEDULER);
    }

    #[test]
    fn a1111_honours_every_sd_option() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a fox".into(),
            steps: Some(30),
            cfg: Some(5.5),
            sampler: Some("dpmpp_2m".into()),
            scheduler: Some("karras".into()),
            batch: Some(3),
            width: Some(640),
            height: Some(384),
            vae: Some("vae-ft.safetensors".into()),
            clip_skip: Some(2),
            loras: vec![LoraSpec {
                name: "detail.safetensors".into(),
                weight: 0.8,
            }],
            ..Default::default()
        };
        let body = a1111_txt2img_body(&req);
        assert_eq!(body["steps"], 30);
        assert_eq!(body["cfg_scale"], 5.5);
        assert_eq!(body["batch_size"], 3);
        assert_eq!(body["width"], 640);
        assert_eq!(body["height"], 384);
        assert_eq!(body["sampler_name"], "DPM++ 2M Karras");
        assert!(body["prompt"]
            .as_str()
            .unwrap()
            .contains("<lora:detail.safetensors:0.8>"));
        assert_eq!(body["override_settings"]["sd_vae"], "vae-ft.safetensors");
        assert_eq!(
            body["override_settings"]["CLIP_stop_at_last_layers"],
            2
        );
    }

    #[test]
    fn a1111_img2img_takes_the_requested_denoise() {
        let req = MediaRequest {
            provider: A1111_ID.into(),
            prompt: "a fox".into(),
            image: Some("data:image/png;base64,AAA".into()),
            denoise: Some(0.4),
            ..Default::default()
        };
        assert_eq!(a1111_img2img_body(&req)["denoising_strength"], 0.4);
    }

    #[test]
    fn comfyui_wires_loras_vae_and_clip_skip() {
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a fox".into(),
            vae: Some("vae.safetensors".into()),
            clip_skip: Some(2),
            loras: vec![
                LoraSpec {
                    name: "a.safetensors".into(),
                    weight: 0.7,
                },
                LoraSpec {
                    name: "b.safetensors".into(),
                    weight: 1.0,
                },
            ],
            ..Default::default()
        };
        let wf = comfyui_workflow_body(&req, "ckpt.safetensors");

        assert_eq!(wf["8"]["class_type"], "CLIPSetLastLayer");
        assert_eq!(wf["8"]["inputs"]["stop_at_clip_layer"], -2);
        assert_eq!(wf["9"]["class_type"], "LoraLoader");
        assert_eq!(wf["9"]["inputs"]["clip"], serde_json::json!(["8", 0]));
        assert_eq!(wf["9"]["inputs"]["lora_name"], "a.safetensors");
        assert_eq!(wf["10"]["class_type"], "LoraLoader");
        assert_eq!(wf["10"]["inputs"]["model"], serde_json::json!(["9", 0]));
        assert_eq!(wf["10"]["inputs"]["clip"], serde_json::json!(["9", 1]));
        assert_eq!(wf["11"]["class_type"], "VAELoader");
        assert_eq!(wf["11"]["inputs"]["vae_name"], "vae.safetensors");

        // The encoders use the last LoRA's CLIP, the sampler its model,
        // and the decoder the loaded VAE.
        assert_eq!(wf["2"]["inputs"]["clip"], serde_json::json!(["10", 1]));
        assert_eq!(wf["3"]["inputs"]["clip"], serde_json::json!(["10", 1]));
        assert_eq!(wf["5"]["inputs"]["model"], serde_json::json!(["10", 0]));
        assert_eq!(wf["6"]["inputs"]["vae"], serde_json::json!(["11", 0]));
    }

    #[test]
    fn comfyui_sampler_knobs_reach_the_ksampler() {
        let req = MediaRequest {
            prompt: "a fox".into(),
            steps: Some(35),
            cfg: Some(4.5),
            sampler: Some("dpmpp_2m_sde".into()),
            scheduler: Some("karras".into()),
            batch: Some(2),
            seed: Some(77),
            denoise: Some(0.6),
            width: Some(512),
            height: Some(768),
            ..Default::default()
        };
        let wf = comfyui_workflow_body(&req, "ckpt");
        assert_eq!(wf["5"]["inputs"]["steps"], 35);
        assert_eq!(wf["5"]["inputs"]["cfg"], 4.5);
        assert_eq!(wf["5"]["inputs"]["sampler_name"], "dpmpp_2m_sde");
        assert_eq!(wf["5"]["inputs"]["scheduler"], "karras");
        assert_eq!(wf["5"]["inputs"]["seed"], 77);
        assert_eq!(wf["5"]["inputs"]["denoise"], 0.6);
        assert_eq!(wf["4"]["inputs"]["batch_size"], 2);
        assert_eq!(wf["4"]["inputs"]["width"], 512);
        assert_eq!(wf["4"]["inputs"]["height"], 768);
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn the_native_provider_needs_no_transport() {
        let t = mock::MockTransport::new(vec![]);
        let req = MediaRequest {
            provider: NATIVE_ID.into(),
            prompt: "a fox".into(),
            width: Some(64),
            height: Some(64),
            seed: Some(1),
            ..Default::default()
        };
        let outcome = run_media(&t, MediaKind::Image, &req).await.unwrap();
        assert!(outcome
            .url()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(t.calls.lock().unwrap().is_empty());
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn the_candle_provider_is_dispatched_in_process_without_http() {
        let t = mock::MockTransport::new(vec![]);
        let dir = tempfile::tempdir().unwrap();
        let req = MediaRequest {
            provider: CANDLE_ID.into(),
            base_url: dir.path().to_string_lossy().to_string(),
            prompt: "a fox".into(),
            width: Some(64),
            height: Some(64),
            ..Default::default()
        };
        let error = run_media(&t, MediaKind::Image, &req)
            .await
            .expect_err("no weights in an empty tempdir");
        #[cfg(feature = "candle-sd")]
        assert!(error.contains("tokenizer"), "{error}");
        #[cfg(not(feature = "candle-sd"))]
        assert!(error.contains("candle-sd feature"), "{error}");
        assert!(t.calls.lock().unwrap().is_empty());
    }

    /// A scripted transport: records every call and answers from a
    /// queue, so a whole ComfyUI flow can be replayed without sockets.
    #[cfg(feature = "native-transport")]
    mod mock {
        use super::*;
        use std::collections::VecDeque;
        use std::sync::Mutex;

        #[derive(Debug, Clone, PartialEq)]
        pub enum Call {
            Get(String),
            Post(String, Option<String>),
            PostBytes(String, Vec<u8>, String),
        }

        pub struct MockTransport {
            pub calls: Mutex<Vec<Call>>,
            pub responses: Mutex<VecDeque<Result<Vec<u8>, String>>>,
        }

        impl MockTransport {
            pub fn new(responses: Vec<&str>) -> Self {
                Self {
                    calls: Mutex::new(Vec::new()),
                    responses: Mutex::new(
                        responses
                            .into_iter()
                            .map(|s| Ok(s.as_bytes().to_vec()))
                            .collect(),
                    ),
                }
            }

            fn next(&self) -> Result<Vec<u8>, String> {
                self.responses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or_else(|| Err("unexpected call".to_string()))
            }
        }

        #[async_trait::async_trait]
        impl Transport for MockTransport {
            async fn post_stream(
                &self,
                _req: HttpRequest,
            ) -> Result<crate::transport::ByteStream, String> {
                Err("not used in this test".to_string())
            }

            async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
                self.calls
                    .lock()
                    .unwrap()
                    .push(Call::Post(req.url, req.body));
                self.next()
            }

            async fn get_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
                self.calls.lock().unwrap().push(Call::Get(req.url));
                self.next()
            }

            async fn post_bytes(
                &self,
                req: HttpRequest,
                body: Vec<u8>,
                content_type: &str,
            ) -> Result<Vec<u8>, String> {
                self.calls.lock().unwrap().push(Call::PostBytes(
                    req.url,
                    body,
                    content_type.to_string(),
                ));
                self.next()
            }
        }
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn comfyui_img2img_uploads_the_source_then_queues() {
        let t = mock::MockTransport::new(vec![
            r#"{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["a.safetensors"],{}]}}}}"#,
            r#"{"name":"prism-source.png","subfolder":"","type":"input"}"#,
            r#"{"prompt_id":"p1"}"#,
        ]);
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a red fox".into(),
            image: Some("data:image/png;base64,aGVsbG8=".into()),
            ..Default::default()
        };
        let outcome = run_media(&t, MediaKind::Image, &req).await.unwrap();
        assert_eq!(outcome, MediaOutcome::Pending("p1".into()));

        let calls = t.calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(matches!(
            &calls[0],
            mock::Call::Get(url) if url.ends_with("/object_info/CheckpointLoaderSimple")
        ));
        match &calls[1] {
            mock::Call::PostBytes(url, body, content_type) => {
                assert!(url.ends_with("/upload/image"));
                assert!(content_type.starts_with("multipart/form-data; boundary="));
                assert!(body.windows(5).any(|w| w == b"hello".as_slice()));
            }
            other => panic!("expected the binary upload, got {other:?}"),
        }
        match &calls[2] {
            mock::Call::Post(url, body) => {
                assert!(url.ends_with("/prompt"));
                let wf: serde_json::Value =
                    serde_json::from_str(body.as_deref().unwrap()).unwrap();
                assert_eq!(wf["4"]["class_type"], "LoadImage");
                assert_eq!(wf["4"]["inputs"]["image"], "prism-source.png");
                assert_eq!(wf["6"]["inputs"]["denoise"], 0.75);
            }
            other => panic!("expected the prompt queue, got {other:?}"),
        }
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn comfyui_inpaint_uploads_the_source_and_the_mask() {
        let t = mock::MockTransport::new(vec![
            r#"{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["a.safetensors"],{}]}}}}"#,
            r#"{"name":"prism-source.png","subfolder":"","type":"input"}"#,
            r#"{"name":"prism-mask.png","subfolder":"","type":"input"}"#,
            r#"{"prompt_id":"p2"}"#,
        ]);
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "fix the sky".into(),
            image: Some("data:image/png;base64,aGVsbG8=".into()),
            mask: Some("data:image/png;base64,d29ybGQ=".into()),
            ..Default::default()
        };
        let outcome = run_media(&t, MediaKind::Inpaint, &req).await.unwrap();
        assert_eq!(outcome, MediaOutcome::Pending("p2".into()));

        let calls = t.calls.lock().unwrap();
        assert_eq!(calls.len(), 4);
        assert!(matches!(
            &calls[1],
            mock::Call::PostBytes(url, _, _) if url.ends_with("/upload/image")
        ));
        assert!(matches!(
            &calls[2],
            mock::Call::PostBytes(url, _, _) if url.ends_with("/upload/image")
        ));
        match &calls[3] {
            mock::Call::Post(url, body) => {
                assert!(url.ends_with("/prompt"));
                let wf: serde_json::Value =
                    serde_json::from_str(body.as_deref().unwrap()).unwrap();
                assert_eq!(wf["5"]["class_type"], "LoadImageMask");
                assert_eq!(wf["6"]["class_type"], "VAEEncodeForInpaint");
                assert_eq!(wf["6"]["inputs"]["mask"], serde_json::json!(["5", 0]));
            }
            other => panic!("expected the prompt queue, got {other:?}"),
        }
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn comfyui_inpaint_requires_a_mask_before_calling_out() {
        let t = mock::MockTransport::new(vec![]);
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "fix the sky".into(),
            image: Some("data:image/png;base64,aGVsbG8=".into()),
            ..Default::default()
        };
        let err = run_media(&t, MediaKind::Inpaint, &req).await.unwrap_err();
        assert!(err.contains("mask"));
        assert!(t.calls.lock().unwrap().is_empty());
    }

    #[cfg(feature = "native-transport")]
    #[tokio::test]
    async fn comfyui_video_resolves_the_motion_module() {
        let t = mock::MockTransport::new(vec![
            r#"{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["a.safetensors"],{}]}}}}"#,
            r#"{"ADE_AnimateDiffLoaderGen1":{"input":{"required":{"model_name":[["mm_sd15_v3.ckpt"],{}]}}}}"#,
            r#"{"prompt_id":"p3"}"#,
        ]);
        let req = MediaRequest {
            provider: COMFYUI_ID.into(),
            prompt: "a wave".into(),
            model: Some("mm_sd15_v3.ckpt".into()),
            duration: Some(2),
            ..Default::default()
        };
        let outcome = run_media(&t, MediaKind::Video, &req).await.unwrap();
        assert_eq!(outcome, MediaOutcome::Pending("p3".into()));

        let calls = t.calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(matches!(
            &calls[0],
            mock::Call::Get(url) if url.ends_with("/object_info/CheckpointLoaderSimple")
        ));
        assert!(matches!(
            &calls[1],
            mock::Call::Get(url) if url.ends_with("/object_info/ADE_AnimateDiffLoaderGen1")
        ));
        match &calls[2] {
            mock::Call::Post(url, body) => {
                assert!(url.ends_with("/prompt"));
                let wf: serde_json::Value =
                    serde_json::from_str(body.as_deref().unwrap()).unwrap();
                assert_eq!(wf["4"]["inputs"]["model_name"], "mm_sd15_v3.ckpt");
                assert_eq!(wf["5"]["inputs"]["batch_size"], 16);
                assert_eq!(wf["8"]["class_type"], "VHS_VideoCombine");
            }
            other => panic!("expected the prompt queue, got {other:?}"),
        }
    }
}
