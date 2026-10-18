//! Chat clients and stream decoders.
//!
//! Two layers:
//!
//! 1. **Pure decoders** (`SseDecoder`, `NdjsonDecoder`, `parse_*`
//!    functions) — transport-free state machines that turn byte chunks
//!    into `StreamEvent`s. These are the conformance surface: recorded
//!    wire fixtures in `contracts/fixtures/` must decode identically on
//!    every target, at any chunk boundary.
//! 2. **Transport-generic runners** (`run_*`) — wire a `Transport` and
//!    a decoder to an event channel. Hosts spawn them on their own
//!    executor; the core never spawns.

use crate::transport::{ByteStream, HttpRequest, Transport};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::Sender;

/// One chat message sent to the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Request for direct (OpenAI-compatible) streaming.
#[derive(Debug, Clone, Deserialize)]
pub struct StreamRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub messages: Vec<ChatMessage>,
    /// `max_tokens` request field; `None` omits it (server default).
    pub max_tokens: Option<u32>,
    /// `top_p` request field; `None` omits it (server default).
    pub top_p: Option<f32>,
    /// `frequency_penalty` request field; `None` omits it.
    pub frequency_penalty: Option<f32>,
    /// `presence_penalty` request field; `None` omits it.
    pub presence_penalty: Option<f32>,
}

/// Request for Ollama's native `/api/chat` endpoint, used when hardware
/// overrides (context tokens / GPU layers) must reach the server — the
/// OpenAI-compat `/v1` path ignores those options.
#[derive(Debug, Clone, Deserialize)]
pub struct OllamaChatRequest {
    /// Ollama root URL without `/v1` (e.g. `http://localhost:11434`).
    pub base_url: String,
    pub model: String,
    pub temperature: f32,
    pub messages: Vec<ChatMessage>,
    /// `options.num_ctx` (context size hint).
    pub num_ctx: Option<u32>,
    /// `options.num_gpu` (GPU layer offload; 0 = CPU only).
    pub num_gpu: Option<u32>,
}

/// Request for the prism-api server (non-streaming).
#[derive(Debug, Clone, Deserialize)]
pub struct ApiChatRequest {
    pub server_url: String,
    pub token: String,
    pub content: String,
}

/// Request for fetching the model list from an OpenAI-compatible server.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelsRequest {
    pub base_url: String,
    pub api_key: String,
}

/// Events forwarded from a chat run to the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum StreamEvent {
    Chunk(String),
    Done,
    Error(String),
}

/// Events for background model-list fetches.
#[derive(Debug, Clone, Deserialize)]
pub enum ModelsEvent {
    Loaded { models: Vec<String> },
    Error(String),
}

// ---------------------------------------------------------------------------
// SSE (OpenAI-compatible chat completions)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SseChunk {
    #[serde(default)]
    choices: Vec<SseChoice>,
}

#[derive(Deserialize)]
struct SseChoice {
    delta: Option<SseDelta>,
}

#[derive(Deserialize)]
struct SseDelta {
    content: Option<String>,
}

/// Extract assistant text from one SSE `data:` payload.
/// Returns `None` for keep-alives and deltas without content.
pub fn parse_sse_data(payload: &str) -> Option<String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return None;
    }
    let chunk: SseChunk = serde_json::from_str(trimmed).ok()?;
    let choice = chunk.choices.first()?;
    choice
        .delta
        .as_ref()
        .and_then(|d| d.content.clone())
        .filter(|c| !c.is_empty())
}

/// Transport-free decoder for OpenAI-compatible SSE streams.
/// Bytes are buffered raw, so chunk boundaries may fall anywhere —
/// including inside multi-byte UTF-8 sequences. Feeding `[DONE]`
/// completes the stream; `finish` completes a stream that ended
/// without a terminator.
#[derive(Debug, Default)]
pub struct SseDecoder {
    buf: Vec<u8>,
    done: bool,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        let mut out = Vec::new();
        if self.done {
            return out;
        }
        self.buf.extend_from_slice(bytes);
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = trim_eol(&line);
            let line = String::from_utf8_lossy(&line);
            let Some(payload) = line.strip_prefix("data:") else {
                continue; // comments, event:, id:, retry: lines
            };
            let payload = payload.trim();
            if payload == "[DONE]" {
                self.done = true;
                out.push(StreamEvent::Done);
                return out;
            }
            if let Some(text) = parse_sse_data(payload) {
                out.push(StreamEvent::Chunk(text));
            }
        }
        out
    }

    /// Stream ended without a `[DONE]` terminator; still complete.
    pub fn finish(&mut self) -> Vec<StreamEvent> {
        if self.done {
            Vec::new()
        } else {
            self.done = true;
            vec![StreamEvent::Done]
        }
    }
}

// ---------------------------------------------------------------------------
// Ollama native /api/chat (NDJSON streaming)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OllamaChunk {
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaMessage {
    #[serde(default)]
    content: Option<String>,
}

/// One parsed Ollama NDJSON line.
#[derive(Debug, Clone, PartialEq)]
pub enum OllamaLine {
    /// Assistant text to append.
    Content(String),
    /// `done: true` terminator.
    Done,
    /// Keep-alive or blank line.
    Ignore,
}

/// Parse one Ollama NDJSON line. `Err` for Ollama-reported errors and
/// malformed JSON.
pub fn parse_ollama_line(line: &str) -> Result<OllamaLine, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(OllamaLine::Ignore);
    }
    let chunk: OllamaChunk =
        serde_json::from_str(trimmed).map_err(|e| format!("invalid NDJSON from Ollama: {e}"))?;
    if let Some(err) = chunk.error {
        return Err(err);
    }
    if chunk.done {
        return Ok(OllamaLine::Done);
    }
    Ok(chunk
        .message
        .and_then(|m| m.content)
        .filter(|c| !c.is_empty())
        .map(OllamaLine::Content)
        .unwrap_or(OllamaLine::Ignore))
}

/// Transport-free decoder for Ollama NDJSON streams.
#[derive(Debug, Default)]
pub struct NdjsonDecoder {
    buf: Vec<u8>,
    done: bool,
}

impl NdjsonDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        let mut out = Vec::new();
        if self.done {
            return out;
        }
        self.buf.extend_from_slice(bytes);
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = trim_eol(&line);
            let line = String::from_utf8_lossy(&line);
            match parse_ollama_line(&line) {
                Ok(OllamaLine::Content(text)) => out.push(StreamEvent::Chunk(text)),
                Ok(OllamaLine::Done) => {
                    self.done = true;
                    out.push(StreamEvent::Done);
                    return out;
                }
                Ok(OllamaLine::Ignore) => {}
                Err(e) => {
                    self.done = true;
                    out.push(StreamEvent::Error(e));
                    return out;
                }
            }
        }
        out
    }

    /// Stream ended without a `done: true` terminator; still complete.
    pub fn finish(&mut self) -> Vec<StreamEvent> {
        if self.done {
            Vec::new()
        } else {
            self.done = true;
            vec![StreamEvent::Done]
        }
    }
}

fn trim_eol(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && (line[end - 1] == b'\n' || line[end - 1] == b'\r') {
        end -= 1;
    }
    &line[..end]
}

// ---------------------------------------------------------------------------
// Full-body parsers
// ---------------------------------------------------------------------------

/// Extract text from a prism-api `POST /api/chat` response body.
/// Shape: `{ "success": true, "data": { "content": "..." } }`.
pub fn parse_api_response(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON from server: {e}"))?;
    let success = v.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    if !success {
        let err = v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("unknown server error");
        return Err(err.to_string());
    }
    let data = v.get("data").ok_or("missing data field")?;
    let content = match data {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(_) => data
            .get("content")
            .and_then(|c| c.as_str())
            .ok_or("data.content missing")?
            .to_string(),
        _ => return Err("unexpected data shape".into()),
    };
    Ok(content)
}

/// Parse an OpenAI-compatible `GET /models` response body into model ids.
pub fn parse_models_response(body: &str) -> Result<Vec<String>, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    let data = v.get("data").ok_or("missing data field")?;
    let arr = data.as_array().ok_or("data is not an array")?;
    let mut models = Vec::with_capacity(arr.len());
    for item in arr {
        if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
            if !id.is_empty() {
                models.push(id.to_string());
            }
        }
    }
    Ok(models)
}

// ---------------------------------------------------------------------------
// Transport-generic runners
// ---------------------------------------------------------------------------

/// Provider POST body for a direct (OpenAI-compatible) stream request.
/// Single source of truth for the wire contract — `run_stream` uses it
/// and the WASM/JS hosts call it via `build_stream_body`.
pub fn stream_request_body(req: &StreamRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "temperature": req.temperature,
        "stream": true,
    });
    if let Some(v) = req.max_tokens {
        body["max_tokens"] = serde_json::json!(v);
    }
    if let Some(v) = req.top_p {
        body["top_p"] = serde_json::json!(v);
    }
    if let Some(v) = req.frequency_penalty {
        body["frequency_penalty"] = serde_json::json!(v);
    }
    if let Some(v) = req.presence_penalty {
        body["presence_penalty"] = serde_json::json!(v);
    }
    body
}

/// Ollama native `/api/chat` POST body.
pub fn ollama_chat_body(req: &OllamaChatRequest) -> serde_json::Value {
    let mut options = serde_json::json!({ "temperature": req.temperature });
    if let Some(ctx) = req.num_ctx {
        options["num_ctx"] = serde_json::json!(ctx);
    }
    if let Some(gpu) = req.num_gpu {
        options["num_gpu"] = serde_json::json!(gpu);
    }
    serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true,
        "options": options,
    })
}

/// prism-api `/api/chat` POST body.
pub fn api_chat_body(req: &ApiChatRequest) -> serde_json::Value {
    serde_json::json!({ "content": req.content })
}

pub async fn run_stream<T: Transport + ?Sized>(
    transport: &T,
    req: &StreamRequest,
    tx: &Sender<StreamEvent>,
) -> Result<(), String> {
    let url = crate::providers::chat_completions_url(&req.base_url);

    let mut headers = vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("Accept".to_string(), "text/event-stream".to_string()),
    ];
    if !req.api_key.is_empty() {
        headers.push((
            "Authorization".to_string(),
            format!("Bearer {}", req.api_key),
        ));
    }
    let http_req = HttpRequest {
        url,
        headers,
        body: Some(stream_request_body(req).to_string()),
    };
    let mut stream = transport.post_stream(http_req).await?;
    pump(SseDecoder::new(), &mut stream, tx).await
}

pub async fn run_ollama_chat<T: Transport + ?Sized>(
    transport: &T,
    req: &OllamaChatRequest,
    tx: &Sender<StreamEvent>,
) -> Result<(), String> {
    let url = format!("{}/api/chat", req.base_url.trim_end_matches('/'));
    let http_req = HttpRequest {
        url,
        headers: vec![("Content-Type".to_string(), "application/json".to_string())],
        body: Some(ollama_chat_body(req).to_string()),
    };
    let mut stream = transport.post_stream(http_req).await?;
    pump(NdjsonDecoder::new(), &mut stream, tx).await
}

/// Common runner loop: feed transport chunks into a decoder, forward
/// events, stop on Done/Error.
trait StreamDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent>;
    fn finish(&mut self) -> Vec<StreamEvent>;
}

impl StreamDecoder for SseDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        SseDecoder::feed(self, bytes)
    }
    fn finish(&mut self) -> Vec<StreamEvent> {
        SseDecoder::finish(self)
    }
}

impl StreamDecoder for NdjsonDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        NdjsonDecoder::feed(self, bytes)
    }
    fn finish(&mut self) -> Vec<StreamEvent> {
        NdjsonDecoder::finish(self)
    }
}

/// Feed all transport chunks through `decoder`, forwarding events until
/// the decoder reports completion (Done/Error event or stream end).
async fn pump<D: StreamDecoder>(
    mut decoder: D,
    stream: &mut ByteStream,
    tx: &Sender<StreamEvent>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let bytes = item?;
        for ev in decoder.feed(&bytes) {
            let finished = matches!(ev, StreamEvent::Done | StreamEvent::Error(_));
            let _ = tx.send(ev);
            if finished {
                return Ok(());
            }
        }
    }
    for ev in decoder.finish() {
        let _ = tx.send(ev);
    }
    Ok(())
}

pub async fn run_api_chat<T: Transport + ?Sized>(
    transport: &T,
    req: &ApiChatRequest,
    tx: &Sender<StreamEvent>,
) -> Result<(), String> {
    let url = format!("{}/api/chat", req.server_url.trim_end_matches('/'));
    let http_req = HttpRequest {
        url,
        headers: vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Authorization".to_string(), format!("Bearer {}", req.token)),
        ],
        body: Some(api_chat_body(req).to_string()),
    };
    let resp_body = transport.post_body(http_req).await?;
    let content = parse_api_response(&String::from_utf8_lossy(&resp_body))?;
    let _ = tx.send(StreamEvent::Chunk(content));
    let _ = tx.send(StreamEvent::Done);
    Ok(())
}

pub async fn run_models_fetch<T: Transport + ?Sized>(
    transport: &T,
    req: &ModelsRequest,
    tx: &Sender<ModelsEvent>,
) -> Result<Vec<String>, String> {
    let url = crate::providers::models_url(&req.base_url);
    let mut headers = Vec::new();
    if !req.api_key.is_empty() {
        headers.push((
            "Authorization".to_string(),
            format!("Bearer {}", req.api_key),
        ));
    }
    let http_req = HttpRequest {
        url,
        headers,
        body: None,
    };
    let resp_body = transport.get_body(http_req).await?;
    let models = parse_models_response(&String::from_utf8_lossy(&resp_body))?;
    let _ = tx.send(ModelsEvent::Loaded {
        models: models.clone(),
    });
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_delta_content() {
        let data = r#"{"id":"1","choices":[{"delta":{"content":"Hi"}}]}"#;
        assert_eq!(parse_sse_data(data), Some("Hi".to_string()));
    }

    #[test]
    fn ignores_empty_deltas_and_keepalives() {
        assert_eq!(parse_sse_data(r#"{"choices":[{"delta":{}}]}"#), None);
        assert_eq!(parse_sse_data(""), None);
        assert_eq!(parse_sse_data("   "), None);
        assert_eq!(parse_sse_data("not json"), None);
    }

    #[test]
    fn parses_finish_reason_chunks() {
        let data = r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        assert_eq!(parse_sse_data(data), None);
    }

    #[test]
    fn parses_prism_api_success() {
        let body = r#"{"success":true,"data":{"id":"m1","role":"assistant","content":"hello there"}}"#;
        assert_eq!(
            parse_api_response(body).unwrap(),
            "hello there".to_string()
        );
    }

    #[test]
    fn parses_prism_api_error() {
        let body = r#"{"success":false,"error":"Content is required"}"#;
        let err = parse_api_response(body).unwrap_err();
        assert_eq!(err, "Content is required");
    }

    #[test]
    fn rejects_prism_api_bad_shape() {
        assert!(parse_api_response("{}").is_err());
        assert!(parse_api_response("garbage").is_err());
    }

    #[test]
    fn parses_ollama_content_chunks() {
        let line = r#"{"model":"llama3.2","message":{"role":"assistant","content":"Hi"},"done":false}"#;
        assert_eq!(
            parse_ollama_line(line).unwrap(),
            OllamaLine::Content("Hi".to_string())
        );
    }

    #[test]
    fn ollama_done_and_blank_lines() {
        let line = r#"{"model":"llama3.2","message":{"role":"assistant","content":""},"done":true}"#;
        assert_eq!(parse_ollama_line(line).unwrap(), OllamaLine::Done);
        assert_eq!(parse_ollama_line("").unwrap(), OllamaLine::Ignore);
        assert_eq!(parse_ollama_line("   \n").unwrap(), OllamaLine::Ignore);
    }

    #[test]
    fn ollama_error_line_is_error() {
        let line = r#"{"error":"model 'x' not found"}"#;
        assert_eq!(
            parse_ollama_line(line).unwrap_err(),
            "model 'x' not found"
        );
        assert!(parse_ollama_line("not json").is_err());
    }

    #[test]
    fn parses_openai_models_list() {
        let body = r#"{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"},{"id":""}]}"#;
        let models = parse_models_response(body).unwrap();
        assert_eq!(models, vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]);
    }

    #[test]
    fn models_response_rejects_bad_shapes() {
        assert!(parse_models_response("{}").is_err());
        assert!(parse_models_response(r#"{"data":42}"#).is_err());
        assert!(parse_models_response("garbage").is_err());
        // Empty list is valid.
        assert_eq!(parse_models_response(r#"{"data":[]}"#).unwrap(), Vec::<String>::new());
    }

    // --- decoders ---

    #[test]
    fn sse_decoder_buffers_across_chunks() {
        let mut d = SseDecoder::new();
        let mut events = d.feed(b"data: {\"choices\":[{\"delta\":{\"cont");
        assert!(events.is_empty(), "partial line must not emit");
        events.extend(d.feed(b"ent\":\"Hi\"}}]}\n\n"));
        events.extend(d.feed(b"data: [DONE]\n"));
        assert_eq!(
            events,
            vec![StreamEvent::Chunk("Hi".into()), StreamEvent::Done]
        );
        assert!(d.is_done());
        assert!(d.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n").is_empty());
        assert!(d.finish().is_empty(), "finish after Done must not duplicate");
    }

    #[test]
    fn sse_decoder_finishes_unterminated_stream() {
        let mut d = SseDecoder::new();
        let mut events = d.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n");
        events.extend(d.finish());
        assert_eq!(events, vec![StreamEvent::Chunk("a".into()), StreamEvent::Done]);
    }

    #[test]
    fn sse_decoder_survives_split_utf8() {
        // "é" is two bytes; the split falls between them.
        let payload = "data: {\"choices\":[{\"delta\":{\"content\":\"héllo\"}}]}\n\n";
        let bytes = payload.as_bytes();
        let split = bytes.len() - 8;
        let mut d = SseDecoder::new();
        let mut events = d.feed(&bytes[..split]);
        events.extend(d.feed(&bytes[split..]));
        events.extend(d.finish());
        assert_eq!(events, vec![StreamEvent::Chunk("héllo".into()), StreamEvent::Done]);
    }

    #[test]
    fn ndjson_decoder_streams_and_terminates() {
        let mut d = NdjsonDecoder::new();
        let mut events = Vec::new();
        events.extend(d.feed(b"{\"message\":{\"content\":\"He\"}}\n"));
        events.extend(d.feed(b"\n{\"message\":{\"content\":\"y\"}}\n{\"done\":true}\n"));
        events.extend(d.feed(b"{\"message\":{\"content\":\"late\"}}\n"));
        assert_eq!(
            events,
            vec![
                StreamEvent::Chunk("He".into()),
                StreamEvent::Chunk("y".into()),
                StreamEvent::Done
            ]
        );
        assert!(d.is_done());
        assert!(d.finish().is_empty());
    }

    #[test]
    fn ndjson_decoder_error_line_stops_stream() {
        let mut d = NdjsonDecoder::new();
        let mut events = d.feed(b"{\"message\":{\"content\":\"a\"}}\n{\"error\":\"boom\"}\n");
        events.extend(d.finish());
        assert_eq!(
            events,
            vec![StreamEvent::Chunk("a".into()), StreamEvent::Error("boom".into())]
        );
    }

    fn request() -> StreamRequest {
        StreamRequest {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk".into(),
            model: "gpt-4o".into(),
            temperature: 0.7,
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
            max_tokens: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
        }
    }

    #[test]
    fn stream_body_omits_unset_sampling_fields() {
        let body = stream_request_body(&request());
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["stream"], true);
        // f32 widens to f64 in JSON; compare against the widened value.
        assert_eq!(body["temperature"], serde_json::json!(0.7f32));
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("top_p").is_none());
    }

    #[test]
    fn stream_body_includes_set_sampling_fields() {
        let mut req = request();
        req.max_tokens = Some(512);
        req.top_p = Some(0.9);
        let body = stream_request_body(&req);
        assert_eq!(body["max_tokens"], 512);
        assert_eq!(body["top_p"], serde_json::json!(0.9f32));
    }

    #[test]
    fn ollama_body_carries_hardware_options() {
        let req = OllamaChatRequest {
            base_url: "http://localhost:11434".into(),
            model: "llama3.2".into(),
            temperature: 0.8,
            messages: vec![],
            num_ctx: Some(4096),
            num_gpu: Some(0),
        };
        let body = ollama_chat_body(&req);
        assert_eq!(body["options"]["num_ctx"], 4096);
        assert_eq!(body["options"]["num_gpu"], 0);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn api_chat_body_carries_content() {
        let req = ApiChatRequest {
            server_url: "http://localhost:3000".into(),
            token: "jwt".into(),
            content: "hello".into(),
        };
        let body = api_chat_body(&req);
        assert_eq!(body["content"], "hello");
    }
}
