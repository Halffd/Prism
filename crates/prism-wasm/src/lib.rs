//! WASM bindings for `prism-core` — the contract JS hosts consume.
//!
//! Boundary design (locked in docs/plans/single-core-plan.md):
//! - Hosts drive their own HTTP (fetch/chrome APIs) and feed raw byte
//!   chunks into the decoders; the core owns all parsing and state.
//! - Structured data crosses as JSON strings; byte chunks as
//!   `Uint8Array`.
//! - Decoded events are JSON arrays of externally-tagged `StreamEvent`:
//!   `[{"Chunk":"..."}, "Done"]` / `[{"Error":"..."}]`.
//! - `Result`-shaped parsers return `{"Ok": ...}` / `{"Err": ...}`.
//!
//! A fetch-based Transport inside WASM is intentionally deferred until
//! a JS host needs it (web-app swap); the decoder-first contract is the
//! conformance surface on every target.

use prism_core::client::{NdjsonDecoder as CoreNdjson, SseDecoder as CoreSse, StreamEvent};
use prism_core::conversations;
use prism_core::providers::PROVIDERS;
use prism_core::settings::{self, Settings};
use prism_core::thinking;
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn events_json(events: Vec<StreamEvent>) -> String {
    serde_json::to_string(&events).unwrap_or_else(|e| format!("[{{\"Error\":\"{e}\"}}]"))
}

fn result_json<T: Serialize>(r: &Result<T, String>) -> String {
    match r {
        Ok(v) => serde_json::json!({ "Ok": v }).to_string(),
        Err(e) => serde_json::json!({ "Err": e }).to_string(),
    }
}

/// OpenAI-compatible SSE decoder. Feed response-body bytes; collect the
/// returned event JSON arrays; call `finish` when the stream ends.
#[wasm_bindgen]
pub struct SseDecoder {
    inner: CoreSse,
}

#[wasm_bindgen]
impl SseDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SseDecoder {
        SseDecoder {
            inner: CoreSse::new(),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> String {
        events_json(self.inner.feed(chunk))
    }

    pub fn finish(&mut self) -> String {
        events_json(self.inner.finish())
    }

    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }
}

/// Ollama native NDJSON decoder.
#[wasm_bindgen]
pub struct NdjsonDecoder {
    inner: CoreNdjson,
}

#[wasm_bindgen]
impl NdjsonDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> NdjsonDecoder {
        NdjsonDecoder {
            inner: CoreNdjson::new(),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> String {
        events_json(self.inner.feed(chunk))
    }

    pub fn finish(&mut self) -> String {
        events_json(self.inner.finish())
    }

    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }
}

/// Parse a prism-api `POST /api/chat` response body.
/// Returns `{"Ok": "..."}` or `{"Err": "..."}`.
#[wasm_bindgen]
pub fn parse_api_response(body: &str) -> String {
    result_json(&prism_core::client::parse_api_response(body))
}

/// Parse an OpenAI-compatible `GET /models` body.
/// Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
#[wasm_bindgen]
pub fn parse_models_response(body: &str) -> String {
    result_json(&prism_core::client::parse_models_response(body))
}

/// Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
#[wasm_bindgen]
pub fn strip_thinking(content: &str) -> String {
    let (content, thinking) = thinking::strip_thinking(content);
    serde_json::to_string(&(content, thinking)).unwrap_or_else(|_| "[\"\",null]".into())
}

/// Prepend the scratchpad instruction to the first user message.
/// Takes and returns a JSON array of `{"role": "...", "content": "..."}`.
#[wasm_bindgen]
pub fn apply_thinking(messages_json: &str) -> String {
    match serde_json::from_str::<Vec<prism_core::client::ChatMessage>>(messages_json) {
        Ok(messages) => {
            let applied = thinking::apply_thinking_to_messages(&messages);
            serde_json::to_string(&applied).unwrap_or_else(|_| "[]".into())
        }
        Err(e) => serde_json::json!([{ "role": "system", "content": format!("apply_thinking: invalid input: {e}") }])
            .to_string(),
    }
}

/// The provider table: id, label, base_url, default_model, needs_key,
/// env (env-var names that may carry the key).
#[wasm_bindgen]
pub fn providers_json() -> String {
    serde_json::json!(PROVIDERS
        .iter()
        .map(|p| serde_json::json!({
            "id": p.id,
            "label": p.label,
            "base_url": p.base_url,
            "default_model": p.default_model,
            "needs_key": p.needs_key,
            "env": p.env,
        }))
        .collect::<Vec<_>>())
    .to_string()
}

/// Default settings as JSON.
#[wasm_bindgen]
pub fn default_settings_json() -> String {
    serde_json::to_string(&Settings::default()).unwrap_or_else(|_| "{}".into())
}

/// Normalize (parse + migrate) settings JSON. Absent fields fill from
/// defaults; the legacy single `api_key` moves into `provider_keys`.
/// Returns `{"Ok": settings}` or `{"Err": message}`.
#[wasm_bindgen]
pub fn normalize_settings_json(input: &str) -> String {
    result_json(&settings::settings_from_json(input).map_err(|e| e.to_string()))
}

/// Auto-title from the first user message (JSON array of messages in).
#[wasm_bindgen]
pub fn derive_title(messages_json: &str) -> String {
    match serde_json::from_str::<Vec<conversations::StoredMessage>>(messages_json) {
        Ok(messages) => conversations::derive_title(&messages).into(),
        Err(_) => "New chat".into(),
    }
}

/// Fresh conversation id (nanosecond hex).
#[wasm_bindgen]
pub fn new_conversation_id() -> String {
    conversations::new_id()
}

/// Ollama native API root from a possibly `/v1`-suffixed base URL.
#[wasm_bindgen]
pub fn ollama_root_url(base_url: &str) -> String {
    prism_core::providers::ollama_root_url(base_url)
}

/// Current unix epoch milliseconds (JS BigInt).
#[wasm_bindgen]
pub fn now_ms() -> u64 {
    conversations::now_ms()
}

// ---------------------------------------------------------------------------
// Request-body builders (the wire contract for hosts that drive HTTP)
// ---------------------------------------------------------------------------

fn parse_req<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid request JSON: {e}"))
}

/// Build the provider POST body for a direct stream request.
/// Input: JSON `StreamRequest` (base_url, api_key, model, temperature,
/// messages, max_tokens?, top_p?, frequency_penalty?, presence_penalty?).
/// Returns `{"Ok": body}` / `{"Err": message}`.
#[wasm_bindgen]
pub fn build_stream_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::StreamRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::stream_request_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}

/// Build the Ollama native `/api/chat` POST body.
/// Input: JSON `OllamaChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
#[wasm_bindgen]
pub fn build_ollama_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::OllamaChatRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::ollama_chat_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}

/// Build the prism-api `/api/chat` POST body.
/// Input: JSON `ApiChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
#[wasm_bindgen]
pub fn build_api_chat_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::ApiChatRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::api_chat_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}
