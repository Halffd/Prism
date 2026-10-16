//! Chat clients.
//!
//! Direct mode streams from any OpenAI-compatible `/chat/completions`
//! endpoint (OpenAI, Gemini compat, DashScope compat, Ollama `/v1`).
//! Prism-api mode POSTs to `{server}/api/chat` and returns the full
//! message in one chunk (that endpoint is non-streaming).

use serde::{Deserialize, Serialize};
use std::sync::mpsc::Sender;

/// One chat message sent to the model.
#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Request for direct (OpenAI-compatible) streaming.
#[derive(Debug, Clone)]
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

/// Request for the prism-api server (non-streaming).
#[derive(Debug, Clone)]
pub struct ApiChatRequest {
    pub server_url: String,
    pub token: String,
    pub content: String,
}

/// Request for Ollama's native `/api/chat` endpoint, used when hardware
/// overrides (context tokens / GPU layers) must reach the server — the
/// OpenAI-compat `/v1` path ignores those options.
#[derive(Debug, Clone)]
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

/// Request for fetching the model list from an OpenAI-compatible server.
#[derive(Debug, Clone)]
pub struct ModelsRequest {
    pub base_url: String,
    pub api_key: String,
}

/// Events forwarded to the UI thread.
#[derive(Debug, Clone)]
pub enum StreamEvent {
    Chunk(String),
    Done,
    Error(String),
}

/// Events for background model-list fetches.
#[derive(Debug, Clone)]
pub enum ModelsEvent {
    Loaded { models: Vec<String> },
    Error(String),
}

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

/// Spawn streaming on the shared tokio runtime; events go to `tx`.
pub fn spawn_stream(req: StreamRequest, tx: Sender<StreamEvent>) {
    crate::runtime().spawn(async move {
        if let Err(e) = run_stream(req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

/// Spawn a non-streaming prism-api chat on the shared runtime.
pub fn spawn_api_chat(req: ApiChatRequest, tx: Sender<StreamEvent>) {
    crate::runtime().spawn(async move {
        if let Err(e) = run_api_chat(req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

async fn run_stream(req: StreamRequest, tx: &Sender<StreamEvent>) -> Result<(), String> {
    let url = crate::providers::chat_completions_url(&req.base_url);
    let client = reqwest::Client::new();
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

    let mut http = client
        .post(&url)
        .json(&body)
        .header("Accept", "text/event-stream");
    if !req.api_key.is_empty() {
        http = http.bearer_auth(&req.api_key);
    }
    let resp = http
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("server returned {status}: {}", truncate(&text, 300)));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    use futures_util::StreamExt;

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        // SSE events are newline-delimited; process complete lines only.
        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=pos).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            let Some(payload) = line.strip_prefix("data:") else {
                continue; // comments, event:, id:, retry: lines
            };
            let payload = payload.trim();
            if payload == "[DONE]" {
                let _ = tx.send(StreamEvent::Done);
                return Ok(());
            }
            if let Some(text) = parse_sse_data(payload) {
                let _ = tx.send(StreamEvent::Chunk(text));
            }
        }
    }

    // Stream ended without [DONE]; still complete.
    let _ = tx.send(StreamEvent::Done);
    Ok(())
}

async fn run_api_chat(req: ApiChatRequest, tx: &Sender<StreamEvent>) -> Result<(), String> {
    let url = format!("{}/api/chat", req.server_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "content": req.content }))
        .bearer_auth(&req.token)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("server returned {status}: {}", truncate(&text, 300)));
    }
    let content = parse_api_response(&text)?;
    let _ = tx.send(StreamEvent::Chunk(content));
    let _ = tx.send(StreamEvent::Done);
    Ok(())
}

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

/// Spawn Ollama-native streaming on the shared runtime.
pub fn spawn_ollama_chat(req: OllamaChatRequest, tx: Sender<StreamEvent>) {
    crate::runtime().spawn(async move {
        if let Err(e) = run_ollama_chat(req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

async fn run_ollama_chat(req: OllamaChatRequest, tx: &Sender<StreamEvent>) -> Result<(), String> {
    let url = format!("{}/api/chat", req.base_url.trim_end_matches('/'));
    let mut options = serde_json::json!({ "temperature": req.temperature });
    if let Some(ctx) = req.num_ctx {
        options["num_ctx"] = serde_json::json!(ctx);
    }
    if let Some(gpu) = req.num_gpu {
        options["num_gpu"] = serde_json::json!(gpu);
    }
    let body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "stream": true,
        "options": options,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("server returned {status}: {}", truncate(&text, 300)));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    use futures_util::StreamExt;

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=pos).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            match parse_ollama_line(line)? {
                OllamaLine::Content(text) => {
                    let _ = tx.send(StreamEvent::Chunk(text));
                }
                OllamaLine::Done => {
                    let _ = tx.send(StreamEvent::Done);
                    return Ok(());
                }
                OllamaLine::Ignore => {}
            }
        }
    }

    let _ = tx.send(StreamEvent::Done);
    Ok(())
}

// ---------------------------------------------------------------------------
// Model list fetching
// ---------------------------------------------------------------------------

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

/// Spawn a background model-list fetch on the shared runtime.
pub fn spawn_models_fetch(req: ModelsRequest, tx: Sender<ModelsEvent>) {
    crate::runtime().spawn(async move {
        let url = crate::providers::models_url(&req.base_url);
        let client = reqwest::Client::new();
        let mut http = client.get(&url);
        if !req.api_key.is_empty() {
            http = http.bearer_auth(&req.api_key);
        }
        let result = async {
            let resp = http
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(format!(
                    "server returned {status}: {}",
                    truncate(&text, 300)
                ));
            }
            parse_models_response(&text)
        }
        .await;
        match result {
            Ok(models) => {
                let _ = tx.send(ModelsEvent::Loaded { models });
            }
            Err(e) => {
                let _ = tx.send(ModelsEvent::Error(e));
            }
        }
    });
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
    fn truncates_on_char_boundary() {
        let s = "héllo".repeat(100);
        let t = truncate(&s, 7);
        assert!(t.ends_with('…'));
        // Must not panic and must be valid to slice (checked by assert above).
        assert!(t.chars().count() <= 8);
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
}
