//! The transport boundary of this web app, per the Prism single-core
//! design: the host (browser) drives HTTP with `fetch` and feeds raw
//! byte chunks into `prism-core`'s transport-free decoders. The core
//! owns all parsing and state — SSE/NDJSON decoding, wire bodies, the
//! provider table — so this module only moves bytes.

use dioxus::prelude::*;
use prism_core::client::{
    parse_api_response, parse_models_response, ApiChatRequest, NdjsonDecoder, SseDecoder,
    StreamEvent, StreamRequest,
};
use prism_core::media::{
    default_base_url, sd_batch, MediaKind, MediaOutcome, MediaRequest, NATIVE_ID,
};
use prism_core::providers::{chat_completions_url, models_url, ollama_root_url};
use prism_core::transport::{ByteStream, HttpRequest, Transport};

use async_trait::async_trait;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

// ---------------------------------------------------------------------------
// Errors + abort
// ---------------------------------------------------------------------------

/// A cancellable in-flight request. Cloned into the chat page's state so
/// a Stop button can abort the underlying fetch.
#[derive(Clone)]
pub struct Abort {
    controller: web_sys::AbortController,
}

impl Abort {
    pub fn new() -> Self {
        Self {
            controller: web_sys::AbortController::new().unwrap_or_else(|_| {
                wasm_bindgen::throw_str("AbortController unavailable")
            }),
        }
    }

    pub fn abort(&self) {
        self.controller.abort();
    }

    fn signal(&self) -> Option<web_sys::AbortSignal> {
        Some(self.controller.signal())
    }

    fn aborted(&self) -> bool {
        self.controller.signal().aborted()
    }
}

fn js_err(value: JsValue, context: &str) -> String {
    let as_str = value.as_string().unwrap_or_else(|| format!("{value:?}"));
    if as_str.contains("abort") {
        "Request aborted".to_string()
    } else {
        format!("{context}: {as_str}")
    }
}

// ---------------------------------------------------------------------------
// Low-level fetch helpers (duck-typed reader loop via js_sys::Reflect)
// ---------------------------------------------------------------------------

async fn fetch_response(
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
    abort: Option<&Abort>,
) -> Result<web_sys::Response, String> {
    fetch_response_js(method, url, headers, body.map(|text| JsValue::from_str(&text)), abort).await
}

/// Same as `fetch_response`, but with an already-built JS body (used for
/// multipart image uploads, which are bytes rather than JSON text).
async fn fetch_response_js(
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<JsValue>,
    abort: Option<&Abort>,
) -> Result<web_sys::Response, String> {
    let init = web_sys::RequestInit::new();
    init.set_method(method);
    init.set_mode(web_sys::RequestMode::Cors);
    if let Some(body) = &body {
        init.set_body(body);
    }

    let header_map = web_sys::Headers::new().map_err(|e| js_err(e, "create headers"))?;
    for (name, value) in &headers {
        header_map
            .append(name, value)
            .map_err(|e| js_err(e, "append header"))?;
    }
    init.set_headers(header_map.as_ref());

    if let Some(abort) = abort {
        if let Some(signal) = abort.signal() {
            init.set_signal(Some(&signal));
        }
    }

    let request = web_sys::Request::new_with_str_and_init(url, &init)
        .map_err(|e| js_err(e, "build request"))?;
    let window = web_sys::window().ok_or_else(|| "no window".to_string())?;
    let response = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| js_err(e, "fetch failed"))?;
    response.dyn_into::<web_sys::Response>().map_err(|_| {
        "fetch returned something that is not a Response".to_string()
    })
}

/// Read the whole body of a response as text.
async fn read_full(response: &web_sys::Response) -> Result<String, String> {
    let body = response.body().ok_or_else(|| "response has no body".to_string())?;
    let reader = stream_reader(&body)?;
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = read_chunk(&reader).await.map_err(|e| js_err(e, "read body"))? {
        out.extend_from_slice(&chunk);
    }
    if out.is_empty() {
        return Ok(String::new());
    }
    String::from_utf8(out).map_err(|_| "response body is not UTF-8".to_string())
}

/// `stream.getReader()` as an opaque object — duck-typed so this works
/// across web-sys union-type revisions.
fn stream_reader(stream: &web_sys::ReadableStream) -> Result<JsValue, String> {
    let get_reader = js_sys::Reflect::get(stream, &JsValue::from_str("getReader"))
        .map_err(|e| js_err(e, "getReader missing"))?
        .dyn_into::<js_sys::Function>()
        .map_err(|_| "getReader is not a function".to_string())?;
    get_reader
        .call0(stream)
        .map_err(|e| js_err(e, "getReader() failed"))
}

/// One `reader.read()` → `Option<bytes>`; `None` when the body ends.
async fn read_chunk(reader: &JsValue) -> Result<Option<Vec<u8>>, JsValue> {
    let read_fn = js_sys::Reflect::get(reader, &JsValue::from_str("read"))
        .map_err(JsValue::from)?
        .dyn_into::<js_sys::Function>()
        .map_err(|_| JsValue::from_str("read is not a function"))?;
    let promise = read_fn
        .call0(reader)
        .map_err(JsValue::from)?
        .dyn_into::<js_sys::Promise>()
        .map_err(|_| JsValue::from_str("read() did not return a promise"))?;
    let result = JsFuture::from(promise).await?;

    let done = js_sys::Reflect::get(&result, &JsValue::from_str("done"))
        .map_err(JsValue::from)?
        .dyn_into::<js_sys::Boolean>()
        .map_err(|_| JsValue::from_str("done is not a boolean"))?
        .value_of();
    if done {
        return Ok(None);
    }
    let value = js_sys::Reflect::get(&result, &JsValue::from_str("value"))
        .map_err(JsValue::from)?;
    let bytes = value
        .dyn_into::<js_sys::Uint8Array>()
        .map_err(|_| JsValue::from_str("chunk is not a Uint8Array"))?
        .to_vec();
    Ok(Some(bytes))
}

fn text_decoder() -> Result<web_sys::TextDecoder, String> {
    web_sys::TextDecoder::new().map_err(|e| js_err(e, "TextDecoder"))
}

/// Streaming decode of one byte chunk, carrying partial UTF-8 sequences
/// across chunk boundaries (`stream: true`).
fn decode_chunk(decoder: &web_sys::TextDecoder, bytes: &[u8]) -> Result<String, String> {
    let array = js_sys::Uint8Array::from(bytes);
    let options = web_sys::TextDecodeOptions::new();
    options.set_stream(true);
    decoder
        .decode_with_buffer_source_and_options(array.as_ref(), &options)
        .map_err(|e| js_err(e, "decode chunk"))
}

// ---------------------------------------------------------------------------
// Chat streaming (OpenAI-compatible SSE, Ollama NDJSON)
// ---------------------------------------------------------------------------

/// A live chat stream: pulls byte chunks off the network, feeds them to
/// the matching prism-core decoder, and yields `StreamEvent`s.
pub struct ChatStream {
    reader: Option<JsValue>,
    decoder: Decoder,
    text_decoder: web_sys::TextDecoder,
    pending: std::collections::VecDeque<StreamEvent>,
    abort: Option<Abort>,
}

enum Decoder {
    Sse(SseDecoder),
    Ndjson(NdjsonDecoder),
}

impl Decoder {
    fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        match self {
            Decoder::Sse(d) => d.feed(bytes),
            Decoder::Ndjson(d) => d.feed(bytes),
        }
    }

    fn finish(&mut self) -> Vec<StreamEvent> {
        match self {
            Decoder::Sse(d) => d.finish(),
            Decoder::Ndjson(d) => d.finish(),
        }
    }
}

/// Open a streaming chat request against the configured provider.
///
/// Uses the OpenAI-compatible wire — the one client that covers all
/// direct providers (per `prism-core/src/providers.rs`). Returns a pump
/// the caller polls for `StreamEvent`s.
pub async fn open_chat_stream(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[prism_core::client::ChatMessage],
    abort: Option<Abort>,
) -> Result<ChatStream, String> {
    let request = StreamRequest {
        base_url: base_url.to_string(),
        api_key: api_key.to_string(),
        model: model.to_string(),
        temperature: 0.7,
        messages: messages.to_vec(),
        max_tokens: None,
        top_p: None,
        frequency_penalty: None,
        presence_penalty: None,
    };
    let url = chat_completions_url(base_url);
    let mut headers: Vec<(String, String)> = vec![
        ("Content-Type".into(), "application/json".into()),
        ("Accept".into(), "text/event-stream".into()),
    ];
    if !api_key.is_empty() {
        headers.push(("Authorization".into(), format!("Bearer {api_key}")));
    }
    let body = prism_core::client::stream_request_body(&request).to_string();

    let response = fetch_response("POST", &url, headers, Some(body), abort.as_ref()).await?;
    if !response.ok() {
        let status = response.status();
        let text = read_full(&response).await.unwrap_or_default();
        return Err(format!("HTTP {status} from {url}: {}", truncate(&text, 300)));
    }
    let body_stream = response.body().ok_or_else(|| "no response body".to_string())?;
    let reader = stream_reader(&body_stream)?;

    Ok(ChatStream {
        reader: Some(reader),
        decoder: Decoder::Sse(SseDecoder::new()),
        text_decoder: text_decoder()?,
        pending: std::collections::VecDeque::new(),
        abort,
    })
}

/// Open a streaming chat against a local Ollama server (native NDJSON
/// wire, `POST {root}/api/chat`).
pub async fn open_ollama_stream(
    base_url: &str,
    model: &str,
    messages: &[prism_core::client::ChatMessage],
    abort: Option<Abort>,
) -> Result<ChatStream, String> {
    let url = format!("{}/api/chat", ollama_root_url(base_url).trim_end_matches('/'));
    let body = prism_core::client::ollama_chat_body(&prism_core::client::OllamaChatRequest {
        base_url: ollama_root_url(base_url),
        model: model.to_string(),
        temperature: 0.7,
        messages: messages.to_vec(),
        num_ctx: None,
        num_gpu: None,
        max_tokens: None,
    })
    .to_string();

    let headers = vec![("Content-Type".to_string(), "application/json".to_string())];
    let response = fetch_response("POST", &url, headers, Some(body), abort.as_ref()).await?;
    if !response.ok() {
        let status = response.status();
        let text = read_full(&response).await.unwrap_or_default();
        return Err(format!("HTTP {status} from {url}: {}", truncate(&text, 300)));
    }
    let body_stream = response.body().ok_or_else(|| "no response body".to_string())?;
    let reader = stream_reader(&body_stream)?;

    Ok(ChatStream {
        reader: Some(reader),
        decoder: Decoder::Ndjson(NdjsonDecoder::new()),
        text_decoder: text_decoder()?,
        pending: std::collections::VecDeque::new(),
        abort,
    })
}

impl ChatStream {
    /// Next decoded event, or `None` when the stream is exhausted.
    pub async fn next(&mut self) -> Option<Result<StreamEvent, String>> {
        loop {
            if let Some(event) = self.pending.pop_front() {
                return Some(Ok(event));
            }
            let reader = match &self.reader {
                Some(reader) => reader.clone(),
                None => {
                    // Body finished: flush the decoder, then end.
                    let tail = self.decoder.finish();
                    self.pending.extend(tail);
                    return self.pending.pop_front().map(Ok);
                }
            };
            match read_chunk(&reader).await {
                Err(e) => {
                    let message = js_err(e, "stream read");
                    if self.abort.as_ref().is_some_and(|a| a.aborted()) {
                        self.reader = None;
                        continue;
                    }
                    return Some(Err(message));
                }
                Ok(None) => {
                    self.reader = None;
                    continue;
                }
                Ok(Some(bytes)) => {
                    let text = match decode_chunk(&self.text_decoder, &bytes) {
                        Ok(text) => text,
                        Err(e) => return Some(Err(e)),
                    };
                    let events = self.decoder.feed(text.as_bytes());
                    self.pending.extend(events);
                }
            }
        }
    }

    /// True once the underlying fetch has been aborted.
    pub fn is_aborted(&self) -> bool {
        self.abort.as_ref().is_some_and(|a| a.aborted())
    }
}

// ---------------------------------------------------------------------------
// Non-streaming endpoints
// ---------------------------------------------------------------------------

/// Chat via a self-hosted prism-api server: `POST {server}/api/chat`
/// (non-streaming JSON), decoded with the core's `parse_api_response`.
pub async fn prism_api_chat(
    server_url: &str,
    token: &str,
    content: &str,
    abort: Option<&Abort>,
) -> Result<String, String> {
    let url = format!("{}/api/chat", server_url.trim_end_matches('/'));
    let mut headers: Vec<(String, String)> = vec![("Content-Type".into(), "application/json".into())];
    if !token.is_empty() {
        headers.push(("Authorization".into(), format!("Bearer {token}")));
    }
    let body = prism_core::client::api_chat_body(&ApiChatRequest {
        server_url: server_url.to_string(),
        token: token.to_string(),
        content: content.to_string(),
    })
    .to_string();

    let response = fetch_response("POST", &url, headers, Some(body), abort).await?;
    let status = response.status();
    let text = read_full(&response).await?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status} from {url}: {}", truncate(&text, 300)));
    }
    parse_api_response(&text)
}

/// `GET {base}/models` against an OpenAI-compatible server, decoded with
/// the core's `parse_models_response` — used by Settings "Test".
pub async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let url = models_url(base_url);
    let mut headers: Vec<(String, String)> = Vec::new();
    if !api_key.is_empty() {
        headers.push(("Authorization".into(), format!("Bearer {api_key}")));
    }
    let response = fetch_response("GET", &url, headers, None, None).await?;
    let status = response.status();
    let text = read_full(&response).await?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status} from {url}: {}", truncate(&text, 300)));
    }
    parse_models_response(&text)
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let head: String = text.chars().take(max).collect();
        format!("{head}…")
    }
}

// ---------------------------------------------------------------------------
// Browser media transport (the WASM half of the core's `Transport`)
// ---------------------------------------------------------------------------

/// The host side of the single-core boundary for media: `fetch` owns the
/// sockets, while `prism-core` builds every wire body and parses every
/// reply. This is the browser counterpart of `ReqwestTransport`.
#[derive(Clone, Copy, Default)]
pub struct FetchTransport;

/// Read a whole response as UTF-8 bytes, surfacing non-2xx statuses with
/// a body excerpt (the same contract as the core's native transport).
async fn fetch_bytes(method: &str, req: HttpRequest) -> Result<Vec<u8>, String> {
    let response = fetch_response(method, &req.url, req.headers, req.body, None).await?;
    let status = response.status();
    let text = read_full(&response).await?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status} from {}: {}", req.url, truncate(&text, 300)));
    }
    Ok(text.into_bytes())
}

// The core trait is `?Send` on WASM (browser fetch futures live on the
// single UI thread); match it here.
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl Transport for FetchTransport {
    /// Media responses are always read whole; streaming is a chat-only
    /// path that the web host drives itself (see `ChatStream`).
    async fn post_stream(&self, _req: HttpRequest) -> Result<ByteStream, String> {
        Err("streaming media responses are not supported in the browser".to_string())
    }

    async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
        fetch_bytes("POST", req).await
    }

    async fn get_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
        fetch_bytes("GET", req).await
    }

    /// Binary POST (ComfyUI's `/upload/image` multipart), used by
    /// img2img/inpaint flows that carry a source image.
    async fn post_bytes(
        &self,
        req: HttpRequest,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<Vec<u8>, String> {
        let mut headers = vec![("Content-Type".to_string(), content_type.to_string())];
        headers.extend(req.headers);
        let array = js_sys::Uint8Array::from(body.as_slice());
        let response = fetch_response_js(
            "POST",
            &req.url,
            headers,
            Some(array.into()),
            None,
        )
        .await?;
        let status = response.status();
        let text = read_full(&response).await?;
        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status} from {}: {}", req.url, truncate(&text, 300)));
        }
        Ok(text.into_bytes())
    }
}

// ---------------------------------------------------------------------------
// Image generation orchestration
// ---------------------------------------------------------------------------

/// One finished image, ready for an `<img src>`.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedImage {
    /// Short caption (backend name / seed) shown under the tile.
    pub label: String,
    /// A `data:` URL for the native renderer, or the install's `/view`
    /// URL for a remote backend.
    pub url: String,
}

/// A random seed from the browser clock (mixed, so nearby calls differ).
fn random_seed() -> u64 {
    let nanos = js_sys::Date::now() as u64;
    nanos ^ nanos.rotate_left(31) ^ 0x9E37_79B9_7F4A_7C15
}

/// Render with the in-process engine, one tile per batch cell. Each cell
/// gets its own seed so a batch shows distinct images rather than copies
/// of one contact sheet.
fn render_native(req: &MediaRequest) -> Result<Vec<GeneratedImage>, String> {
    let batch = sd_batch(req);
    let mut cell = req.clone();
    cell.batch = Some(1);
    let mut seed = req.seed.unwrap_or_else(random_seed);
    let mut tiles = Vec::new();
    for _ in 0..batch {
        let used = seed;
        cell.seed = Some(used);
        seed = seed.wrapping_add(1);
        tiles.push(GeneratedImage {
            label: format!("seed {used}"),
            url: prism_core::native_sd::png_data_url(&cell)?,
        });
    }
    Ok(tiles)
}

/// Run a text-to-image request through the core, polling asynchronous
/// installs (ComfyUI) to completion. Called from the image page inside a
/// Dioxus `spawn`, so the browser can paint the "generating" state first.
pub async fn generate_images(req: MediaRequest) -> Result<Vec<GeneratedImage>, String> {
    // The native engine needs no transport at all.
    if req.provider == NATIVE_ID {
        return render_native(&req);
    }

    let base = if req.base_url.trim().is_empty() {
        default_base_url(&req.provider).to_string()
    } else {
        req.base_url.trim().trim_end_matches('/').to_string()
    };
    if base.is_empty() {
        return Err(format!("unknown image backend: {}", req.provider));
    }

    let provider = req.provider.clone();
    let api_key = req.api_key.clone();
    let mut outcome = prism_core::media::run_media(&FetchTransport, MediaKind::Image, &req).await?;

    // ComfyUI (and other async providers) answer with a task id first.
    // Poll a bounded number of times so a stuck install cannot hang the
    // page forever.
    let label = format!("{provider} result");
    for _ in 0..90 {
        match outcome {
            MediaOutcome::Ready(url) => return Ok(vec![GeneratedImage { label, url }]),
            MediaOutcome::Failed(e) => return Err(e),
            MediaOutcome::Pending(task_id) => {
                gloo_timers::future::sleep(std::time::Duration::from_secs(2)).await;
                outcome = prism_core::media::poll_media(
                    &FetchTransport,
                    &provider,
                    &base,
                    &api_key,
                    &task_id,
                )
                .await?;
            }
        }
    }
    Err(format!("{provider} did not finish in time"))
}
