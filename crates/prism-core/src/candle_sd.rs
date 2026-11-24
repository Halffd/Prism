//! Real Stable Diffusion inference with Candle (feature `candle-sd`).
//!
//! Unlike [`crate::native_sd`], this module runs actual neural weights:
//! a CLIP text encoder, a diffusion UNet, and a VAE decoder loaded from a
//! local Diffusers-style model directory. No network, no Python, no
//! model downloads are performed here — the host supplies the weights.
//!
//! Expected layout (single-file safetensors):
//!
//! ```text
//! <model-dir>/
//!   tokenizer/tokenizer.json
//!   text_encoder/model.safetensors          (or model.fp16.safetensors)
//!   unet/diffusion_pytorch_model.safetensors (or *.fp16.safetensors)
//!   vae/diffusion_pytorch_model.safetensors  (or *.fp16.safetensors)
//!   # SDXL additionally:
//!   tokenizer_2/tokenizer.json
//!   text_encoder_2/model.safetensors
//! ```
//!
//! The model directory goes in `MediaRequest.base_url` (a plain path or
//! `file://` URI); `MediaRequest.model` selects the version:
//! `v1-5` (default), `v2-1`, `sdxl`, or `sdxl-turbo`.
//!
//! Many SD 1.5 repos ship only `tokenizer/vocab.json` and
//! `tokenizer/merges.txt`. Their vocabulary and merges are identical to
//! `openai/clip-vit-large-patch14`, so that repo's `tokenizer.json` can be
//! placed at `tokenizer/tokenizer.json` unchanged (verified by comparing all
//! 49,408 vocabulary entries and 48,894 merge rules).

use crate::media::{
    base64_encode, sd_batch, sd_cfg, sd_sampler, sd_scheduler, sd_size, sd_steps, MediaKind,
    MediaRequest,
};
use crate::native_sd::RenderedImage;
use candle_core::{D, DType, Device, IndexOp, Module, Tensor};
use candle_transformers::models::stable_diffusion as sd;
use candle_transformers::models::stable_diffusion::ddim::DDIMSchedulerConfig;
use candle_transformers::models::stable_diffusion::euler_ancestral_discrete::{
    EulerAncestralDiscreteSchedulerConfig,
};
use candle_transformers::models::stable_diffusion::schedulers::{Scheduler, SchedulerConfig};
use candle_transformers::models::stable_diffusion::uni_pc::UniPCSchedulerConfig;
use std::path::{Path, PathBuf};
use tokenizers::Tokenizer;

/// Which architecture the weights belong to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelVersion {
    V15,
    V21,
    Sdxl,
    SdxlTurbo,
}

impl ModelVersion {
    /// Parse an explicit version id (`v1-5`, `v2-1`, `sdxl`, `sdxl-turbo`).
    pub fn parse(value: &str) -> Result<Self, String> {
        let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
        match normalized.as_str() {
            "" | "v1-5" | "v1.5" | "sd1-5" | "sd1.5" => Ok(Self::V15),
            "v2-1" | "v2.1" | "sd2-1" | "sd2.1" => Ok(Self::V21),
            "sdxl" | "xl" => Ok(Self::Sdxl),
            "sdxl-turbo" | "turbo" => Ok(Self::SdxlTurbo),
            other => Err(format!(
                "unknown Candle SD model version '{other}' (use v1-5, v2-1, sdxl, sdxl-turbo)"
            )),
        }
    }

    /// Guess from a directory name when the request does not specify one.
    pub fn detect(root: &Path) -> Self {
        let name = root
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if name.contains("turbo") {
            Self::SdxlTurbo
        } else if name.contains("xl") || name.contains("sdxl") {
            Self::Sdxl
        } else if name.contains("2-1") || name.contains("2.1") || name.contains("v2") {
            Self::V21
        } else {
            Self::V15
        }
    }

    fn config(self) -> sd::StableDiffusionConfig {
        match self {
            Self::V15 => sd::StableDiffusionConfig::v1_5(None, None, None),
            Self::V21 => sd::StableDiffusionConfig::v2_1(None, None, None),
            Self::Sdxl => sd::StableDiffusionConfig::sdxl(None, None, None),
            Self::SdxlTurbo => sd::StableDiffusionConfig::sdxl_turbo(None, None, None),
        }
    }

    fn vae_scale(self) -> f64 {
        match self {
            Self::V15 | Self::V21 | Self::Sdxl => 0.18215,
            Self::SdxlTurbo => 0.13025,
        }
    }

    fn in_channels(self) -> usize {
        // This backend is txt2img-only; inpaint checkpoints would need 9.
        4
    }
}

/// Resolved weight files for one model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelPaths {
    pub tokenizer: PathBuf,
    pub text_encoder: PathBuf,
    pub unet: PathBuf,
    pub vae: PathBuf,
    pub tokenizer_2: Option<PathBuf>,
    pub text_encoder_2: Option<PathBuf>,
    /// DType to load UNet/VAE with (F32 when f32 weights exist).
    pub dtype: WeightDType,
}

/// Serialisable view of the weight precision, so discovery is testable
/// without depending on Candle's `DType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightDType {
    F32,
    F16,
}

impl WeightDType {
    fn candle(self) -> DType {
        match self {
            Self::F32 => DType::F32,
            Self::F16 => DType::F16,
        }
    }
}

fn pick_weight(dir: &Path, f32_name: &str, f16_name: &str, label: &str) -> Result<(PathBuf, bool), String> {
    let f32 = dir.join(f32_name);
    let f16 = dir.join(f16_name);
    if f32.is_file() {
        Ok((f32, false))
    } else if f16.is_file() {
        Ok((f16, true))
    } else {
        Err(format!(
            "missing {label} weights: expected {} or {}",
            f32.display(),
            f16.display()
        ))
    }
}

fn require_file(path: PathBuf, label: &str) -> Result<PathBuf, String> {
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("missing {label}: {}", path.display()))
    }
}

impl ModelPaths {
    /// Discover the canonical single-file layout under `root`.
    pub fn from_dir(root: &Path, version: ModelVersion) -> Result<Self, String> {
        let tokenizer = require_file(root.join("tokenizer/tokenizer.json"), "tokenizer")?;
        let (text_encoder, _clip_f16) = pick_weight(
            &root.join("text_encoder"),
            "model.safetensors",
            "model.fp16.safetensors",
            "CLIP",
        )?;
        let (unet, unet_f16) = pick_weight(
            &root.join("unet"),
            "diffusion_pytorch_model.safetensors",
            "diffusion_pytorch_model.fp16.safetensors",
            "UNet",
        )?;
        let (vae, vae_f16) = pick_weight(
            &root.join("vae"),
            "diffusion_pytorch_model.safetensors",
            "diffusion_pytorch_model.fp16.safetensors",
            "VAE",
        )?;

        let (tokenizer_2, text_encoder_2) = if matches!(
            version,
            ModelVersion::Sdxl | ModelVersion::SdxlTurbo
        ) {
            let tokenizer_2 =
                require_file(root.join("tokenizer_2/tokenizer.json"), "second tokenizer")?;
            let (text_encoder_2, _) = pick_weight(
                &root.join("text_encoder_2"),
                "model.safetensors",
                "model.fp16.safetensors",
                "second CLIP",
            )?;
            (Some(tokenizer_2), Some(text_encoder_2))
        } else {
            (None, None)
        };

        // CLIP is loaded as F32 separately; this dtype is for UNet/VAE.
        let dtype = if unet_f16 || vae_f16 {
            WeightDType::F16
        } else {
            WeightDType::F32
        };
        Ok(Self {
            tokenizer,
            text_encoder,
            unet,
            vae,
            tokenizer_2,
            text_encoder_2,
            dtype,
        })
    }
}

/// A loaded Candle Stable Diffusion pipeline. Reuse it across requests:
/// loading weights is the expensive part.
pub struct CandleSd {
    version: ModelVersion,
    paths: ModelPaths,
    config: sd::StableDiffusionConfig,
    device: Device,
    dtype: DType,
    tokenizer: Tokenizer,
    text_model: sd::clip::ClipTextTransformer,
    tokenizer_2: Option<Tokenizer>,
    text_model_2: Option<sd::clip::ClipTextTransformer>,
    vae: sd::vae::AutoEncoderKL,
    unet: sd::unet_2d::UNet2DConditionModel,
}

impl CandleSd {
    /// Load every component from a local model directory.
    pub fn load(root: &Path, version: Option<&str>) -> Result<Self, String> {
        let version = match version {
            Some(value) if !value.trim().is_empty() => ModelVersion::parse(value)?,
            _ => ModelVersion::detect(root),
        };
        let paths = ModelPaths::from_dir(root, version)?;
        let device = Device::Cpu;
        let dtype = paths.dtype.candle();
        let config = version.config();

        let tokenizer = Tokenizer::from_file(&paths.tokenizer)
            .map_err(|error| format!("cannot load tokenizer: {error}"))?;
        // Candle's example keeps CLIP in F32 even for fp16 checkpoints.
        let text_model = sd::build_clip_transformer(
            &config.clip,
            &paths.text_encoder,
            &device,
            DType::F32,
        )
        .map_err(err)?;

        let (tokenizer_2, text_model_2) = match (&paths.tokenizer_2, &paths.text_encoder_2) {
            (Some(tokenizer_path), Some(weights_path)) => {
                let tokenizer = Tokenizer::from_file(tokenizer_path)
                    .map_err(|error| format!("cannot load second tokenizer: {error}"))?;
                let clip2_config = config
                    .clip2
                    .as_ref()
                    .ok_or_else(|| "model version has no second CLIP config".to_string())?;
                let model = sd::build_clip_transformer(clip2_config, weights_path, &device, DType::F32)
                    .map_err(err)?;
                (Some(tokenizer), Some(model))
            }
            _ => (None, None),
        };

        let vae = config.build_vae(&paths.vae, &device, dtype).map_err(err)?;
        let unet = config
            .build_unet(&paths.unet, &device, version.in_channels(), false, dtype)
            .map_err(err)?;

        Ok(Self {
            version,
            paths,
            config,
            device,
            dtype,
            tokenizer,
            text_model,
            tokenizer_2,
            text_model_2,
            vae,
            unet,
        })
    }

    /// Model directory this pipeline was loaded from.
    pub fn model_dir(&self) -> &Path {
        self.paths.tokenizer.parent().and_then(Path::parent).unwrap_or_else(|| Path::new(""))
    }

    /// Run text-to-image inference and return RGBA8 pixels.
    pub fn render(&self, req: &MediaRequest) -> Result<RenderedImage, String> {
        if req.image.is_some() || req.mask.is_some() {
            return Err(
                "the Candle backend supports txt2img only (no img2img/inpaint yet)".to_string(),
            );
        }
        let (width, height) = sd_size(req);
        if width % 8 != 0 || height % 8 != 0 {
            return Err(format!(
                "Candle SD needs dimensions divisible by 8 (got {width}x{height})"
            ));
        }
        let steps = sd_steps(req) as usize;
        let batch = sd_batch(req) as usize;
        let cfg = sd_cfg(req);
        let clip_skip = req.clip_skip.unwrap_or(1).max(1);
        let sampler = sd_sampler(req);
        let schedule = sd_scheduler(req);
        let seed = req.seed.unwrap_or_else(random_seed);

        let cond = self.text_embedding(&self.tokenizer, &self.text_model, &self.config.clip, &req.prompt, clip_skip)?;
        let negative = req.negative_prompt.as_deref().unwrap_or("");
        let uncond = self.text_embedding(&self.tokenizer, &self.text_model, &self.config.clip, negative, clip_skip)?;

        let mut encoded = Tensor::cat(&[uncond, cond], 0).map_err(err)?;
        if let (Some(tokenizer), Some(model), Some(clip_config)) = (
            &self.tokenizer_2,
            &self.text_model_2,
            self.config.clip2.as_ref(),
        ) {
            let cond2 = self.text_embedding(tokenizer, model, clip_config, &req.prompt, clip_skip)?;
            let uncond2 = self.text_embedding(tokenizer, model, clip_config, negative, clip_skip)?;
            let both2 = Tensor::cat(&[uncond2, cond2], 0).map_err(err)?;
            encoded = Tensor::cat(&[encoded, both2], D::Minus1).map_err(err)?;
        }
        let encoded = encoded.to_dtype(self.dtype).map_err(err)?.repeat((batch, 1, 1)).map_err(err)?;

        let latent_shape = (batch, 4, height as usize / 8, width as usize / 8);
        let mut rgba = vec![0u8; width as usize * height as usize * 4];

        for index in 0..batch {
            let mut scheduler = build_scheduler(steps, &sampler, &schedule)?;
            let noise = seeded_noise(latent_shape, seed.wrapping_add(index as u64), &self.device)?;
            let mut latents = (noise * scheduler.init_noise_sigma())
                .map_err(err)?
                .to_dtype(self.dtype)
                .map_err(err)?;

            for &timestep in scheduler.timesteps().to_vec().iter() {
                let model_input = Tensor::cat(&[&latents, &latents], 0).map_err(err)?;
                let model_input = scheduler
                    .scale_model_input(model_input, timestep)
                    .map_err(err)?;
                let prediction = self
                    .unet
                    .forward(&model_input, timestep as f64, &encoded)
                    .map_err(err)?;
                let chunks = prediction.chunk(2, 0).map_err(err)?;
                let (uncond_pred, cond_pred) = (&chunks[0], &chunks[1]);
                let guided = (uncond_pred + ((cond_pred - uncond_pred).map_err(err)? * cfg).map_err(err)?)
                    .map_err(err)?;
                latents = scheduler.step(&guided, timestep, &latents).map_err(err)?;
            }

            let cell = self.decode_cell(&latents, index, width, height)?;
            let offset = index * width as usize * height as usize * 4;
            rgba[offset..offset + cell.len()].copy_from_slice(&cell);
        }

        Ok(RenderedImage {
            width,
            height,
            rgba,
        })
    }

    fn decode_cell(
        &self,
        latents: &Tensor,
        index: usize,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, String> {
        let scaled = (latents / self.version.vae_scale()).map_err(err)?;
        let image = self.vae.decode(&scaled).map_err(err)?;
        let image = ((image / 2.0).map_err(err)? + 0.5)
            .map_err(err)?
            .to_device(&Device::Cpu)
            .map_err(err)?;
        let image = (image.clamp(0f32, 1f32).map_err(err)? * 255.0)
            .map_err(err)?
            .to_dtype(DType::U8)
            .map_err(err)?
            .i(index)
            .map_err(err)?;
        let rgb = image
            .permute((1, 2, 0))
            .map_err(err)?
            .flatten_all()
            .map_err(err)?
            .to_vec1::<u8>()
            .map_err(err)?;
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for pixel in rgb.chunks_exact(3) {
            rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
        }
        if rgba.len() != width as usize * height as usize * 4 {
            return Err(format!(
                "VAE decoded {} bytes, expected {}x{} RGBA",
                rgba.len(),
                width,
                height
            ));
        }
        Ok(rgba)
    }

    fn text_embedding(
        &self,
        tokenizer: &Tokenizer,
        model: &sd::clip::ClipTextTransformer,
        clip_config: &sd::clip::Config,
        prompt: &str,
        clip_skip: u32,
    ) -> Result<Tensor, String> {
        let mut tokens = tokenizer
            .encode(prompt, true)
            .map_err(|error| format!("tokenization failed: {error}"))?
            .get_ids()
            .to_vec();
        let max = clip_config.max_position_embeddings;
        if tokens.len() > max {
            return Err(format!("prompt has {} tokens, maximum is {max}", tokens.len()));
        }
        let pad_id = clip_config
            .pad_with
            .as_ref()
            .and_then(|pad| tokenizer.get_vocab(true).get(pad.as_str()).copied())
            .or_else(|| tokenizer.get_vocab(true).get("<|endoftext|>").copied())
            .unwrap_or(0);
        tokens.resize(max, pad_id);
        let tokens = Tensor::new(tokens.as_slice(), &self.device)
            .map_err(err)?
            .unsqueeze(0)
            .map_err(err)?;

        let embeddings = if clip_skip > 1 {
            model
                .forward_until_encoder_layer(&tokens, usize::MAX, -(clip_skip as isize))
                .map_err(err)?
                .1
        } else {
            model.forward(&tokens).map_err(err)?
        };
        Ok(embeddings)
    }
}

/// Build a scheduler for one image. DDIM and UniPC are fully seed-driven;
/// Euler ancestral uses Candle's internal RNG for its stochastic step.
fn build_scheduler(
    steps: usize,
    sampler: &str,
    schedule: &str,
) -> Result<Box<dyn Scheduler>, String> {
    match sampler {
        "ddim" => DDIMSchedulerConfig::default().build(steps).map_err(err),
        "euler_ancestral" => EulerAncestralDiscreteSchedulerConfig::default()
            .build(steps)
            .map_err(err),
        "uni_pc" => UniPCSchedulerConfig::default().build(steps).map_err(err),
        _ if schedule == "karras" => UniPCSchedulerConfig::default().build(steps).map_err(err),
        _ => DDIMSchedulerConfig::default().build(steps).map_err(err),
    }
}

/// Render a media request, returning a PNG data URL. `base_url` must be
/// the local model directory; `model` optionally selects the version.
pub fn run(kind: MediaKind, req: &MediaRequest) -> Result<String, String> {
    if kind != MediaKind::Image {
        return Err(format!("the Candle backend renders images only (not {kind:?})"));
    }
    let raw = req.base_url.trim();
    if raw.is_empty() {
        return Err("Candle SD needs a local model directory in base_url".to_string());
    }
    let root = Path::new(raw.strip_prefix("file://").unwrap_or(raw));
    let model = CandleSd::load(root, req.model.as_deref())?;
    let image = model.render(req)?;
    let png = crate::native_sd::encode_png(image.width, image.height, &image.rgba)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64_encode(&png)
    ))
}

fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn random_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15)
}

fn next_u64(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x | 1;
    x.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

/// Seeded normal noise, independent of Candle's global CPU RNG so a seed
/// reproduces the same latents on every run (for DDIM/UniPC).
fn seeded_noise(shape: (usize, usize, usize, usize), seed: u64, device: &Device) -> Result<Tensor, String> {
    let count = shape.0 * shape.1 * shape.2 * shape.3;
    let mut state = seed | 1;
    let mut values = Vec::with_capacity(count);
    while values.len() < count {
        let u1 = (next_u64(&mut state) as f64 / u64::MAX as f64).max(1e-12);
        let u2 = next_u64(&mut state) as f64 / u64::MAX as f64;
        let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
        values.push(z as f32);
    }
    Tensor::from_vec(values, shape, device).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ids_parse_and_detect_from_directory_names() {
        assert_eq!(ModelVersion::parse("").unwrap(), ModelVersion::V15);
        assert_eq!(ModelVersion::parse("v2-1").unwrap(), ModelVersion::V21);
        assert_eq!(ModelVersion::parse("sdxl").unwrap(), ModelVersion::Sdxl);
        assert_eq!(ModelVersion::parse("sdxl-turbo").unwrap(), ModelVersion::SdxlTurbo);
        assert!(ModelVersion::parse("nope").is_err());
        assert_eq!(ModelVersion::detect(Path::new("/models/sd_xl")), ModelVersion::Sdxl);
        assert_eq!(
            ModelVersion::detect(Path::new("/models/turbo-v1")),
            ModelVersion::SdxlTurbo
        );
    }

    #[test]
    fn model_discovery_reports_the_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let error = ModelPaths::from_dir(dir.path(), ModelVersion::V15).unwrap_err();
        assert!(error.contains("tokenizer"), "{error}");
    }

    #[test]
    fn model_discovery_accepts_fp16_single_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for path in [
            "tokenizer/tokenizer.json",
            "text_encoder/model.fp16.safetensors",
            "unet/diffusion_pytorch_model.fp16.safetensors",
            "vae/diffusion_pytorch_model.fp16.safetensors",
        ] {
            let file = root.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"stub").unwrap();
        }
        let paths = ModelPaths::from_dir(root, ModelVersion::V15).unwrap();
        assert_eq!(paths.dtype, WeightDType::F16);
        assert!(paths.unet.to_string_lossy().contains("fp16"));
        assert!(paths.tokenizer_2.is_none());
    }

    #[test]
    fn schedulers_build_for_every_canonical_sampler() {
        for sampler in [
            "euler",
            "euler_ancestral",
            "heun",
            "dpm_2",
            "dpmpp_2m",
            "dpmpp_2m_sde",
            "ddim",
            "uni_pc",
            "lms",
        ] {
            build_scheduler(4, sampler, "normal").unwrap_or_else(|error| panic!("{sampler}: {error}"));
            build_scheduler(4, sampler, "karras").unwrap_or_else(|error| panic!("{sampler}: {error}"));
        }
    }

    #[test]
    fn seeded_noise_is_reproducible() {
        let device = Device::Cpu;
        let a = seeded_noise((1, 4, 2, 2), 77, &device).unwrap();
        let b = seeded_noise((1, 4, 2, 2), 77, &device).unwrap();
        let c = seeded_noise((1, 4, 2, 2), 78, &device).unwrap();
        let flat = |tensor: &Tensor| tensor.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        assert_eq!(flat(&a), flat(&b));
        assert_ne!(flat(&a), flat(&c));
    }

    /// Set `PRISM_CANDLE_SD_MODEL=/path/to/sd-v1-5` to run real inference.
    /// Skipped by default because no weights ship with the repository.
    #[test]
    fn real_model_generates_a_png_when_weights_are_available() {
        let Ok(root) = std::env::var("PRISM_CANDLE_SD_MODEL") else {
            return;
        };
        let request = MediaRequest {
            provider: crate::media::CANDLE_ID.to_string(),
            base_url: root,
            prompt: "a rusty robot holding a candle".to_string(),
            width: Some(64),
            height: Some(64),
            steps: Some(2),
            cfg: Some(1.0),
            batch: Some(1),
            seed: Some(11),
            ..Default::default()
        };
        let url = run(MediaKind::Image, &request).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
