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
}

/// Request for the prism-api server (non-streaming).
#[derive(Debug, Clone)]
pub struct ApiChatRequest {
    pub server_url: String,
    pub token: String,
    pub content: String,
}

/// Events forwarded to the UI thread.
#[derive(Debug, Clone)]
pub enum StreamEvent {
    Chunk(String),
    Done,
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
    let body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "temperature": req.temperature,
        "stream": true,
    });

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
}
