//! Turn settings + history into a background chat job.
//!
//! Mirrors the proven egui host recipe: system prompt first, thinking
//! instruction applied to messages, hardware overrides only on Ollama's
//! native endpoint, Prism API sends only the latest user content.

use crate::events::{self, Event};
use prism_core::client::{
    ApiChatRequest, ChatMessage, OllamaChatRequest, StreamEvent, StreamRequest,
};
use prism_core::host;
use prism_core::providers;
use prism_core::settings::{Connection, Settings};
use prism_core::thinking;
use std::sync::mpsc::Sender;

/// Start a generation in the background. `tx` receives `Event::Stream`
/// updates. Returns `Err` with a user-facing message for missing keys.
pub fn start_job(
    settings: &Settings,
    mut history: Vec<ChatMessage>,
    tx: &Sender<Event>,
) -> Result<(), String> {
    let (stx, srx) = std::sync::mpsc::channel::<StreamEvent>();
    match settings.connection {
        Connection::Direct => {
            let def = providers::find(&settings.provider);
            let needs_key = def.map(|d| d.needs_key).unwrap_or(false);
            let key = settings.key_for(&settings.provider);
            if needs_key && key.trim().is_empty() {
                let label = def.map(|d| d.label).unwrap_or("provider");
                return Err(format!("API key required for {label} — /key <key>"));
            }
            if !settings.system_prompt.trim().is_empty() {
                history.insert(
                    0,
                    ChatMessage {
                        role: "system".into(),
                        content: settings.system_prompt.trim().to_string(),
                    },
                );
            }
            if settings.thinking_enabled {
                history = thinking::apply_thinking_to_messages(&history);
            }
            // Hardware overrides only reach Ollama through its native
            // endpoint; the OpenAI-compat path ignores them.
            let hw = &settings.hardware;
            if settings.provider == "ollama" && hw.has_overrides() {
                let root = providers::ollama_root_url(&settings.local_base_url);
                let num_gpu = if hw.preferred_compute == "cpu-only" {
                    Some(0)
                } else {
                    hw.gpu_layers_override
                };
                let req = OllamaChatRequest {
                    base_url: root,
                    model: effective_model(settings),
                    temperature: settings.temperature,
                    messages: history,
                    num_ctx: hw.context_tokens,
                    num_gpu,
                    max_tokens: settings.max_tokens,
                };
                host::spawn_ollama_chat(req, stx);
            } else {
                let base_url = def.map(|d| d.base_url.to_string()).unwrap_or_default();
                let req = StreamRequest {
                    base_url,
                    api_key: key.trim().to_string(),
                    model: effective_model(settings),
                    temperature: settings.temperature,
                    messages: history,
                    max_tokens: settings.max_tokens,
                    top_p: settings.top_p,
                    frequency_penalty: settings.frequency_penalty,
                    presence_penalty: settings.presence_penalty,
                };
                host::spawn_stream(req, stx);
            }
        }
        Connection::PrismApi => {
            if settings.prism_api_token.trim().is_empty() {
                return Err("Prism API token required — set prism_api_token in settings".into());
            }
            let req = ApiChatRequest {
                server_url: settings.prism_api_url.trim().to_string(),
                token: settings.prism_api_token.trim().to_string(),
                content: history
                    .last()
                    .map(|m| m.content.clone())
                    .unwrap_or_default(),
            };
            host::spawn_api_chat(req, stx);
        }
    }
    events::spawn_stream_forward(srx, tx.clone());
    Ok(())
}

pub fn effective_model(settings: &Settings) -> String {
    if !settings.model.trim().is_empty() {
        settings.model.trim().to_string()
    } else {
        providers::find(&settings.provider)
            .map(|p| p.default_model.to_string())
            .unwrap_or_default()
    }
}
