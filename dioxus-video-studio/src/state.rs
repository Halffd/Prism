//! Shared application state, provided once at the root and consumed by
//! every route: generation results, the Prism connection settings and
//! the chat conversations. Both persist to localStorage so a reload
//! keeps the configured provider and the chat history.

use dioxus::prelude::*;
use prism_core::client::ChatMessage;
use prism_core::providers::{self, ProviderDef};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Prism connection settings
// ---------------------------------------------------------------------------

/// The synthetic provider for a self-hosted prism-api backend
/// (`POST {server}/api/chat`, non-streaming — see prism-core client.rs).
pub const PRISM_API_ID: &str = "prism-api";
pub const PRISM_API_DEFAULT_URL: &str = "http://localhost:3000";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrismSettings {
    /// A `prism_core::providers::PROVIDERS` id, or `prism-api`.
    pub provider_id: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

impl PrismSettings {
    /// Settings for a provider preset. `prism-api` has no entry in the
    /// core table, so it gets its own defaults here.
    pub fn for_provider(provider_id: &str) -> Self {
        if provider_id == PRISM_API_ID {
            return Self {
                provider_id: provider_id.to_string(),
                base_url: PRISM_API_DEFAULT_URL.to_string(),
                model: "prism".to_string(),
                api_key: String::new(),
            };
        }
        let def = providers::find(provider_id).unwrap_or(&OPENAI_FALLBACK);
        Self {
            provider_id: def.id.to_string(),
            base_url: def.base_url.to_string(),
            model: def.default_model.to_string(),
            api_key: String::new(),
        }
    }

    pub fn provider_def(&self) -> Option<&'static ProviderDef> {
        providers::find(&self.provider_id)
    }

    pub fn provider_label(&self) -> String {
        if self.provider_id == PRISM_API_ID {
            return "Prism API (self-hosted)".to_string();
        }
        self.provider_def()
            .map(|d| d.label.to_string())
            .unwrap_or_else(|| self.provider_id.clone())
    }

    /// True when the current provider streams via the OpenAI-compatible
    /// SSE wire (all direct providers) vs Ollama's native NDJSON wire.
    pub fn is_ollama(&self) -> bool {
        self.provider_id == "ollama"
    }

    pub fn needs_key(&self) -> bool {
        if self.provider_id == PRISM_API_ID {
            return false;
        }
        self.provider_def().is_some_and(|d| d.needs_key)
    }

    /// Every selectable provider: the core table plus the self-hosted
    /// prism-api entry.
    pub fn all_providers() -> Vec<(String, String)> {
        let mut list: Vec<(String, String)> = providers::PROVIDERS
            .iter()
            .map(|d| (d.id.to_string(), d.label.to_string()))
            .collect();
        list.push((PRISM_API_ID.to_string(), "Prism API (self-hosted)".to_string()));
        list
    }
}

/// Fallback if the core table changes underneath us.
const OPENAI_FALLBACK: ProviderDef = ProviderDef {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4o",
    needs_key: true,
    env: &[],
};

/// localStorage key for the settings blob.
const SETTINGS_KEY: &str = "prism.studio.settings.v1";
/// localStorage key for the conversation history.
const CONVERSATIONS_KEY: &str = "prism.studio.conversations.v1";

mod persistence {
    use super::{Conversation, PrismSettings, CONVERSATIONS_KEY, SETTINGS_KEY};

    pub fn load_settings() -> Option<PrismSettings> {
        #[cfg(target_arch = "wasm32")]
        {
            let storage = web_sys::window()?.local_storage().ok()??;
            let raw = storage.get_item(SETTINGS_KEY).ok()??;
            serde_json::from_str(&raw).ok()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            None
        }
    }

    pub fn save_settings(settings: &PrismSettings) -> bool {
        #[cfg(target_arch = "wasm32")]
        {
            let Ok(Some(storage)) = web_sys::window().unwrap().local_storage() else {
                return false;
            };
            let Ok(json) = serde_json::to_string(settings) else {
                return false;
            };
            storage.set_item(SETTINGS_KEY, &json).is_ok()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = settings;
            false
        }
    }

    pub fn load_conversations() -> Vec<Conversation> {
        #[cfg(target_arch = "wasm32")]
        {
            let storage = web_sys::window().and_then(|w| w.local_storage().ok()).flatten();
            let raw = storage.and_then(|s| s.get_item(CONVERSATIONS_KEY).ok()).flatten();
            raw.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            Vec::new()
        }
    }

    pub fn save_conversations(conversations: &[Conversation]) -> bool {
        #[cfg(target_arch = "wasm32")]
        {
            let Ok(Some(storage)) = web_sys::window().unwrap().local_storage() else {
                return false;
            };
            let Ok(json) = serde_json::to_string(conversations) else {
                return false;
            };
            storage.set_item(CONVERSATIONS_KEY, &json).is_ok()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = conversations;
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Chat conversations
// ---------------------------------------------------------------------------

/// One chat turn shown in the transcript.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatEntry {
    pub role: String,
    pub content: String,
}

impl ChatEntry {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }

    pub fn is_user(&self) -> bool {
        self.role == "user"
    }
}

/// One conversation in the ChatGPT-style history rail. `id` is stable
/// while the app runs (a counter, not a timestamp — `SystemTime` is not
/// available on wasm). Titles are derived from the first user message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub entries: Vec<ChatEntry>,
}

impl Conversation {
    fn new(id: String) -> Self {
        Self {
            id,
            title: String::new(),
            entries: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Root state container
// ---------------------------------------------------------------------------

/// Signals shared across routes via context.
#[derive(Clone, Copy)]
pub struct StudioState {
    /// Generated clips (panel → workspace).
    pub generations: Signal<Vec<crate::components::workspace::VideoCard>>,
    /// True while a generation is being simulated.
    pub generating: Signal<bool>,
    /// Prism connection settings (persisted).
    pub settings: Signal<PrismSettings>,
    /// Chat conversations, newest first (persisted).
    pub conversations: Signal<Vec<Conversation>>,
    /// Id of the open conversation; empty = ChatGPT-style home state.
    pub active_chat: Signal<String>,
    /// Id counter for new conversations.
    chat_seq: Signal<u64>,
    /// True while a chat response is streaming in.
    pub streaming: Signal<bool>,
    /// Abort handle for the in-flight chat request, if any.
    pub abort: Signal<Option<crate::api::Abort>>,
    /// Mobile sidebar drawer visibility.
    pub sidebar_open: Signal<bool>,
}

impl StudioState {
    pub fn new() -> Self {
        let settings =
            persistence::load_settings().unwrap_or_else(|| PrismSettings::for_provider("openai"));
        let conversations = persistence::load_conversations();
        Self {
            generations: Signal::new(Vec::new()),
            generating: Signal::new(false),
            settings: Signal::new(settings),
            conversations: Signal::new(conversations),
            active_chat: Signal::new(String::new()),
            chat_seq: Signal::new(0),
            streaming: Signal::new(false),
            abort: Signal::new(None),
            sidebar_open: Signal::new(false),
        }
    }

    pub fn save_settings(&mut self, settings: PrismSettings) -> bool {
        let saved = persistence::save_settings(&settings);
        self.settings.set(settings);
        saved
    }

    // ---- value readers (signals are fields; these snapshot the values) ----

    pub fn read_settings(&self) -> PrismSettings {
        (self.settings)()
    }

    pub fn list_conversations(&self) -> Vec<Conversation> {
        (self.conversations)()
    }

    pub fn active_chat_id(&self) -> String {
        (self.active_chat)()
    }

    pub fn is_streaming(&self) -> bool {
        (self.streaming)()
    }

    pub fn abort_handle(&self) -> Option<crate::api::Abort> {
        (self.abort)()
    }

    pub fn drawer_open(&self) -> bool {
        (self.sidebar_open)()
    }

    // ---- conversation management (the ChatGPT-style history) ----

    /// Entries of the open conversation (empty in the home state).
    pub fn transcript(&self) -> Vec<ChatEntry> {
        let id = (self.active_chat)();
        (self.conversations)()
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.entries.clone())
            .unwrap_or_default()
    }

    /// Title of the open conversation ("" in the home state).
    pub fn conversation_title(&self) -> String {
        let id = (self.active_chat)();
        (self.conversations)()
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.title.clone())
            .unwrap_or_default()
    }

    /// Open the ChatGPT-style home state (no conversation).
    pub fn go_home(&mut self) {
        self.active_chat.set(String::new());
    }

    /// Create + activate a fresh conversation; returns its id.
    pub fn start_conversation(&mut self) -> String {
        let next = (self.chat_seq)() + 1;
        self.chat_seq.set(next);
        let id = format!("c{next}");
        self.conversations.write().insert(0, Conversation::new(id.clone()));
        self.active_chat.set(id.clone());
        self.persist();
        id
    }

    pub fn select_chat(&mut self, id: String) {
        self.active_chat.set(id);
    }

    pub fn delete_chat(&mut self, id: String) {
        self.conversations.write().retain(|c| c.id != id);
        if (self.active_chat)() == id {
            self.active_chat.set(String::new());
        }
        self.persist();
    }

    /// Ensure an active conversation exists (creating one if the page is
    /// in the home state); returns its id.
    fn ensure_conversation(&mut self) -> String {
        let current = (self.active_chat)();
        if current.is_empty() || !(self.conversations)().iter().any(|c| c.id == current) {
            return self.start_conversation();
        }
        current
    }

    /// Append the user turn + an empty assistant placeholder to the open
    /// conversation, auto-titling it from the first message.
    pub fn push_user(&mut self, text: String) {
        let id = self.ensure_conversation();
        let mut list = self.conversations.write();
        if let Some(conv) = list.iter_mut().find(|c| c.id == id) {
            if conv.title.is_empty() {
                let mut title: String = text.trim().chars().take(48).collect();
                if text.trim().chars().count() > 48 {
                    title.push('…');
                }
                conv.title = title;
            }
            conv.entries.push(ChatEntry::user(text));
            conv.entries.push(ChatEntry::assistant(String::new()));
        }
    }

    /// Append text to the last (assistant) entry — the streaming path.
    pub fn append_last(&mut self, text: &str) {
        let id = (self.active_chat)();
        let mut list = self.conversations.write();
        if let Some(conv) = list.iter_mut().find(|c| c.id == id) {
            if let Some(last) = conv.entries.last_mut() {
                last.content.push_str(text);
            }
        }
    }

    /// Replace the last (assistant) entry's content — the non-streaming
    /// prism-api path.
    pub fn set_last(&mut self, text: String) {
        let id = (self.active_chat)();
        let mut list = self.conversations.write();
        if let Some(conv) = list.iter_mut().find(|c| c.id == id) {
            if let Some(last) = conv.entries.last_mut() {
                last.content = text;
            }
        }
    }

    /// Drop the last entry (used by Regenerate).
    pub fn pop_last(&mut self) {
        let id = (self.active_chat)();
        let mut list = self.conversations.write();
        if let Some(conv) = list.iter_mut().find(|c| c.id == id) {
            conv.entries.pop();
        }
    }

    /// Write the conversation list to localStorage.
    pub fn persist(&self) {
        let list = (self.conversations)();
        persistence::save_conversations(&list);
    }

    /// A system primer for chat requests, in the spirit of the Prism
    /// system prompt: concise, direct, no filler.
    pub fn chat_messages(&self, user_text: &str) -> Vec<ChatMessage> {
        let mut messages = vec![ChatMessage::text(
            "system",
            "You are Prism, a concise assistant embedded in a video generation studio.",
        )];
        for entry in self.transcript() {
            messages.push(ChatMessage::text(&entry.role, &entry.content));
        }
        messages.push(ChatMessage::text("user", user_text));
        messages
    }
}
