//! A Rust-native local backend for both chat and image generation.
//!
//! Two wire surfaces, one std-only HTTP server:
//!
//! - OpenAI-compatible chat (`/v1/models`, `/v1/chat/completions`) and
//!   Ollama-native parity (`/api/tags`, `/api/chat`). By default these use
//!   `prism_core::native_llm`, a deterministic preview engine; built with the
//!   `candle-llm` feature and configured with `--llm-model`, the same routes
//!   run real quantized GGUF inference.
//! - Automatic1111-compatible images (`/sdapi/v1/*`). By default these
//!   use `prism_core::native_sd`, a deterministic CPU preview renderer.
//!   Built with the `candle-sd` feature and configured with `--sd-model`,
//!   the same routes run real CLIP → UNet → VAE inference through Candle.
//!
//! No Python, no model downloads, and no external services: point Prism's
//! `local` provider at `http://127.0.0.1:7861/v1` for chat, or the media
//! panel at the same host with the `a1111` provider for images.

use prism_core::client::ChatMessage;
use prism_core::media::{base64_encode, LoraSpec, MediaRequest, A1111_ID, NATIVE_ID};
use prism_core::native_llm::{self, GenerateRequest, Generated, MODEL_ID};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(any(feature = "candle-sd", feature = "candle-llm"))]
use std::collections::HashMap;
#[cfg(any(feature = "candle-sd", feature = "candle-llm"))]
use std::sync::{Arc, Mutex, OnceLock};

/// Default listen address. 7861 keeps 7860 free for a real A1111.
pub const DEFAULT_BIND: &str = "127.0.0.1:7861";

/// Backend configuration. The preview engines need nothing; real inference
/// needs local weights plus the matching `candle-sd` / `candle-llm` feature.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerConfig {
    /// Directory containing `tokenizer/`, `text_encoder/`, `unet/`, `vae/`.
    pub sd_model: Option<String>,
    /// Optional architecture id: `v1-5`, `v2-1`, `sdxl`, `sdxl-turbo`.
    pub sd_version: Option<String>,
    /// GGUF file, or a directory containing exactly one GGUF/GGML file.
    pub llm_model: Option<String>,
    /// `tokenizer.json` file or its directory. Defaults to beside the GGUF.
    pub llm_tokenizer: Option<String>,
    /// Prompt wrapper: `auto`, `chatml`, `llama3`, `llama2`, `mistral`,
    /// `zephyr`, `deepseek`, or `plain`.
    pub llm_format: Option<String>,
    /// Root holding the shared graph document (`graph.json`). The node
    /// graph every surface edits, served over `/v1/graph`.
    pub graph_root: Option<std::path::PathBuf>,
}

impl ServerConfig {
    /// Build from `PRISM_SD_*` / `PRISM_LLM_*` environment variables when present.
    /// `PRISM_GRAPH_ROOT` overrides where the shared graph document is
    /// stored; without it the server falls back to `./prism-data/graph`,
    /// which keeps a checkout usable with no configuration at all.
    pub fn from_env() -> Self {
        let clean = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let graph_root = clean("PRISM_GRAPH_ROOT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(default_graph_root);
        Self {
            sd_model: clean("PRISM_SD_MODEL"),
            sd_version: clean("PRISM_SD_VERSION"),
            llm_model: clean("PRISM_LLM_MODEL"),
            llm_tokenizer: clean("PRISM_LLM_TOKENIZER"),
            llm_format: clean("PRISM_LLM_FORMAT"),
            graph_root: Some(graph_root),
        }
    }

    /// True when real Candle image inference is configured and available.
    pub fn uses_candle(&self) -> bool {
        #[cfg(feature = "candle-sd")]
        return self
            .sd_model
            .as_deref()
            .is_some_and(|dir| !dir.trim().is_empty());
        #[cfg(not(feature = "candle-sd"))]
        return false;
    }

    /// True when real Candle chat inference is configured and available.
    pub fn uses_candle_llm(&self) -> bool {
        #[cfg(feature = "candle-llm")]
        return self
            .llm_model
            .as_deref()
            .is_some_and(|path| !path.trim().is_empty());
        #[cfg(not(feature = "candle-llm"))]
        return false;
    }
}

/// One HTTP response, including the content type needed by SSE/NDJSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

/// Run the server until the process is killed, using environment config.
pub fn serve(bind: &str) -> std::io::Result<()> {
    serve_with_config(bind, ServerConfig::from_env())
}

/// Run the server until the process is killed with an explicit config.
pub fn serve_with_config(bind: &str, config: ServerConfig) -> std::io::Result<()> {
    let listener = TcpListener::bind(bind)?;
    println!("prism-native-server listening on http://{bind}");
    println!(
        "  chat: POST /v1/chat/completions (SSE when stream=true), /api/chat ({})",
        chat_backend(&config)
    );
    println!("  models: GET /v1/models, /api/tags");
    println!(
        "  images: POST /sdapi/v1/txt2img, /sdapi/v1/img2img ({})",
        image_backend(&config)
    );
    println!("  discovery: GET /health, /sdapi/v1/sd-models, /samplers, /options");
    if config.uses_candle() {
        if let Some(dir) = config.sd_model.as_deref() {
            println!("  sd-model: {dir}");
        }
    } else if config.sd_model.is_some() {
        eprintln!("warning: --sd-model needs the candle-sd feature; using preview renderer");
    }
    if config.uses_candle_llm() {
        if let Some(path) = config.llm_model.as_deref() {
            println!("  llm-model: {path}");
        }
    } else if config.llm_model.is_some() {
        eprintln!("warning: --llm-model needs the candle-llm feature; using preview engine");
    }
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let config = config.clone();
                std::thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &config) {
                        eprintln!("connection error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("accept failed: {error}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, config: &ServerConfig) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let (method, path, body) = read_request(&mut stream)?;
    let response = handle_http_with(&method, &path, &body, config);
    write_response(&mut stream, response)
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<(String, String, Vec<u8>)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before headers",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position + 4;
        }
        if buffer.len() > 1_048_576 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request headers too large",
            ));
        }
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);
    Ok((method, path, body))
}

fn write_response(stream: &mut TcpStream, response: HttpResponse) -> std::io::Result<()> {
    let reason = match response.status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {} {reason}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
         Cache-Control: no-cache\r\n\
         \r\n",
        response.status,
        response.content_type,
        response.body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(response.body.as_bytes())?;
    stream.flush()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// Route one request with the default (preview renderer) configuration.
pub fn handle_request(method: &str, path: &str, body: &[u8]) -> (u16, String) {
    handle_request_with_config(method, path, body, &ServerConfig::default())
}

/// Route one request with an explicit image backend configuration.
pub fn handle_request_with_config(
    method: &str,
    path: &str,
    body: &[u8],
    config: &ServerConfig,
) -> (u16, String) {
    let response = handle_http_with(method, path, body, config);
    (response.status, response.body)
}

/// Route one request with the default (preview renderer) configuration.
pub fn handle_http(method: &str, path: &str, body: &[u8]) -> HttpResponse {
    handle_http_with(method, path, body, &ServerConfig::default())
}

/// Route one request. Pure so the whole API is testable without sockets.
pub fn handle_http_with(method: &str, path: &str, body: &[u8], config: &ServerConfig) -> HttpResponse {
    let path = path.split('?').next().unwrap_or(path);
    match (method, path) {
        ("OPTIONS", _) => HttpResponse {
            status: 204,
            content_type: "text/plain; charset=utf-8",
            body: String::new(),
        },
        ("GET", "/") | ("GET", "/health") => json_response(
            200,
            serde_json::json!({
                "status": "ok",
                "backend": "prism-native",
                "api": "a1111-compatible + openai-compatible + ollama-compatible",
                "chat": "/v1/chat/completions",
                "models": "/v1/models",
                "images": "/sdapi/v1/txt2img",
                "model": chat_model_id(config),
                "chat_backend": chat_backend(config),
                "image_backend": image_backend(config),
                "sd_model": config.sd_model.as_deref(),
                "sd_version": config.sd_version.as_deref(),
                "llm_model": config.llm_model.as_deref(),
                "llm_format": config.llm_format.as_deref(),
            })
            .to_string(),
        ),
        ("GET", "/v1/models") => json_response(200, models_json(config)),
        ("GET", "/api/tags") => json_response(200, ollama_tags_json(config)),
        // The shared canvas: one graph document every Prism surface edits.
        ("GET", "/v1/graph") => graph_get(config),
        ("PUT", "/v1/graph") => graph_put(body, config),
        ("GET", "/v1/graph/format") => graph_format(config),
        ("POST", "/v1/chat/completions") => openai_chat(body, config),
        ("POST", "/api/chat") => ollama_chat(body, config),
        ("GET", "/sdapi/v1/sd-models") => {
            let title = config.sd_model.as_deref().unwrap_or(MODEL_ID);
            json_response(
                200,
                serde_json::json!([{
                    "title": title,
                    "model_name": title,
                    "hash": null,
                    "sha256": null,
                    "filename": title,
                    "config": null,
                }])
                .to_string(),
            )
        }
        ("GET", "/sdapi/v1/samplers") => json_response(200, samplers_json()),
        ("GET", "/sdapi/v1/options") => json_response(
            200,
            serde_json::json!({
                "sd_model_checkpoint": config.sd_model.as_deref().unwrap_or(MODEL_ID),
                "sd_vae": null,
                "CLIP_stop_at_last_layers": 1,
            })
            .to_string(),
        ),
        ("GET", "/sdapi/v1/progress") => json_response(
            200,
            serde_json::json!({
                "progress": 0.0,
                "eta_relative": 0.0,
                "state": { "job": "", "job_count": 0 },
                "current_image": null,
            })
            .to_string(),
        ),
        ("POST", "/sdapi/v1/txt2img") | ("POST", "/sdapi/v1/img2img") => {
            match request_from_json(body) {
                Ok(request) => match render(&request, config) {
                    Ok(response) => json_response(200, response),
                    Err(error) => error_response(500, &error),
                },
                Err(error) => error_response(400, &error),
            }
        }
        _ => error_response(404, &format!("unknown route: {method} {path}")),
    }
}

fn json_response(status: u16, body: String) -> HttpResponse {
    HttpResponse {
        status,
        content_type: "application/json",
        body,
    }
}

// ---------------------------------------------------------------------------
// Shared graph API — the canvas every Prism surface edits
// ---------------------------------------------------------------------------

/// `GET /v1/graph` — the shared canvas document. Every app opens this,
/// edits locally, and PUTs the result, so a drawing made in Slint shows
/// up in the web app and the CLI without either one knowing about the
/// other.
/// Where the shared graph document is stored when nothing is configured:
/// a `prism-data` dir beside the working directory. Explicitly a
/// fallback, not the recommended setup — `PRISM_GRAPH_ROOT` is.
fn default_graph_root() -> std::path::PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("prism-data")
        .join("graph")
}

fn graph_get(config: &ServerConfig) -> HttpResponse {
    let Some(root) = config.graph_root.as_deref() else {
        return error_response(404, "graph storage is not configured");
    };
    let now = now_ms();
    // The stored `updated_at` is returned untouched: a read must not make
    // the server look newer than the copy a client already holds, or the
    // client's next write would look stale and be discarded.
    let doc = prism_core::graph_store::load(&prism_core::storage::FsStorage, root, now);
    json_response(200, doc.to_json())
}

/// `PUT /v1/graph` — merge a document written by another app, then
/// persist the result so the next reader sees the combined drawing.
fn graph_put(body: &[u8], config: &ServerConfig) -> HttpResponse {
    let Some(root) = config.graph_root.as_deref() else {
        return error_response(404, "graph storage is not configured");
    };
    let text = match std::str::from_utf8(body) {
        Ok(text) => text,
        Err(_) => return error_response(400, "graph body must be UTF-8 JSON"),
    };
    let Some(incoming) = prism_core::graph_store::GraphDocument::from_json(text) else {
        return error_response(400, "not a Prism graph document");
    };
    let storage = prism_core::storage::FsStorage;
    let now = now_ms();
    let local = prism_core::graph_store::load(&storage, root, now);
    match prism_core::graph_store::apply_and_save(&storage, root, &local, &incoming, now) {
        Ok(merged) => json_response(200, merged.to_json()),
        Err(e) => error_response(500, &format!("could not save graph: {e}")),
    }
}

/// `GET /v1/graph/format` — the graph's field vocabulary, so a host can
/// render a palette without hardcoding the core's node list.
fn graph_format(config: &ServerConfig) -> HttpResponse {
    let _ = config;
    let nodes: Vec<serde_json::Value> = prism_core::graph_nodes::NODE_DEFS
        .iter()
        .map(|def| {
            let ports = |p: &prism_core::graph::Port| {
                serde_json::json!({
                    "id": p.id,
                    "label": p.label,
                    "kind": format!("{:?}", p.kind).to_lowercase(),
                    "output": p.output,
                })
            };
            serde_json::json!({
                "kind": def.kind,
                "title": def.title,
                "family": def.family.as_str(),
                "inputs": def.inputs.iter().map(ports).collect::<Vec<_>>(),
                "outputs": def.outputs.iter().map(ports).collect::<Vec<_>>(),
                "knobs": def.knobs.iter().map(|k| serde_json::json!({
                    "id": k.id,
                    "label": k.label,
                    "control": k.control,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    json_response(200, serde_json::json!({ "nodes": nodes }).to_string())
}

/// Epoch milliseconds, for `updated_at` stamps.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sse_response(body: String) -> HttpResponse {
    HttpResponse {
        status: 200,
        content_type: "text/event-stream; charset=utf-8",
        body,
    }
}

fn ndjson_response(body: String) -> HttpResponse {
    HttpResponse {
        status: 200,
        content_type: "application/x-ndjson; charset=utf-8",
        body,
    }
}

fn error_response(status: u16, message: &str) -> HttpResponse {
    json_response(status, error_json(message))
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message, "detail": message }).to_string()
}

/// Human-readable chat engine used by this configuration.
fn chat_backend(config: &ServerConfig) -> &'static str {
    if config.uses_candle_llm() {
        "candle-llm"
    } else {
        "prism-native"
    }
}

/// Model id advertised to chat clients. The preview id is always accepted;
/// a configured GGUF is listed as an additional selectable model.
fn chat_model_id(config: &ServerConfig) -> String {
    if config.uses_candle_llm() {
        config
            .llm_model
            .as_deref()
            .and_then(|value| {
                let path = Path::new(value.strip_prefix("file://").unwrap_or(value));
                path.file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .filter(|stem| !stem.is_empty())
            })
            .unwrap_or_else(|| "candle-llm".to_string())
    } else {
        MODEL_ID.to_string()
    }
}

/// Human-readable image engine used by this configuration.
fn image_backend(config: &ServerConfig) -> &'static str {
    if config.uses_candle() {
        "candle"
    } else {
        "prism-native"
    }
}

fn render(request: &MediaRequest, config: &ServerConfig) -> Result<String, String> {
    let (image, backend) = render_image(request, config)?;
    let png = prism_core::native_sd::encode_png(image.width, image.height, &image.rgba)?;
    let image_base64 = base64_encode(&png);
    let info = serde_json::json!({
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt,
        "steps": request.steps,
        "cfg_scale": request.cfg,
        "sampler_name": request.sampler,
        "scheduler": request.scheduler,
        "seed": request.seed,
        "width": image.width,
        "height": image.height,
        "backend": backend,
        "sd_model": config.sd_model.as_deref(),
        "sd_version": config.sd_version.as_deref(),
    })
    .to_string();
    Ok(serde_json::json!({
        "images": [image_base64],
        "parameters": {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "steps": request.steps,
            "cfg_scale": request.cfg,
            "width": image.width,
            "height": image.height,
            "seed": request.seed,
        },
        "info": info,
    })
    .to_string())
}

fn render_image(
    request: &MediaRequest,
    config: &ServerConfig,
) -> Result<(prism_core::native_sd::RenderedImage, &'static str), String> {
    if config.uses_candle() {
        render_candle(request, config).map(|image| (image, "candle"))
    } else {
        prism_core::native_sd::render(request).map(|image| (image, "prism-native"))
    }
}

#[cfg(feature = "candle-sd")]
fn render_candle(
    request: &MediaRequest,
    config: &ServerConfig,
) -> Result<prism_core::native_sd::RenderedImage, String> {
    let pipeline = candle_pipeline(config)?;
    pipeline.render(request)
}

#[cfg(feature = "candle-sd")]
fn candle_pipeline(
    config: &ServerConfig,
) -> Result<Arc<prism_core::candle_sd::CandleSd>, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<prism_core::candle_sd::CandleSd>>>> =
        OnceLock::new();
    let dir = config.sd_model.as_deref().unwrap_or_default();
    let raw = dir.trim();
    let path = Path::new(raw.strip_prefix("file://").unwrap_or(raw));
    let version = config
        .sd_version
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let key = format!("{}|{}", path.display(), version.unwrap_or("auto"));

    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(pipeline) = cache
        .lock()
        .map_err(|_| "Candle model cache lock poisoned".to_string())?
        .get(&key)
    {
        return Ok(Arc::clone(pipeline));
    }

    // Loading is expensive; hold the lock through load so concurrent
    // requests never race to read the same weights twice.
    let mut cache = cache
        .lock()
        .map_err(|_| "Candle model cache lock poisoned".to_string())?;
    if let Some(pipeline) = cache.get(&key) {
        return Ok(Arc::clone(pipeline));
    }
    let pipeline = Arc::new(prism_core::candle_sd::CandleSd::load(path, version)?);
    cache.insert(key, Arc::clone(&pipeline));
    Ok(pipeline)
}

#[cfg(not(feature = "candle-sd"))]
fn render_candle(
    _request: &MediaRequest,
    _config: &ServerConfig,
) -> Result<prism_core::native_sd::RenderedImage, String> {
    Err("real SD inference requires prism-native-server to be built with --features candle-sd".to_string())
}

// ---- local LLM engine selection ------------------------------------------

#[cfg(feature = "candle-llm")]
fn generate_chat(
    request: &GenerateRequest,
    config: &ServerConfig,
) -> Result<Generated, String> {
    if !config.uses_candle_llm() {
        return native_llm::generate(request);
    }
    let pipeline = candle_chat_pipeline(config)?;
    let mut llm = pipeline
        .lock()
        .map_err(|_| "Candle LLM cache lock poisoned".to_string())?;
    llm.generate(request)
}

#[cfg(feature = "candle-llm")]
fn candle_chat_pipeline(
    config: &ServerConfig,
) -> Result<Arc<Mutex<prism_core::candle_llm::CandleLlm>>, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<Mutex<prism_core::candle_llm::CandleLlm>>>>> =
        OnceLock::new();
    let model = config.llm_model.as_deref().unwrap_or_default();
    let model = Path::new(model.strip_prefix("file://").unwrap_or(model.trim()));
    let tokenizer = config
        .llm_tokenizer
        .as_deref()
        .map(|value| Path::new(value.trim()));
    let format = config
        .llm_format
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let key = format!(
        "{}|{}|{}",
        model.display(),
        tokenizer.map(|path| path.display().to_string()).unwrap_or_default(),
        format.unwrap_or("auto")
    );

    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| "Candle LLM cache lock poisoned".to_string())?;
    if let Some(pipeline) = cache.get(&key) {
        return Ok(Arc::clone(pipeline));
    }
    // Hold the lock through load so concurrent requests never read the same
    // multi-gigabyte weights twice.
    let llm = prism_core::candle_llm::CandleLlm::load(model, tokenizer, format)?;
    let pipeline = Arc::new(Mutex::new(llm));
    cache.insert(key, Arc::clone(&pipeline));
    Ok(pipeline)
}

#[cfg(not(feature = "candle-llm"))]
fn generate_chat(
    request: &GenerateRequest,
    _config: &ServerConfig,
) -> Result<Generated, String> {
    native_llm::generate(request)
}

// ---- local LLM surface ----------------------------------------------------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn completion_id(seed: u64) -> String {
    format!("chatcmpl-{seed:016x}")
}

fn prompt_tokens(req: &GenerateRequest) -> usize {
    req.messages
        .iter()
        .map(|message| native_llm::estimate_tokens(&message.content))
        .sum()
}

fn f32_field(value: Option<&serde_json::Value>, default: f32) -> f32 {
    value
        .and_then(|value| value.as_f64())
        .unwrap_or(default as f64)
        .clamp(0.0, 2.0) as f32
}

fn max_tokens_field(value: Option<&serde_json::Value>, default: usize) -> usize {
    value
        .and_then(|value| value.as_u64())
        .unwrap_or(default as u64)
        .clamp(1, 8192) as usize
}

fn seed_field(value: Option<&serde_json::Value>) -> Option<u64> {
    value
        .and_then(|value| value.as_i64())
        .filter(|seed| *seed >= 0)
        .map(|seed| seed as u64)
}

fn parse_stop(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::String(text)) if !text.trim().is_empty() => vec![text.clone()],
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str())
            .filter(|text| !text.trim().is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_messages(value: Option<&serde_json::Value>) -> Result<Vec<ChatMessage>, String> {
    let items = value
        .and_then(|value| value.as_array())
        .ok_or_else(|| "messages must be an array".to_string())?;
    items
        .iter()
        .map(|item| {
            let role = item
                .get("role")
                .and_then(|role| role.as_str())
                .unwrap_or("user");
            let role = if role.trim().is_empty() { "user" } else { role };
            let content = match item.get("content") {
                Some(serde_json::Value::String(text)) => text.clone(),
                // OpenAI vision parts: the preview engine is text-only, so
                // only text parts contribute; image parts are ignored.
                Some(serde_json::Value::Array(parts)) => parts
                    .iter()
                    .filter_map(|part| {
                        part.get("text")
                            .and_then(|text| text.as_str())
                            .or_else(|| part.get("content").and_then(|text| text.as_str()))
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            Ok(ChatMessage::text(role, &content))
        })
        .collect()
}

/// Map an OpenAI-compatible `/v1/chat/completions` body. The boolean is
/// the requested SSE mode.
pub fn openai_chat_from_json(body: &[u8]) -> Result<(GenerateRequest, bool), String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|error| format!("invalid JSON: {error}"))?;
    if !value.is_object() {
        return Err("request body must be a JSON object".to_string());
    }
    let messages = parse_messages(value.get("messages"))?;
    if messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }
    let model = value
        .get("model")
        .and_then(|model| model.as_str())
        .unwrap_or(MODEL_ID)
        .trim();
    let model = if model.is_empty() { MODEL_ID } else { model };

    let mut request = GenerateRequest::new(model, messages);
    request.temperature = f32_field(value.get("temperature"), request.temperature);
    request.top_p = f32_field(value.get("top_p"), request.top_p).min(1.0);
    request.max_tokens = max_tokens_field(
        value
            .get("max_tokens")
            .or_else(|| value.get("max_completion_tokens")),
        request.max_tokens,
    );
    request.seed = seed_field(value.get("seed"));
    request.stop = parse_stop(value.get("stop"));
    request.frequency_penalty = f32_field(value.get("frequency_penalty"), 0.0);
    request.presence_penalty = f32_field(value.get("presence_penalty"), 0.0);
    let stream = value
        .get("stream")
        .and_then(|stream| stream.as_bool())
        .unwrap_or(false);
    Ok((request, stream))
}

fn openai_chat(body: &[u8], config: &ServerConfig) -> HttpResponse {
    let (request, stream) = match openai_chat_from_json(body) {
        Ok(parsed) => parsed,
        Err(error) => return error_response(400, &error),
    };
    let generated = match generate_chat(&request, config) {
        Ok(generated) => generated,
        Err(error) => return error_response(500, &error),
    };
    if stream {
        sse_response(chat_completion_sse(&generated))
    } else {
        json_response(200, chat_completion_json(&request, &generated))
    }
}

fn chat_completion_json(request: &GenerateRequest, generated: &Generated) -> String {
    let prompt = prompt_tokens(request);
    let total = prompt + generated.tokens;
    serde_json::json!({
        "id": completion_id(generated.seed),
        "object": "chat.completion",
        "created": now_secs(),
        "model": generated.model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": generated.text },
            "finish_reason": generated.finish_reason,
        }],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": generated.tokens,
            "total_tokens": total,
        },
    })
    .to_string()
}

fn chat_completion_sse(generated: &Generated) -> String {
    let id = completion_id(generated.seed);
    let created = now_secs();
    let mut body = String::new();
    for chunk in native_llm::chunk_text(&generated.text) {
        let payload = serde_json::json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": generated.model,
            "choices": [{
                "index": 0,
                "delta": { "role": "assistant", "content": chunk },
                "finish_reason": serde_json::Value::Null,
            }],
        });
        body.push_str("data: ");
        body.push_str(&payload.to_string());
        body.push_str("\n\n");
    }
    let final_payload = serde_json::json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": generated.model,
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": generated.finish_reason,
        }],
    });
    body.push_str("data: ");
    body.push_str(&final_payload.to_string());
    body.push_str("\n\ndata: [DONE]\n\n");
    body
}

/// Map an Ollama-native `/api/chat` body. The boolean is the NDJSON mode
/// (Ollama defaults to streaming).
pub fn ollama_chat_from_json(body: &[u8]) -> Result<(GenerateRequest, bool), String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|error| format!("invalid JSON: {error}"))?;
    if !value.is_object() {
        return Err("request body must be a JSON object".to_string());
    }
    let messages = parse_messages(value.get("messages"))?;
    if messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }
    let model = value
        .get("model")
        .and_then(|model| model.as_str())
        .unwrap_or(MODEL_ID)
        .trim();
    let model = if model.is_empty() { MODEL_ID } else { model };
    let options = value.get("options");

    let mut request = GenerateRequest::new(model, messages);
    request.temperature = f32_field(
        options.and_then(|options| options.get("temperature")),
        request.temperature,
    );
    request.top_p = f32_field(options.and_then(|options| options.get("top_p")), request.top_p)
        .min(1.0);
    request.max_tokens = max_tokens_field(
        options.and_then(|options| options.get("num_predict")),
        request.max_tokens,
    );
    request.seed = seed_field(options.and_then(|options| options.get("seed")));
    request.stop = parse_stop(options.and_then(|options| options.get("stop")));
    let stream = value
        .get("stream")
        .and_then(|stream| stream.as_bool())
        .unwrap_or(true);
    Ok((request, stream))
}

fn ollama_chat(body: &[u8], config: &ServerConfig) -> HttpResponse {
    let (request, stream) = match ollama_chat_from_json(body) {
        Ok(parsed) => parsed,
        Err(error) => return error_response(400, &error),
    };
    let generated = match generate_chat(&request, config) {
        Ok(generated) => generated,
        Err(error) => return error_response(500, &error),
    };
    if stream {
        ndjson_response(ollama_ndjson(&generated))
    } else {
        json_response(200, ollama_final_line(&generated))
    }
}

fn ollama_ndjson(generated: &Generated) -> String {
    let mut body = String::new();
    for chunk in native_llm::chunk_text(&generated.text) {
        let line = serde_json::json!({
            "model": generated.model,
            "created_at": "2026-01-01T00:00:00Z",
            "message": { "role": "assistant", "content": chunk },
            "done": false,
        });
        body.push_str(&line.to_string());
        body.push('\n');
    }
    body.push_str(&ollama_final_line(generated));
    body
}

fn ollama_final_line(generated: &Generated) -> String {
    let mut line = serde_json::json!({
        "model": generated.model,
        "created_at": "2026-01-01T00:00:00Z",
        "message": { "role": "assistant", "content": "" },
        "done": true,
        "done_reason": generated.finish_reason,
    })
    .to_string();
    line.push('\n');
    line
}

fn models_json(config: &ServerConfig) -> String {
    let mut data = vec![serde_json::json!({
        "id": MODEL_ID,
        "object": "model",
        "created": now_secs(),
        "owned_by": "prism",
    })];
    if config.uses_candle_llm() {
        data.push(serde_json::json!({
            "id": chat_model_id(config),
            "object": "model",
            "created": now_secs(),
            "owned_by": "prism",
        }));
    }
    serde_json::json!({ "object": "list", "data": data }).to_string()
}

fn ollama_tags_json(config: &ServerConfig) -> String {
    let mut models = vec![serde_json::json!({
        "name": MODEL_ID,
        "model": MODEL_ID,
        "size": 0,
        "modified_at": "2026-01-01T00:00:00Z",
        "details": {
            "family": "prism",
            "parameter_size": "preview",
            "quantization_level": "none",
        },
    })];
    if config.uses_candle_llm() {
        models.push(serde_json::json!({
            "name": chat_model_id(config),
            "model": chat_model_id(config),
            "size": 0,
            "modified_at": "2026-01-01T00:00:00Z",
            "details": {
                "family": "llama",
                "parameter_size": "quantized",
                "quantization_level": "gguf",
            },
        }));
    }
    serde_json::json!({ "models": models }).to_string()
}

/// Map an A1111 request body onto a [`MediaRequest`].
pub fn request_from_json(body: &[u8]) -> Result<MediaRequest, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| format!("invalid JSON: {e}"))?;
    if !value.is_object() {
        return Err("request body must be a JSON object".to_string());
    }

    let raw_prompt = value
        .get("prompt")
        .and_then(|p| p.as_str())
        .unwrap_or("")
        .to_string();
    let (prompt, loras) = extract_loras(&raw_prompt);

    let (sampler, scheduler) = value
        .get("sampler_name")
        .and_then(|s| s.as_str())
        .map(canonical_sampler)
        .unwrap_or_else(|| ("euler".to_string(), "normal".to_string()));

    let override_settings = value.get("override_settings");
    let vae = override_settings
        .and_then(|o| o.get("sd_vae"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let clip_skip = override_settings
        .and_then(|o| o.get("CLIP_stop_at_last_layers"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let seed = value
        .get("seed")
        .and_then(|s| s.as_i64())
        .filter(|s| *s >= 0)
        .map(|s| s as u64);

    Ok(MediaRequest {
        provider: A1111_ID.to_string(),
        prompt,
        negative_prompt: value
            .get("negative_prompt")
            .and_then(|n| n.as_str())
            .map(str::to_string)
            .filter(|n| !n.trim().is_empty()),
        steps: value.get("steps").and_then(|v| v.as_u64()).map(|v| v as u32),
        cfg: value.get("cfg_scale").and_then(|v| v.as_f64()),
        sampler: Some(sampler),
        scheduler: Some(scheduler),
        denoise: value
            .get("denoising_strength")
            .and_then(|v| v.as_f64()),
        batch: value
            .get("batch_size")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        width: value.get("width").and_then(|v| v.as_u64()).map(|v| v as u32),
        height: value
            .get("height")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        vae,
        clip_skip,
        loras,
        seed,
        ..Default::default()
    })
}

/// Split `<lora:name:weight>` tags out of a prompt.
pub fn extract_loras(prompt: &str) -> (String, Vec<LoraSpec>) {
    let mut cleaned = String::new();
    let mut loras = Vec::new();
    let mut rest = prompt;
    while let Some(start) = rest.find("<lora:") {
        cleaned.push_str(&rest[..start]);
        let after = &rest[start + "<lora:".len()..];
        match after.find('>') {
            Some(end) => {
                let inner = &after[..end];
                let mut parts = inner.splitn(2, ':');
                let name = parts.next().unwrap_or("").trim();
                let weight = parts
                    .next()
                    .and_then(|w| w.trim().parse::<f64>().ok())
                    .unwrap_or(1.0);
                if !name.is_empty() {
                    loras.push(LoraSpec {
                        name: name.to_string(),
                        weight,
                    });
                }
                rest = &after[end + 1..];
            }
            None => {
                cleaned.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    cleaned.push_str(rest);
    (cleaned.trim().to_string(), loras)
}

/// Map an A1111 sampler display name to `(sampler, scheduler)` ids.
pub fn canonical_sampler(name: &str) -> (String, String) {
    let lower = name.trim().to_ascii_lowercase();
    let scheduler = if lower.ends_with("karras") {
        "karras"
    } else if lower.ends_with("exponential") {
        "exponential"
    } else {
        "normal"
    };
    let base = lower
        .trim_end_matches(" karras")
        .trim_end_matches(" exponential")
        .trim();
    let sampler = match base {
        "euler a" | "euler_ancestral" => "euler_ancestral",
        "euler" => "euler",
        "heun" => "heun",
        "dpm2" | "dpm_2" => "dpm_2",
        "dpm++ 2m" | "dpmpp_2m" => "dpmpp_2m",
        "dpm++ 2m sde" | "dpmpp_2m_sde" => "dpmpp_2m_sde",
        "ddim" => "ddim",
        "unipc" | "uni_pc" => "uni_pc",
        "lms" => "lms",
        _ => "euler",
    };
    (sampler.to_string(), scheduler.to_string())
}

fn samplers_json() -> String {
    let names = [
        ("Euler", "euler"),
        ("Euler a", "euler_ancestral"),
        ("Heun", "heun"),
        ("DPM2", "dpm_2"),
        ("DPM++ 2M", "dpmpp_2m"),
        ("DPM++ 2M SDE", "dpmpp_2m_sde"),
        ("DDIM", "ddim"),
        ("UniPC", "uni_pc"),
        ("LMS", "lms"),
    ];
    let list: Vec<serde_json::Value> = names
        .iter()
        .map(|(display, id)| {
            serde_json::json!({
                "name": display,
                "aliases": [id],
                "options": {},
            })
        })
        .collect();
    serde_json::Value::Array(list).to_string()
}

/// Chat provider id a Prism client should select for this server.
pub const PROVIDER: &str = "local";
/// Image provider id for the A1111-compatible HTTP routes.
pub const IMAGE_PROVIDER: &str = A1111_ID;
/// In-process image provider (no HTTP), for comparison in tests/UI.
pub const IN_PROCESS_IMAGE_PROVIDER: &str = NATIVE_ID;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_graph_api_serves_and_accepts_a_shared_document() {
        let root = std::env::temp_dir().join("prism-native-graph-test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let config = ServerConfig {
            graph_root: Some(root.clone()),
            ..ServerConfig::default()
        };

        // GET before any write yields the starter drawing.
        let response = handle_http_with("GET", "/v1/graph", b"", &config);
        assert_eq!(response.status, 200);
        let doc = prism_core::graph_store::GraphDocument::from_json(&response.body)
            .expect("a graph document comes back");
        assert!(prism_core::graph_store::is_valid(&doc));
        let original_nodes = doc.graph.nodes.len();

        // PUT a document that adds a node; the reply keeps it.
        let mut edited = doc.clone();
        let extra = prism_core::graph_factory::make_node(4242, "seed", 40.0, 40.0).unwrap();
        edited.graph.nodes.push(extra.clone());
        let body = edited.to_json().into_bytes();
        let response = handle_http_with("PUT", "/v1/graph", &body, &config);
        assert_eq!(response.status, 200);
        let saved = prism_core::graph_store::GraphDocument::from_json(&response.body).unwrap();
        assert_eq!(saved.graph.nodes.len(), original_nodes + 1);
        assert!(saved.graph.node(4242).is_some());

        // A later GET sees the persisted merge, not the starter.
        let response = handle_http_with("GET", "/v1/graph", b"", &config);
        let reloaded = prism_core::graph_store::GraphDocument::from_json(&response.body).unwrap();
        assert!(reloaded.graph.node(4242).is_some());

        // Garbage is refused with a 400, and the stored document is intact.
        let response = handle_http_with("PUT", "/v1/graph", b"not json", &config);
        assert_eq!(response.status, 400);
        let response = handle_http_with("GET", "/v1/graph", b"", &config);
        let intact = prism_core::graph_store::GraphDocument::from_json(&response.body).unwrap();
        assert!(intact.graph.node(4242).is_some());

        // A non-Prism document is refused too.
        let response = handle_http_with("PUT", "/v1/graph", br#"{"app":"other"}"#, &config);
        assert_eq!(response.status, 400);

        // The palette description carries every node, its ports and knobs.
        let response = handle_http_with("GET", "/v1/graph/format", b"", &config);
        assert_eq!(response.status, 200);
        let value: serde_json::Value = serde_json::from_str(&response.body).unwrap();
        let nodes = value["nodes"].as_array().expect("a node list");
        assert_eq!(nodes.len(), 6);
        let sampler = nodes
            .iter()
            .find(|n| n["kind"] == "sampler")
            .expect("the sampler definition");
        assert_eq!(sampler["title"], "KSampler");
        assert_eq!(sampler["inputs"].as_array().unwrap().len(), 4);
        assert_eq!(sampler["outputs"].as_array().unwrap().len(), 1);
        assert!(sampler["knobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|k| k["id"] == "cfg"));

        // Without a configured root the routes decline rather than panic.
        let bare = handle_http_with("GET", "/v1/graph", b"", &ServerConfig::default());
        assert_eq!(bare.status, 404);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn txt2img_returns_a_png_data_payload() {
        let body = br#"{"prompt":"a fox","width":64,"height":64,"seed":7,"steps":2}"#;
        let (status, response) = handle_request("POST", "/sdapi/v1/txt2img", body);
        assert_eq!(status, 200);
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        let image = value["images"][0].as_str().expect("base64 image");
        let bytes = prism_core::media::base64_decode(image).unwrap();
        assert_eq!(&bytes[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn the_request_options_survive_the_mapping() {
        let body = br#"{
            "prompt":"a fox <lora:detail:0.6>",
            "negative_prompt":"blurry",
            "steps":12,
            "cfg_scale":5.5,
            "sampler_name":"DPM++ 2M Karras",
            "width":128,
            "height":96,
            "seed":42,
            "batch_size":2,
            "override_settings":{"sd_vae":"vae.safetensors","CLIP_stop_at_last_layers":2}
        }"#;
        let request = request_from_json(body).unwrap();
        assert_eq!(request.prompt, "a fox");
        assert_eq!(request.negative_prompt.as_deref(), Some("blurry"));
        assert_eq!(request.steps, Some(12));
        assert_eq!(request.cfg, Some(5.5));
        assert_eq!(request.sampler.as_deref(), Some("dpmpp_2m"));
        assert_eq!(request.scheduler.as_deref(), Some("karras"));
        assert_eq!(request.width, Some(128));
        assert_eq!(request.height, Some(96));
        assert_eq!(request.seed, Some(42));
        assert_eq!(request.batch, Some(2));
        assert_eq!(request.vae.as_deref(), Some("vae.safetensors"));
        assert_eq!(request.clip_skip, Some(2));
        assert_eq!(request.loras.len(), 1);
        assert_eq!(request.loras[0].name, "detail");
        assert_eq!(request.loras[0].weight, 0.6);
    }

    #[test]
    fn a_negative_seed_means_random() {
        let request = request_from_json(br#"{"prompt":"x","seed":-1}"#).unwrap();
        assert_eq!(request.seed, None);
    }

    #[test]
    fn bad_json_is_a_400() {
        let (status, response) = handle_request("POST", "/sdapi/v1/txt2img", b"not json");
        assert_eq!(status, 400);
        assert!(response.contains("invalid JSON"));
    }

    #[test]
    fn discovery_routes_answer() {
        let (status, models) = handle_request("GET", "/sdapi/v1/sd-models", b"");
        assert_eq!(status, 200);
        assert!(models.contains("prism-native"));

        let (status, samplers) = handle_request("GET", "/sdapi/v1/samplers", b"");
        assert_eq!(status, 200);
        assert!(samplers.contains("Euler a"));

        let (status, health) = handle_request("GET", "/health", b"");
        assert_eq!(status, 200);
        assert!(health.contains("a1111-compatible"));
    }

    #[test]
    fn unknown_routes_are_404() {
        let (status, _) = handle_request("GET", "/nope", b"");
        assert_eq!(status, 404);
    }

    #[test]
    fn lora_tags_are_extracted_and_removed() {
        let (prompt, loras) =
            extract_loras("a fox <lora:detail.safetensors:0.8> in snow <lora:style:1>");
        assert_eq!(prompt, "a fox  in snow");
        assert_eq!(loras.len(), 2);
        assert_eq!(loras[0].name, "detail.safetensors");
        assert_eq!(loras[0].weight, 0.8);
        assert_eq!(loras[1].weight, 1.0);
    }

    #[test]
    fn sampler_names_map_to_canonical_ids() {
        assert_eq!(
            canonical_sampler("DPM++ 2M Karras"),
            ("dpmpp_2m".to_string(), "karras".to_string())
        );
        assert_eq!(
            canonical_sampler("Euler a"),
            ("euler_ancestral".to_string(), "normal".to_string())
        );
        assert_eq!(
            canonical_sampler("UniPC"),
            ("uni_pc".to_string(), "normal".to_string())
        );
    }

    #[test]
    fn chat_completion_returns_openai_shape() {
        let body = br#"{
            "model":"prism-native",
            "messages":[
                {"role":"system","content":"Be concise"},
                {"role":"user","content":"hello"}
            ],
            "temperature":0,
            "seed":12,
            "max_tokens":64
        }"#;
        let (status, response) = handle_request("POST", "/v1/chat/completions", body);
        assert_eq!(status, 200);
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["object"], "chat.completion");
        assert_eq!(value["model"], MODEL_ID);
        assert_eq!(value["choices"][0]["finish_reason"], "stop");
        let content = value["choices"][0]["message"]["content"]
            .as_str()
            .expect("assistant content");
        assert!(content.starts_with("In short:"), "{content}");
        assert!(value["usage"]["total_tokens"].as_u64().unwrap() > 0);
    }

    #[test]
    fn chat_stream_is_decodable_by_core_at_every_byte_boundary() {
        use prism_core::client::{SseDecoder, StreamEvent};
        let body = br#"{"messages":[{"role":"user","content":"hello"}],"temperature":0,"seed":7,"stream":true}"#;
        let response = handle_http("POST", "/v1/chat/completions", body);
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, "text/event-stream; charset=utf-8");

        let mut decoder = SseDecoder::new();
        let mut text = String::new();
        let mut done = false;
        for byte in response.body.bytes() {
            for event in decoder.feed(&[byte]) {
                match event {
                    StreamEvent::Chunk(chunk) => text.push_str(&chunk),
                    StreamEvent::Done => done = true,
                    StreamEvent::Error(error) => panic!("stream error: {error}"),
                }
            }
        }
        assert!(done, "[DONE] never decoded");
        assert!(!text.is_empty());

        let plain = br#"{"messages":[{"role":"user","content":"hello"}],"temperature":0,"seed":7}"#;
        let (_, response) = handle_request("POST", "/v1/chat/completions", plain);
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            text,
            value["choices"][0]["message"]["content"].as_str().unwrap()
        );
    }

    #[test]
    fn models_are_discoverable_by_core_parsers() {
        let (status, models) = handle_request("GET", "/v1/models", b"");
        assert_eq!(status, 200);
        let parsed = prism_core::local::parse_openai_models(&models).unwrap();
        assert_eq!(parsed[0].id, MODEL_ID);

        let (_, tags) = handle_request("GET", "/api/tags", b"");
        let ollama = prism_core::local::parse_ollama_tags(&tags).unwrap();
        assert_eq!(ollama[0].id, MODEL_ID);

        let local = prism_core::local::find(PROVIDER).expect("local provider is registered");
        assert!(prism_core::local::health_from_body(local, &models).reachable());
    }

    #[test]
    fn core_stream_request_body_is_accepted() {
        use prism_core::client::{stream_request_body, StreamRequest};
        let request = StreamRequest {
            base_url: format!("http://{DEFAULT_BIND}/v1"),
            api_key: String::new(),
            model: MODEL_ID.to_string(),
            temperature: 0.3,
            messages: vec![ChatMessage::text("user", "local server")],
            max_tokens: Some(80),
            top_p: Some(0.9),
            frequency_penalty: None,
            presence_penalty: None,
        };
        let wire = stream_request_body(&request).to_string();
        let (parsed, stream) = openai_chat_from_json(wire.as_bytes()).unwrap();
        assert!(stream);
        assert_eq!(parsed.model, MODEL_ID);
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "local server");
        assert_eq!(parsed.max_tokens, 80);
        assert!((parsed.temperature - 0.3).abs() < 0.001);
        assert!((parsed.top_p - 0.9).abs() < 0.001);
    }

    #[test]
    fn ollama_chat_stream_is_decodable_by_core() {
        use prism_core::client::{ollama_chat_body, NdjsonDecoder, OllamaChatRequest, StreamEvent};
        let mut wire = ollama_chat_body(&OllamaChatRequest {
            base_url: DEFAULT_BIND.to_string(),
            model: MODEL_ID.to_string(),
            temperature: 0.2,
            messages: vec![ChatMessage::text("user", "hello")],
            num_ctx: Some(2048),
            num_gpu: Some(0),
            max_tokens: Some(50),
        });
        wire["options"]["seed"] = serde_json::json!(21);
        let (request, stream) = ollama_chat_from_json(wire.to_string().as_bytes()).unwrap();
        assert!(stream);
        assert_eq!(request.max_tokens, 50);
        assert_eq!(request.seed, Some(21));

        let response = handle_http("POST", "/api/chat", wire.to_string().as_bytes());
        assert_eq!(response.content_type, "application/x-ndjson; charset=utf-8");
        let mut decoder = NdjsonDecoder::new();
        let mut text = String::new();
        let mut done = false;
        for byte in response.body.bytes() {
            for event in decoder.feed(&[byte]) {
                match event {
                    StreamEvent::Chunk(chunk) => text.push_str(&chunk),
                    StreamEvent::Done => done = true,
                    StreamEvent::Error(error) => panic!("stream error: {error}"),
                }
            }
        }
        assert!(done, "done:true never decoded");
        assert_eq!(text, prism_core::native_llm::generate(&request).unwrap().text);
    }

    #[test]
    fn bad_chat_payloads_are_400() {
        for path in ["/v1/chat/completions", "/api/chat"] {
            let (status, _) = handle_request("POST", path, b"not json");
            assert_eq!(status, 400, "{path}");
            let (status, _) = handle_request("POST", path, br#"{"messages":[]}"#);
            assert_eq!(status, 400, "{path}");
        }
        let (status, _) = handle_request("POST", "/api/chat", br#"{"messages":"nope"}"#);
        assert_eq!(status, 400);
    }

    #[test]
    fn health_advertises_both_surfaces() {
        let (status, health) = handle_request("GET", "/health", b"");
        assert_eq!(status, 200);
        for needle in [
            "a1111-compatible",
            "openai-compatible",
            "ollama-compatible",
            "/v1/chat/completions",
            "/sdapi/v1/txt2img",
        ] {
            assert!(health.contains(needle), "missing {needle}");
        }
        let preflight = handle_http("OPTIONS", "/v1/chat/completions", b"");
        assert_eq!(preflight.status, 204);
    }

    #[test]
    fn config_selects_the_image_backend() {
        let preview = ServerConfig::default();
        assert_eq!(image_backend(&preview), "prism-native");
        assert!(!preview.uses_candle());

        let configured = ServerConfig {
            sd_model: Some("/models/sd-v1-5".to_string()),
            sd_version: Some("v1-5".to_string()),
            ..Default::default()
        };
        assert_eq!(configured.uses_candle(), cfg!(feature = "candle-sd"));
        let health = handle_http_with("GET", "/health", b"", &configured);
        assert!(health.body.contains("/models/sd-v1-5"));
        assert_eq!(
            health.body.contains("\"image_backend\":\"candle\""),
            cfg!(feature = "candle-sd")
        );
    }

    #[cfg(feature = "candle-sd")]
    #[test]
    fn a_candle_config_reports_missing_weights_on_the_a1111_route() {
        let config = ServerConfig {
            sd_model: Some("/nonexistent/prism-candle-sd".to_string()),
            sd_version: Some("v1-5".to_string()),
            ..Default::default()
        };
        let (status, response) = handle_request_with_config(
            "POST",
            "/sdapi/v1/txt2img",
            br#"{"prompt":"a fox","width":64,"height":64}"#,
            &config,
        );
        assert_eq!(status, 500);
        assert!(response.contains("tokenizer"), "{response}");
    }

    #[test]
    fn config_selects_the_chat_backend() {
        let preview = ServerConfig::default();
        assert_eq!(chat_backend(&preview), "prism-native");
        assert!(!preview.uses_candle_llm());

        let configured = ServerConfig {
            llm_model: Some("/models/tinyllama.Q4_K_M.gguf".to_string()),
            llm_tokenizer: Some("/models/tokenizer.json".to_string()),
            llm_format: Some("chatml".to_string()),
            ..Default::default()
        };
        assert_eq!(configured.uses_candle_llm(), cfg!(feature = "candle-llm"));
        assert_eq!(
            chat_backend(&configured),
            if cfg!(feature = "candle-llm") {
                "candle-llm"
            } else {
                "prism-native"
            }
        );
        let health = handle_http_with("GET", "/health", b"", &configured);
        assert!(health.body.contains("/models/tinyllama.Q4_K_M.gguf"));
        assert_eq!(
            health.body.contains("\"chat_backend\":\"candle-llm\""),
            cfg!(feature = "candle-llm")
        );
    }

    #[cfg(feature = "candle-llm")]
    #[test]
    fn a_candle_chat_config_reports_missing_weights_on_the_chat_route() {
        let config = ServerConfig {
            llm_model: Some("/nonexistent/prism-llm.gguf".to_string()),
            ..Default::default()
        };
        let (status, response) = handle_request_with_config(
            "POST",
            "/v1/chat/completions",
            br#"{"messages":[{"role":"user","content":"hello"}]}"#,
            &config,
        );
        assert_eq!(status, 500);
        assert!(response.contains("not found"), "{response}");
    }

    #[cfg(feature = "candle-llm")]
    #[test]
    fn configured_chat_model_is_advertised_without_hiding_the_preview() {
        let config = ServerConfig {
            llm_model: Some("/models/tinyllama.Q4_K_M.gguf".to_string()),
            ..Default::default()
        };
        let (_, models) = handle_request_with_config("GET", "/v1/models", b"", &config);
        let parsed = prism_core::local::parse_openai_models(&models).unwrap();
        assert_eq!(parsed[0].id, MODEL_ID);
        assert!(parsed.iter().any(|model| model.id == "tinyllama.Q4_K_M"));

        let (_, tags) = handle_request_with_config("GET", "/api/tags", b"", &config);
        let ollama = prism_core::local::parse_ollama_tags(&tags).unwrap();
        assert!(ollama.iter().any(|model| model.id == "tinyllama.Q4_K_M"));
    }
}
