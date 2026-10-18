//! egui application: chat window with streaming responses, a
//! conversation sidebar and a settings side panel.
//!
//! Extension-parity features ported here: per-provider API keys,
//! fetch-models + per-provider recents, sampling parameters, system
//! prompt, thinking mode (`<thinking>` scratchpad), hardware profile
//! (via Ollama's native API) and conversation persistence.

use crate::bridge;
use prism_core::client::{
    ApiChatRequest, ChatMessage, ModelsEvent, ModelsRequest, OllamaChatRequest, StreamEvent,
    StreamRequest,
};
use prism_core::conversations::{self, Conversation, ConversationMeta, StoredMessage};
use prism_core::providers::{self, ollama_root_url, PROVIDERS};
use prism_core::settings::{Connection, Settings};
use prism_core::thinking;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::time::Duration;

/// One line in the chat transcript.
struct TranscriptLine {
    role: String, // "user" | "assistant" | "system"
    content: String,
    /// Reasoning extracted from `<thinking>` tags at stream end
    /// (assistant lines only); content is the cleaned answer then.
    thinking: Option<String>,
}

/// Matches COMPUTE_LEVELS in the TUI settings screen / shared types.
const COMPUTE_LEVELS: &[&str] = &[
    "auto",
    "cpu-only",
    "gpu-auto",
    "gpu-nvidia",
    "gpu-amd",
    "gpu-intel",
];

/// undefined = server default (no num_gpu override). 99 = offload all layers.
const GPU_LAYER_CYCLE: &[Option<u32>] = &[
    None,
    Some(0),
    Some(8),
    Some(16),
    Some(24),
    Some(32),
    Some(99),
];

/// undefined = server default (no num_ctx override).
const CONTEXT_TOKEN_CYCLE: &[Option<u32>] = &[
    None,
    Some(1024),
    Some(2048),
    Some(4096),
    Some(8192),
    Some(16384),
    Some(32768),
];

pub struct PrismApp {
    settings: Settings,
    transcript: Vec<TranscriptLine>,
    input: String,
    streaming: bool,
    rx: Option<Receiver<StreamEvent>>,

    // Conversations.
    show_chats: bool,
    chat_list: Vec<ConversationMeta>,
    current_id: Option<String>,
    current_created: u64,
    confirm_delete: Option<String>,

    // Background model-list fetch.
    rx_models: Option<Receiver<ModelsEvent>>,
    models_status: String,

    // Settings panel.
    show_settings: bool,
    settings_status: String,
    // Draft buffers for optional numeric fields; parsed every frame,
    // empty means "omit from request".
    max_tokens_buf: String,
    top_p_buf: String,
    freq_buf: String,
    pres_buf: String,
}

impl PrismApp {
    pub fn new() -> Self {
        let settings = bridge::load_settings();
        let mut app = PrismApp {
            settings,
            transcript: Vec::new(),
            input: String::new(),
            streaming: false,
            rx: None,
            show_chats: true,
            chat_list: Vec::new(),
            current_id: None,
            current_created: 0,
            confirm_delete: None,
            rx_models: None,
            models_status: String::new(),
            show_settings: true,
            settings_status: String::new(),
            max_tokens_buf: String::new(),
            top_p_buf: String::new(),
            freq_buf: String::new(),
            pres_buf: String::new(),
        };
        app.sync_bufs_from_settings();
        app.refresh_chats();
        app
    }

    fn sync_bufs_from_settings(&mut self) {
        let s = &self.settings;
        self.max_tokens_buf = opt_to_buf(s.max_tokens.map(|v| v.to_string()));
        self.top_p_buf = opt_to_buf(s.top_p.map(|v| v.to_string()));
        self.freq_buf = opt_to_buf(s.frequency_penalty.map(|v| v.to_string()));
        self.pres_buf = opt_to_buf(s.presence_penalty.map(|v| v.to_string()));
    }

    /// Resolve the effective model id (settings override or provider default).
    fn effective_model(&self) -> String {
        if !self.settings.model.trim().is_empty() {
            self.settings.model.trim().to_string()
        } else {
            providers::find(&self.settings.provider)
                .map(|p| p.default_model.to_string())
                .unwrap_or_default()
        }
    }

    fn push_system(&mut self, text: String) {
        self.transcript.push(TranscriptLine {
            role: "system".into(),
            content: text,
            thinking: None,
        });
    }

    /// Conversation history for the model, excluding system lines.
    fn history(&self) -> Vec<ChatMessage> {
        self.transcript
            .iter()
            .filter(|l| l.role != "system")
            .map(|l| ChatMessage {
                role: l.role.clone(),
                content: l.content.clone(),
            })
            .collect()
    }

    fn send(&mut self) {
        let content = self.input.trim().to_string();
        if content.is_empty() || self.streaming {
            return;
        }
        self.input.clear();

        // Build the request from history BEFORE appending the new
        // user message and the assistant placeholder to the transcript.
        let mut history = self.history();
        history.push(ChatMessage {
            role: "user".into(),
            content: content.clone(),
        });

        self.transcript.push(TranscriptLine {
            role: "user".into(),
            content,
            thinking: None,
        });
        self.transcript.push(TranscriptLine {
            role: "assistant".into(),
            content: String::new(),
            thinking: None,
        });

        let (tx, rx) = mpsc::channel::<StreamEvent>();

        match self.settings.connection {
            Connection::Direct => {
                let def = providers::find(&self.settings.provider);
                let needs_key = def.map(|d| d.needs_key).unwrap_or(false);
                let key = self.settings.key_for(&self.settings.provider);
                if needs_key && key.trim().is_empty() {
                    let label = def.map(|d| d.label).unwrap_or("provider");
                    self.push_system(format!("API key required for {label}. Open settings."));
                    return;
                }

                // System prompt first, like the extension's adapter does.
                if !self.settings.system_prompt.trim().is_empty() {
                    history.insert(
                        0,
                        ChatMessage {
                            role: "system".into(),
                            content: self.settings.system_prompt.trim().to_string(),
                        },
                    );
                }
                // Thinking scratchpad instruction on the first user message.
                if self.settings.thinking_enabled {
                    history = thinking::apply_thinking_to_messages(&history);
                }

                // Hardware overrides only reach Ollama through its native
                // endpoint; the OpenAI-compat path ignores them.
                let hw = &self.settings.hardware;
                if self.settings.provider == "ollama" && hw.has_overrides() {
                    let root = ollama_root_url(&self.settings.local_base_url);
                    let num_gpu = if hw.preferred_compute == "cpu-only" {
                        Some(0)
                    } else {
                        hw.gpu_layers_override
                    };
                    let req = OllamaChatRequest {
                        base_url: root,
                        model: self.effective_model(),
                        temperature: self.settings.temperature,
                        messages: history,
                        num_ctx: hw.context_tokens,
                        num_gpu,
                        max_tokens: self.settings.max_tokens,
                    };
                    self.streaming = true;
                    self.rx = Some(rx);
                    bridge::spawn_ollama_chat(req, tx);
                } else {
                    let base_url = def.map(|d| d.base_url.to_string()).unwrap_or_default();
                    let req = StreamRequest {
                        base_url,
                        api_key: key.trim().to_string(),
                        model: self.effective_model(),
                        temperature: self.settings.temperature,
                        messages: history,
                        max_tokens: self.settings.max_tokens,
                        top_p: self.settings.top_p,
                        frequency_penalty: self.settings.frequency_penalty,
                        presence_penalty: self.settings.presence_penalty,
                    };
                    self.streaming = true;
                    self.rx = Some(rx);
                    bridge::spawn_stream(req, tx);
                }
            }
            Connection::PrismApi => {
                if self.settings.prism_api_token.trim().is_empty() {
                    self.push_system("Prism API token required. Open settings.".into());
                    return;
                }
                let req = ApiChatRequest {
                    server_url: self.settings.prism_api_url.trim().to_string(),
                    token: self.settings.prism_api_token.trim().to_string(),
                    content: history
                        .last()
                        .map(|m| m.content.clone())
                        .unwrap_or_default(),
                };
                self.streaming = true;
                self.rx = Some(rx);
                bridge::spawn_api_chat(req, tx);
            }
        }

        self.persist_current();
    }

    /// Drain stream events from the background task.
    fn drain_events(&mut self, ctx: &egui::Context) {
        let mut still_open = false;
        if let Some(rx) = &self.rx {
            loop {
                match rx.try_recv() {
                    Ok(StreamEvent::Chunk(text)) => {
                        if let Some(last) = self.transcript.last_mut() {
                            last.content.push_str(&text);
                        }
                    }
                    Ok(StreamEvent::Done) => {
                        self.streaming = false;
                        self.rx = None;
                        self.finalize_thinking();
                        self.persist_current();
                        break;
                    }
                    Ok(StreamEvent::Error(e)) => {
                        self.streaming = false;
                        self.rx = None;
                        self.push_system(format!("Error: {e}"));
                        self.finalize_thinking();
                        self.persist_current();
                        break;
                    }
                    Err(TryRecvError::Empty) => {
                        still_open = true;
                        break;
                    }
                    Err(TryRecvError::Disconnected) => {
                        self.streaming = false;
                        self.rx = None;
                        break;
                    }
                }
            }
        }
        if still_open {
            ctx.request_repaint_after(Duration::from_millis(50));
        }
    }

    /// Drain background model-list fetch results.
    fn drain_models(&mut self) {
        if let Some(rx) = &self.rx_models {
            match rx.try_recv() {
                Ok(ModelsEvent::Loaded { models }) => {
                    let n = models.len();
                    let cache = self
                        .settings
                        .model_cache
                        .entry(self.settings.provider.clone())
                        .or_default();
                    for m in models {
                        if !cache.contains(&m) {
                            cache.push(m);
                        }
                    }
                    self.models_status = format!("fetched {n} models");
                    self.rx_models = None;
                }
                Ok(ModelsEvent::Error(e)) => {
                    self.models_status = format!("fetch failed: {e}");
                    self.rx_models = None;
                }
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => {
                    self.rx_models = None;
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Conversation persistence
    // -----------------------------------------------------------------------

    /// Split `<thinking>…</thinking>` out of the final assistant line so
    /// the stored message carries separated reasoning.
    fn finalize_thinking(&mut self) {
        if let Some(last) = self.transcript.last_mut() {
            if last.role == "assistant"
                && last.thinking.is_none()
                && last.content.contains("<thinking>")
            {
                let (clean, reasoning) = thinking::strip_thinking(&last.content);
                if let Some(reasoning) = reasoning {
                    last.content = clean;
                    last.thinking = Some(reasoning);
                }
            }
        }
    }

    fn refresh_chats(&mut self) {
        self.chat_list = bridge::list_conversations();
    }

    /// Save the current transcript (creates the conversation file on
    /// first send). Empty transcripts are not saved.
    fn persist_current(&mut self) {
        if self.transcript.is_empty() {
            return;
        }
        let now = conversations::now_ms();
        if self.current_id.is_none() {
            self.current_id = Some(conversations::new_id());
        }
        if self.current_created == 0 {
            self.current_created = now;
        }
        let stored: Vec<StoredMessage> = self
            .transcript
            .iter()
            .map(|l| StoredMessage {
                role: l.role.clone(),
                content: l.content.clone(),
                thinking: l.thinking.clone(),
            })
            .collect();
        let conv = Conversation {
            id: self.current_id.clone().unwrap_or_default(),
            title: conversations::derive_title(&stored),
            created_at: self.current_created,
            updated_at: now,
            messages: stored,
        };
        if let Err(e) = bridge::save_conversation(&conv) {
            self.push_system(format!("failed to save conversation: {e}"));
        }
        self.refresh_chats();
    }

    fn require_idle(&mut self) -> bool {
        if self.streaming {
            self.push_system("Wait for the response to finish.".into());
            return false;
        }
        true
    }

    fn start_new_chat(&mut self) {
        if !self.require_idle() {
            return;
        }
        self.persist_current();
        self.transcript.clear();
        self.current_id = None;
        self.current_created = 0;
        self.confirm_delete = None;
        self.refresh_chats();
    }

    fn open_chat(&mut self, id: &str) {
        if !self.require_idle() || self.current_id.as_deref() == Some(id) {
            return;
        }
        self.persist_current();
        match bridge::load_conversation(id) {
            Some(c) => {
                self.transcript = c
                    .messages
                    .iter()
                    .map(|m| TranscriptLine {
                        role: m.role.clone(),
                        content: m.content.clone(),
                        thinking: m.thinking.clone(),
                    })
                    .collect();
                self.current_id = Some(c.id);
                self.current_created = c.created_at;
                self.confirm_delete = None;
            }
            None => self.push_system("conversation not found".into()),
        }
    }

    fn delete_chat(&mut self, id: &str) {
        if !self.require_idle() {
            return;
        }
        if let Err(e) = bridge::delete_conversation(id) {
            self.push_system(format!("failed to delete conversation: {e}"));
        }
        if self.current_id.as_deref() == Some(id) {
            self.transcript.clear();
            self.current_id = None;
            self.current_created = 0;
        }
        self.confirm_delete = None;
        self.refresh_chats();
    }
}

/// Render optional numeric draft buffers: `None` renders as empty.
fn opt_to_buf(v: Option<String>) -> String {
    v.unwrap_or_default()
}

/// Parse an optional u32 draft: empty -> None (omit), invalid -> keep old.
fn parse_opt_u32(buf: &str) -> Option<Option<u32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<u32>().ok().map(Some)
    }
}

/// Parse an optional f32 draft: empty -> None (omit), invalid -> keep old.
fn parse_opt_f32(buf: &str) -> Option<Option<f32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<f32>().ok().map(Some)
    }
}

/// Ollama native API root from a possibly `/v1`-suffixed base URL.
impl Default for PrismApp {
    fn default() -> Self {
        Self::new()
    }
}

impl eframe::App for PrismApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.drain_events(&ctx);
        self.drain_models();

        // Top bar: chats toggle, connection mode, provider, model, settings.
        egui::Panel::top("top_bar").show(ui, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.toggle_value(&mut self.show_chats, "Chats");

                let connection_label = match self.settings.connection {
                    Connection::Direct => "Direct",
                    Connection::PrismApi => "Prism API",
                };
                egui::ComboBox::from_id_salt("connection")
                    .selected_text(connection_label)
                    .width(100.0)
                    .show_ui(ui, |ui| {
                        ui.selectable_value(
                            &mut self.settings.connection,
                            Connection::Direct,
                            "Direct",
                        );
                        ui.selectable_value(
                            &mut self.settings.connection,
                            Connection::PrismApi,
                            "Prism API",
                        );
                    });

                if self.settings.connection == Connection::Direct {
                    let current = providers::find(&self.settings.provider)
                        .map(|p| p.label)
                        .unwrap_or("?");
                    egui::ComboBox::from_id_salt("provider")
                        .selected_text(current)
                        .width(170.0)
                        .show_ui(ui, |ui| {
                            for p in PROVIDERS {
                                ui.selectable_value(
                                    &mut self.settings.provider,
                                    p.id.to_string(),
                                    p.label,
                                );
                            }
                        });
                }

                let hint = if self.settings.model.trim().is_empty() {
                    format!("default: {}", self.effective_model())
                } else {
                    String::new()
                };
                ui.add(
                    egui::TextEdit::singleline(&mut self.settings.model)
                        .hint_text(hint)
                        .desired_width(180.0),
                );

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.toggle_value(&mut self.show_settings, "Settings");
                    if self.streaming {
                        ui.colored_label(egui::Color32::YELLOW, "…responding");
                    }
                });
            });
            ui.add_space(4.0);
        });

        // Left sidebar: saved conversations.
        if self.show_chats {
            egui::Panel::left("chats_panel")
                .resizable(true)
                .default_size(200.0)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.heading("Chats");
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.small_button("+").clicked() {
                                self.start_new_chat();
                            }
                        });
                    });
                    ui.separator();
                    egui::ScrollArea::vertical()
                        .auto_shrink([false, false])
                        .show(ui, |ui| {
                            if self.chat_list.is_empty() {
                                ui.label(egui::RichText::new("No saved chats yet.").weak().small());
                            }
                            for meta in self.chat_list.clone() {
                                ui.horizontal(|ui| {
                                    let current =
                                        self.current_id.as_deref() == Some(meta.id.as_str());
                                    if ui.selectable_label(current, &meta.title).clicked() {
                                        self.open_chat(&meta.id);
                                    }
                                    ui.with_layout(
                                        egui::Layout::right_to_left(egui::Align::Center),
                                        |ui| {
                                            let confirming = self.confirm_delete.as_deref()
                                                == Some(meta.id.as_str());
                                            let label = if confirming { "sure?" } else { "✕" };
                                            if ui
                                                .small_button(egui::RichText::new(label).small())
                                                .clicked()
                                            {
                                                if confirming {
                                                    self.delete_chat(&meta.id);
                                                } else {
                                                    self.confirm_delete = Some(meta.id.clone());
                                                }
                                            }
                                        },
                                    );
                                });
                            }
                        });
                });
        }

        // Right settings panel, grouped like the extension's settings page.
        if self.show_settings {
            egui::Panel::right("settings_panel")
                .resizable(true)
                .default_size(340.0)
                .show(ui, |ui| {
                    egui::ScrollArea::vertical()
                        .auto_shrink([false, false])
                        .show(ui, |ui| {
                            ui.heading("Settings");
                            ui.separator();

                            egui::CollapsingHeader::new("Connection")
                                .default_open(true)
                                .show(ui, |ui| {
                                    match self.settings.connection {
                                        Connection::Direct => {
                                            ui.label("Talking directly to the provider.");
                                        }
                                        Connection::PrismApi => {
                                            ui.label("Server URL");
                                            ui.add(egui::TextEdit::singleline(
                                                &mut self.settings.prism_api_url,
                                            ));
                                            ui.label("JWT token");
                                            ui.add(
                                                egui::TextEdit::singleline(
                                                    &mut self.settings.prism_api_token,
                                                )
                                                .password(true),
                                            );
                                        }
                                    }
                                });

                            egui::CollapsingHeader::new("Provider & model")
                                .default_open(true)
                                .show(ui, |ui| {
                                    ui.label("Model (empty = provider default)");
                                    let model_hint = if self.settings.model.trim().is_empty() {
                                        self.effective_model()
                                    } else {
                                        String::new()
                                    };
                                    ui.add(
                                        egui::TextEdit::singleline(&mut self.settings.model)
                                            .hint_text(model_hint),
                                    );

                                    let fetching = self.rx_models.is_some();
                                    let fetch_label =
                                        if fetching { "Fetching…" } else { "Fetch models" };
                                    if ui.button(fetch_label).clicked() && !fetching {
                                        self.fetch_models(ui);
                                    }
                                    ui.label(
                                        egui::RichText::new(&self.models_status).small(),
                                    );

                                    let cached = self
                                        .settings
                                        .model_cache
                                        .get(&self.settings.provider)
                                        .cloned()
                                        .unwrap_or_default();
                                    if !cached.is_empty() {
                                        ui.label("Cached models (click to use):");
                                        egui::ScrollArea::vertical()
                                            .max_height(120.0)
                                            .show(ui, |ui| {
                                                for m in cached {
                                                    let selected =
                                                        self.settings.model == m;
                                                    if ui
                                                        .selectable_label(selected, &m)
                                                        .clicked()
                                                    {
                                                        self.settings.model = m;
                                                    }
                                                }
                                            });
                                    }

                                    if self.settings.provider == "ollama" {
                                        ui.label("Ollama URL");
                                        ui.add(egui::TextEdit::singleline(
                                            &mut self.settings.local_base_url,
                                        ));
                                    }
                                });

                            if self.settings.connection == Connection::Direct {
                                egui::CollapsingHeader::new("API keys")
                                    .default_open(false)
                                    .show(ui, |ui| {
                                        for p in PROVIDERS.iter().filter(|p| p.needs_key) {
                                            ui.label(p.label);
                                            let key = self
                                                .settings
                                                .provider_keys
                                                .entry(p.id.to_string())
                                                .or_default();
                                            ui.add(
                                                egui::TextEdit::singleline(key)
                                                    .password(true),
                                            );
                                        }
                                        ui.label(
                                            egui::RichText::new(
                                                "Stored in plaintext, like the extension.",
                                            )
                                            .small()
                                            .weak(),
                                        );
                                    });

                                egui::CollapsingHeader::new("Sampling")
                                    .default_open(false)
                                    .show(ui, |ui| {
                                        egui::Grid::new("sampling_grid")
                                            .num_columns(2)
                                            .spacing([8.0, 6.0])
                                            .show(ui, |ui| {
                                                ui.label("Temperature");
                                                ui.add(
                                                    egui::Slider::new(
                                                        &mut self.settings.temperature,
                                                        0.0..=2.0,
                                                    )
                                                    .step_by(0.05),
                                                );
                                                ui.end_row();

                                                ui.label("Max tokens");
                                                ui.add(egui::TextEdit::singleline(
                                                    &mut self.max_tokens_buf,
                                                ));
                                                ui.end_row();

                                                ui.label("Top P");
                                                ui.add(egui::TextEdit::singleline(
                                                    &mut self.top_p_buf,
                                                ));
                                                ui.end_row();

                                                ui.label("Frequency penalty");
                                                ui.add(egui::TextEdit::singleline(
                                                    &mut self.freq_buf,
                                                ));
                                                ui.end_row();

                                                ui.label("Presence penalty");
                                                ui.add(egui::TextEdit::singleline(
                                                    &mut self.pres_buf,
                                                ));
                                                ui.end_row();
                                            });
                                        ui.label(
                                            egui::RichText::new(
                                                "Empty = omit (server default).",
                                            )
                                            .small()
                                            .weak(),
                                        );
                                        self.apply_sampling_bufs();
                                    });

                                egui::CollapsingHeader::new("System prompt")
                                    .default_open(false)
                                    .show(ui, |ui| {
                                        ui.add(
                                            egui::TextEdit::multiline(
                                                &mut self.settings.system_prompt,
                                            )
                                            .desired_rows(4),
                                        );
                                    });

                                egui::CollapsingHeader::new("Thinking")
                                    .default_open(false)
                                    .show(ui, |ui| {
                                        ui.checkbox(
                                            &mut self.settings.thinking_enabled,
                                            "Reason in <thinking> tags first",
                                        );
                                        ui.label(
                                            egui::RichText::new(
                                                "Shown as a collapsible block above the answer.",
                                            )
                                            .small()
                                            .weak(),
                                        );
                                    });

                                egui::CollapsingHeader::new("Hardware")
                                    .default_open(false)
                                    .show(ui, |ui| {
                                        let hw = &mut self.settings.hardware;
                                        let compute_idx = COMPUTE_LEVELS
                                            .iter()
                                            .position(|c| *c == hw.preferred_compute)
                                            .unwrap_or(0);
                                        ui.label("Preferred compute");
                                        egui::ComboBox::from_id_salt("compute")
                                            .selected_text(COMPUTE_LEVELS[compute_idx])
                                            .show_ui(ui, |ui| {
                                                for (i, c) in
                                                    COMPUTE_LEVELS.iter().enumerate()
                                                {
                                                    if ui
                                                        .selectable_label(
                                                            i == compute_idx, *c,
                                                        )
                                                        .clicked()
                                                    {
                                                        hw.preferred_compute =
                                                            c.to_string();
                                                    }
                                                }
                                            });

                                        let gpu_idx = GPU_LAYER_CYCLE
                                            .iter()
                                            .position(|g| *g == hw.gpu_layers_override)
                                            .unwrap_or(0);
                                        let next_gpu = GPU_LAYER_CYCLE
                                            [(gpu_idx + 1) % GPU_LAYER_CYCLE.len()];
                                        let gpu_label = hw
                                            .gpu_layers_override
                                            .map(|g| g.to_string())
                                            .unwrap_or_else(|| "default".into());
                                        if ui
                                            .button(format!(
                                                "GPU layers: {gpu_label} (cycle)"
                                            ))
                                            .clicked()
                                        {
                                            hw.gpu_layers_override = next_gpu;
                                        }

                                        let ctx_idx = CONTEXT_TOKEN_CYCLE
                                            .iter()
                                            .position(|c| *c == hw.context_tokens)
                                            .unwrap_or(0);
                                        let next_ctx = CONTEXT_TOKEN_CYCLE
                                            [(ctx_idx + 1) % CONTEXT_TOKEN_CYCLE.len()];
                                        let ctx_label = hw
                                            .context_tokens
                                            .map(|c| c.to_string())
                                            .unwrap_or_else(|| "default".into());
                                        if ui
                                            .button(format!(
                                                "Context tokens: {ctx_label} (cycle)"
                                            ))
                                            .clicked()
                                        {
                                            hw.context_tokens = next_ctx;
                                        }

                                        ui.label(
                                            egui::RichText::new(
                                                "Applied via Ollama's native /api/chat when set; llama.cpp/KoboldCpp take these as launch flags.",
                                            )
                                            .small()
                                            .weak(),
                                        );
                                    });
                            }

                            ui.add_space(8.0);
                            ui.horizontal(|ui| {
                                if ui.button("Save settings").clicked() {
                                    self.settings_status = match bridge::save_settings(&self.settings) {
                                        Ok(()) => match bridge::settings_path() {
                                            Some(path) => format!("saved to {}", path.display()),
                                            None => "saved".into(),
                                        },
                                        Err(e) => format!("save failed: {e}"),
                                    };
                                }
                                ui.colored_label(
                                    egui::Color32::GRAY,
                                    self.settings_status.clone(),
                                );
                            });
                        });
                });
        }

        // Input area (declared before the central panel so the
        // central transcript takes the remaining space above it).
        egui::Panel::bottom("input_bar").show(ui, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let send_clicked = ui
                    .add_enabled(!self.streaming, egui::Button::new("Send"))
                    .clicked();
                let response = ui.add(
                    egui::TextEdit::multiline(&mut self.input)
                        .hint_text("Type a message… (Enter to send, Shift+Enter for newline)")
                        .desired_rows(2),
                );
                let enter_sends = response.lost_focus()
                    && ui.input(|i| i.key_pressed(egui::Key::Enter))
                    && !ui.input(|i| i.modifiers.shift);
                if (send_clicked || enter_sends) && !self.input.trim().is_empty() {
                    self.send();
                }
            });
            ui.add_space(2.0);
        });

        // Transcript.
        egui::CentralPanel::default().show(ui, |ui| {
            egui::ScrollArea::vertical()
                .stick_to_bottom(true)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    if self.transcript.is_empty() {
                        ui.vertical_centered(|ui| {
                            ui.add_space(40.0);
                            ui.label("Prism — pick a provider in Settings, then say hello.");
                        });
                    }
                    for line in &self.transcript {
                        match line.role.as_str() {
                            "user" => {
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new("You")
                                        .strong()
                                        .color(egui::Color32::LIGHT_BLUE),
                                );
                                ui.label(&line.content);
                            }
                            "assistant" => {
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new("Prism")
                                        .strong()
                                        .color(egui::Color32::LIGHT_GREEN),
                                );
                                let (reasoning, answer) = if let Some(t) = &line.thinking {
                                    (Some(t.as_str()), line.content.as_str())
                                } else {
                                    thinking::split_display(&line.content)
                                };
                                if let Some(reasoning) = reasoning {
                                    let open = self.streaming && answer.is_empty();
                                    egui::CollapsingHeader::new("Thinking")
                                        .default_open(open)
                                        .show(ui, |ui| {
                                            ui.label(egui::RichText::new(reasoning).weak().small());
                                        });
                                }
                                if !answer.is_empty() {
                                    ui.label(answer);
                                } else if reasoning.is_none() {
                                    if line.content.is_empty() && self.streaming {
                                        ui.label(egui::RichText::new("…").weak());
                                    } else {
                                        ui.label(&line.content);
                                    }
                                }
                            }
                            _ => {
                                ui.add_space(2.0);
                                ui.label(
                                    egui::RichText::new(&line.content)
                                        .small()
                                        .color(egui::Color32::ORANGE),
                                );
                            }
                        }
                        ui.separator();
                    }
                });
        });
    }
}

impl PrismApp {
    /// Spawn a background fetch of the current provider's model list.
    fn fetch_models(&mut self, ui: &mut egui::Ui) {
        let provider = self.settings.provider.clone();
        let key = self.settings.key_for(&provider);
        let base_url = if provider == "ollama" {
            self.settings.local_base_url.trim().to_string()
        } else {
            providers::find(&provider)
                .map(|p| p.base_url.to_string())
                .unwrap_or_default()
        };
        let needs_key = providers::find(&provider)
            .map(|p| p.needs_key)
            .unwrap_or(false);
        if base_url.is_empty() || (needs_key && key.trim().is_empty()) {
            self.models_status = "set an API key first".into();
            return;
        }
        let _ = ui.ctx(); // request happens on the shared runtime
        let (tx, rx) = mpsc::channel();
        self.rx_models = Some(rx);
        self.models_status = "fetching…".into();
        bridge::spawn_models_fetch(
            ModelsRequest {
                base_url,
                api_key: key.trim().to_string(),
            },
            tx,
        );
    }

    /// Push parsed draft buffers into settings (invalid input keeps the
    /// previous value).
    fn apply_sampling_bufs(&mut self) {
        if let Some(v) = parse_opt_u32(&self.max_tokens_buf) {
            self.settings.max_tokens = v;
        }
        if let Some(v) = parse_opt_f32(&self.top_p_buf) {
            self.settings.top_p = v;
        }
        if let Some(v) = parse_opt_f32(&self.freq_buf) {
            self.settings.frequency_penalty = v;
        }
        if let Some(v) = parse_opt_f32(&self.pres_buf) {
            self.settings.presence_penalty = v;
        }
    }
}
