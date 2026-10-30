// Shared application logic for both desktop and Android

slint::include_modules!();

// Re-export all public types and functions from dependencies
pub use prism_core::client::{
    ApiChatRequest, ChatMessage, ModelsEvent, ModelsRequest, OllamaChatRequest, StreamEvent,
    StreamRequest,
};
pub use prism_core::conversations::{self, Conversation, ConversationMeta, StoredMessage};
pub use prism_core::providers::{self, ollama_root_url, PROVIDERS};
pub use prism_core::settings::{Connection, Settings};
pub use prism_core::{host, thinking};
pub use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
pub use std::cell::RefCell;
pub use std::rc::Rc;
pub use std::sync::mpsc::{self, Receiver, TryRecvError};

/// Matches COMPUTE_LEVELS in the TUI settings screen / shared types.
pub const COMPUTE_LEVELS: &[&str] = &[
    "auto",
    "cpu-only",
    "gpu-auto",
    "gpu-nvidia",
    "gpu-amd",
    "gpu-intel",
];

/// undefined = server default (no num_gpu override). 99 = offload all layers.
pub const GPU_LAYER_CYCLE: &[Option<u32>] = &[
    None,
    Some(0),
    Some(8),
    Some(16),
    Some(24),
    Some(32),
    Some(99),
];

/// undefined = server default (no num_ctx override).
pub const CONTEXT_TOKEN_CYCLE: &[Option<u32>] = &[
    None,
    Some(1024),
    Some(2048),
    Some(4096),
    Some(8192),
    Some(16384),
    Some(32768),
];

/// One line in the chat transcript.
#[derive(Clone, Debug)]
pub struct Line {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    /// Reasoning extracted from `<thinking>` tags at stream end.
    pub thinking: Option<String>,
}

impl Line {
    pub fn to_widget(&self) -> ChatLine {
        let (content, thinking) = if self.role == "assistant" {
            match &self.thinking {
                Some(t) => (self.content.clone(), Some(t.clone())),
                None => match thinking::split_display(&self.content) {
                    (Some(t), a) => (a.to_string(), Some(t.to_string())),
                    (None, c) => (c.to_string(), None),
                },
            }
        } else {
            (self.content.clone(), None)
        };
        ChatLine {
            role: self.role.as_str().into(),
            content: content.into(),
            thinking: thinking.unwrap_or_default().into(),
        }
    }
}

pub struct State {
    pub settings: Settings,
    pub lines: Vec<Line>,
    pub chats: Vec<ConversationMeta>,
    pub current_id: Option<String>,
    pub current_created: u64,
    pub confirm_delete: Option<String>,
    pub streaming: bool,
    pub rx: Option<Receiver<StreamEvent>>,
    pub rx_models: Option<Receiver<ModelsEvent>>,
    pub gpu_idx: usize,
    pub ctx_idx: usize,
}

impl State {
    pub fn new() -> Self {
        let settings = host::load_settings();
        let gpu_idx = GPU_LAYER_CYCLE
            .iter()
            .position(|g| *g == settings.hardware.gpu_layers_override)
            .unwrap_or(0);
        let ctx_idx = CONTEXT_TOKEN_CYCLE
            .iter()
            .position(|c| *c == settings.hardware.context_tokens)
            .unwrap_or(0);
        State {
            settings,
            lines: Vec::new(),
            chats: host::list_conversations(),
            current_id: None,
            current_created: 0,
            confirm_delete: None,
            streaming: false,
            rx: None,
            rx_models: None,
            gpu_idx,
            ctx_idx,
        }
    }
}

// All the functions previously in main.rs, shared by desktop and Android.

pub fn effective_model(settings: &Settings) -> String {
    if !settings.model.trim().is_empty() {
        settings.model.trim().to_string()
    } else {
        providers::find(&settings.provider)
            .map(|p| p.default_model.to_string())
            .unwrap_or_default()
    }
}

pub fn model_hint(settings: &Settings) -> SharedString {
    if settings.model.trim().is_empty() {
        effective_model(settings).into()
    } else {
        "".into()
    }
}

pub fn cached_models(settings: &Settings) -> Vec<SharedString> {
    settings
        .model_cache
        .get(&settings.provider)
        .map(|v| v.iter().map(|m| SharedString::from(m.clone())).collect())
        .unwrap_or_default()
}

pub fn key_rows(settings: &Settings) -> Vec<KeyRow> {
    PROVIDERS
        .iter()
        .filter(|p| p.needs_key)
        .map(|p| KeyRow {
            provider: p.id.into(),
            label: p.label.into(),
            key: settings.key_for(p.id).into(),
        })
        .collect()
}

pub fn gpu_label(idx: usize) -> SharedString {
    let value = GPU_LAYER_CYCLE
        .get(idx)
        .and_then(|g| *g)
        .map(|g| g.to_string())
        .unwrap_or_else(|| "default".into());
    format!("GPU layers: {value} (cycle)").into()
}

pub fn ctx_label(idx: usize) -> SharedString {
    let value = CONTEXT_TOKEN_CYCLE
        .get(idx)
        .and_then(|c| *c)
        .map(|c| c.to_string())
        .unwrap_or_else(|| "default".into());
    format!("Context tokens: {value} (cycle)").into()
}

pub fn parse_opt_u32(buf: &str) -> Option<Option<u32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<u32>().ok().map(Some)
    }
}

pub fn parse_opt_f32(buf: &str) -> Option<Option<f32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<f32>().ok().map(Some)
    }
}

pub fn refresh_transcript(
    ui: &AppWindow,
    lines_model: &Rc<VecModel<ChatLine>>,
    lines: &[Line],
) {
    lines_model.set_vec(lines.iter().map(|l| l.to_widget()).collect::<Vec<_>>());
    let _ = ui;
}

pub fn refresh_chats(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let st = state.borrow();
    let rows: Vec<ChatRow> = st
        .chats
        .iter()
        .map(|c| ChatRow {
            id: c.id.clone().into(),
            title: c.title.clone().into(),
            confirming: st.confirm_delete.as_deref() == Some(c.id.as_str()),
        })
        .collect();
    ui.set_chats(ModelRc::from(Rc::new(VecModel::from(rows))));
}

pub fn push_system(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    text: String,
) {
    {
        let mut st = state.borrow_mut();
        st.lines.push(Line {
            role: "system".into(),
            content: text,
            thinking: None,
        });
    }
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    ui.invoke_scroll_to_end();
}

pub fn require_idle(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) -> bool {
    if state.borrow().streaming {
        push_system(
            ui,
            state,
            lines_model,
            "Wait for the response to finish.".into(),
        );
        return false;
    }
    true
}

pub fn persist_current(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    let conv = {
        let mut st = state.borrow_mut();
        if st.lines.is_empty() {
            return;
        }
        let now = conversations::now_ms();
        if st.current_id.is_none() {
            st.current_id = Some(conversations::new_id());
        }
        if st.current_created == 0 {
            st.current_created = now;
        }
        let messages: Vec<StoredMessage> = st
            .lines
            .iter()
            .map(|l| StoredMessage {
                role: l.role.clone(),
                content: l.content.clone(),
                thinking: l.thinking.clone(),
            })
            .collect();
        Some(Conversation {
            id: st.current_id.clone().unwrap_or_default(),
            title: conversations::derive_title(&messages),
            created_at: st.current_created,
            updated_at: now,
            messages,
        })
    };
    if let Some(conv) = conv {
        match host::save_conversation(&conv) {
            Ok(()) => {
                let chats = host::list_conversations();
                state.borrow_mut().chats = chats;
                refresh_chats(ui, state);
            }
            Err(e) => push_system(
                ui,
                state,
                lines_model,
                format!("failed to save conversation: {e}"),
            ),
        }
    }
}

pub fn finalize_thinking(st: &mut State) {
    if let Some(last) = st.lines.last_mut() {
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

pub fn drain_events(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.rx.take() else {
        return;
    };
    let mut finished = false;
    loop {
        match rx.try_recv() {
            Ok(StreamEvent::Chunk(text)) => {
                if let Some(last) = st.lines.last_mut() {
                    last.content.push_str(&text);
                }
            }
            Ok(StreamEvent::Done) => {
                st.streaming = false;
                finished = true;
                break;
            }
            Ok(StreamEvent::Error(e)) => {
                st.streaming = false;
                st.lines.push(Line {
                    role: "system".into(),
                    content: format!("Error: {e}"),
                    thinking: None,
                });
                finished = true;
                break;
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => {
                st.streaming = false;
                break;
            }
        }
    }
    if !finished {
        // Stream still open; put the receiver back.
        st.rx = Some(rx);
    }
    if finished {
        finalize_thinking(&mut st);
    }
    let (lines, streaming) = (st.lines.clone(), st.streaming);
    drop(st);
    refresh_transcript(ui, lines_model, &lines);
    ui.set_streaming(streaming);
    if finished {
        ui.invoke_scroll_to_end();
        persist_current(ui, state, lines_model);
    }
}

pub fn drain_models(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.rx_models.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(ModelsEvent::Loaded { models }) => {
            let n = models.len();
            let provider = st.settings.provider.clone();
            let cache = st
                .settings
                .model_cache
                .entry(provider)
                .or_default();
            for m in models {
                if !cache.contains(&m) {
                    cache.push(m);
                }
            }
            let status = format!("fetched {n} models");
            drop(st);
            ui.set_models_status(status.into());
        }
        Ok(ModelsEvent::Error(e)) => {
            st.rx_models = None;
            drop(st);
            ui.set_models_status(e.into());
        }
        Err(TryRecvError::Empty) => {
            st.rx_models = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

pub fn send(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    text: String,
) {
    let content = text.trim().to_string();
    if content.is_empty() {
        return;
    }
    let mut st = state.borrow_mut();
    if st.streaming {
        return;
    }

    // Build the request from history BEFORE appending the new user
    // message and the assistant placeholder.
    let mut history: Vec<ChatMessage> = st
        .lines
        .iter()
        .filter(|l| l.role != "system")
        .map(|l| ChatMessage {
            role: l.role.clone(),
            content: l.content.clone(),
        })
        .collect();
    history.push(ChatMessage {
        role: "user".into(),
        content: content.clone(),
    });

    st.lines.push(Line {
        role: "user".into(),
        content: content.clone(),
        thinking: None,
    });
    st.lines.push(Line {
        role: "assistant".into(),
        content: String::new(),
        thinking: None,
    });

    let (tx, rx) = mpsc::channel::<StreamEvent>();

    match st.settings.connection {
        Connection::Direct => {
            let def = providers::find(&st.settings.provider);
            let needs_key = def.map(|d| d.needs_key).unwrap_or(false);
            let key = st.settings.key_for(&st.settings.provider);
            if needs_key && key.trim().is_empty() {
                let label = def.map(|d| d.label).unwrap_or("provider").to_string();
                drop(st);
                push_system(
                    ui,
                    state,
                    lines_model,
                    format!("API key required for {label}. Open settings."),
                );
                return;
            }

            // System prompt first, like the extension's adapter does.
            if !st.settings.system_prompt.trim().is_empty() {
                history.insert(
                    0,
                    ChatMessage {
                        role: "system".into(),
                        content: st.settings.system_prompt.trim().to_string(),
                    },
                );
            }
            if st.settings.thinking_enabled {
                history = thinking::apply_thinking_to_messages(&history);
            }

            // Hardware overrides only reach Ollama through its native
            // endpoint; the OpenAI-compat path ignores them.
            let hw = st.settings.hardware.clone();
            if st.settings.provider == "ollama" && hw.has_overrides() {
                let req = OllamaChatRequest {
                    base_url: ollama_root_url(&st.settings.local_base_url),
                    model: effective_model(&st.settings),
                    temperature: st.settings.temperature,
                    messages: history,
                    num_ctx: hw.context_tokens,
                    max_tokens: st.settings.max_tokens,
                    num_gpu: if hw.preferred_compute == "cpu-only" {
                        Some(0)
                    } else {
                        hw.gpu_layers_override
                    },
                };
                st.streaming = true;
                st.rx = Some(rx);
                drop(st);
                host::spawn_ollama_chat(req, tx);
            } else {
                let base_url = def.map(|d| d.base_url.to_string()).unwrap_or_default();
                let req = StreamRequest {
                    base_url,
                    api_key: key.trim().to_string(),
                    model: effective_model(&st.settings),
                    temperature: st.settings.temperature,
                    messages: history,
                    max_tokens: st.settings.max_tokens,
                    top_p: st.settings.top_p,
                    frequency_penalty: st.settings.frequency_penalty,
                    presence_penalty: st.settings.presence_penalty,
                };
                st.streaming = true;
                st.rx = Some(rx);
                drop(st);
                host::spawn_stream(req, tx);
            }
        }
        Connection::PrismApi => {
            if st.settings.prism_api_token.trim().is_empty() {
                drop(st);
                push_system(
                    ui,
                    state,
                    lines_model,
                    "Prism API token required. Open settings.".into(),
                );
                return;
            }
            let req = ApiChatRequest {
                server_url: st.settings.prism_api_url.trim().to_string(),
                token: st.settings.prism_api_token.trim().to_string(),
                content: history
                    .last()
                    .map(|m| m.content.clone())
                    .unwrap_or_default(),
            };
            st.streaming = true;
            st.rx = Some(rx);
            drop(st);
            host::spawn_api_chat(req, tx);
        }
    }

    ui.set_streaming(true);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    ui.invoke_scroll_to_end();
    persist_current(ui, state, lines_model);
}
/// Run the Slint UI: build the window, wire callbacks, start the timer pump,
/// and enter the event loop. Shared by desktop main() and Android android_main.
pub fn run_ui() {
    let ui = AppWindow::new().expect("failed to create AppWindow");

    let lines_model: Rc<VecModel<ChatLine>> = Rc::new(VecModel::from(Vec::new()));
    ui.set_transcript(ModelRc::from(lines_model.clone()));

    let state = Rc::new(RefCell::new(State::new()));

    // ---- initial property sync ----
    {
        let st = state.borrow();
        ui.set_provider_labels(ModelRc::from(Rc::new(VecModel::from(
            PROVIDERS.iter().map(|p| SharedString::from(p.label)).collect::<Vec<_>>(),
        ))));
        ui.set_compute_labels(ModelRc::from(Rc::new(VecModel::from(
            COMPUTE_LEVELS.iter().map(|c| SharedString::from(*c)).collect::<Vec<_>>(),
        ))));
        ui.set_provider(st.settings.provider.as_str().into());
        ui.set_provider_idx(
            PROVIDERS
                .iter()
                .position(|p| p.id == st.settings.provider)
                .unwrap_or(0) as i32,
        );
        ui.set_connection_idx(match st.settings.connection {
            Connection::Direct => 0,
            Connection::PrismApi => 1,
        });
        ui.set_model(st.settings.model.clone().into());
        ui.set_model_hint(model_hint(&st.settings));
        ui.set_prism_url(st.settings.prism_api_url.clone().into());
        ui.set_prism_token(st.settings.prism_api_token.clone().into());
        ui.set_local_url(st.settings.local_base_url.clone().into());
        ui.set_temperature(st.settings.temperature);
        ui.set_max_tokens(
            st.settings
                .max_tokens
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_top_p(
            st.settings
                .top_p
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_freq_penalty(
            st.settings
                .frequency_penalty
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_pres_penalty(
            st.settings
                .presence_penalty
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_system_prompt(st.settings.system_prompt.clone().into());
        ui.set_thinking_enabled(st.settings.thinking_enabled);
        ui.set_compute_idx(
            COMPUTE_LEVELS
                .iter()
                .position(|c| *c == st.settings.hardware.preferred_compute)
                .unwrap_or(0) as i32,
        );
        ui.set_gpu_label(gpu_label(st.gpu_idx));
        ui.set_ctx_label(ctx_label(st.ctx_idx));
        ui.set_api_keys(ModelRc::from(Rc::new(VecModel::from(key_rows(
            &st.settings,
        )))));
        ui.set_cached_models(ModelRc::from(Rc::new(VecModel::from(cached_models(
            &st.settings,
        )))));
        refresh_chats(&ui, &state);
    }

    // ---- callbacks ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_send(move |text| {
            let Some(ui) = ui_w.upgrade() else { return };
            send(&ui, &state_c, &lines_c, text.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_new_chat(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            if !require_idle(&ui, &state_c, &lines_c) {
                return;
            }
            persist_current(&ui, &state_c, &lines_c);
            {
                let mut st = state_c.borrow_mut();
                st.lines.clear();
                st.current_id = None;
                st.current_created = 0;
                st.confirm_delete = None;
                st.chats = host::list_conversations();
            }
            refresh_transcript(&ui, &lines_c, &[]);
            refresh_chats(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_open_chat(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            let id = id.to_string();
            if !require_idle(&ui, &state_c, &lines_c)
                || state_c.borrow().current_id.as_deref() == Some(id.as_str())
            {
                return;
            }
            persist_current(&ui, &state_c, &lines_c);
            match host::load_conversation(&id) {
                Some(c) => {
                    let mut st = state_c.borrow_mut();
                    st.lines = c
                        .messages
                        .iter()
                        .map(|m| Line {
                            role: m.role.clone(),
                            content: m.content.clone(),
                            thinking: m.thinking.clone(),
                        })
                        .collect();
                    st.current_id = Some(c.id);
                    st.current_created = c.created_at;
                    st.confirm_delete = None;
                    let lines = st.lines.clone();
                    drop(st);
                    refresh_transcript(&ui, &lines_c, &lines);
                    ui.invoke_scroll_to_end();
                    refresh_chats(&ui, &state_c);
                }
                None => push_system(&ui, &state_c, &lines_c, "conversation not found".into()),
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_request_delete(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            let id = id.to_string();
            if !require_idle(&ui, &state_c, &lines_c) {
                return;
            }
            let confirming = state_c.borrow().confirm_delete.as_deref() == Some(id.as_str());
            if confirming {
                if let Err(e) = host::delete_conversation(&id) {
                    push_system(
                        &ui,
                        &state_c,
                        &lines_c,
                        format!("failed to delete conversation: {e}"),
                    );
                }
                {
                    let mut st = state_c.borrow_mut();
                    st.confirm_delete = None;
                    if st.current_id.as_deref() == Some(id.as_str()) {
                        st.lines.clear();
                        st.current_id = None;
                        st.current_created = 0;
                    }
                    st.chats = host::list_conversations();
                }
                let lines = state_c.borrow().lines.clone();
                refresh_transcript(&ui, &lines_c, &lines);
                refresh_chats(&ui, &state_c);
            } else {
                state_c.borrow_mut().confirm_delete = Some(id);
                refresh_chats(&ui, &state_c);
            }
        });
    }
    {
        let state_c = state.clone();
        ui.on_set_connection(move |i| {
            let mut st = state_c.borrow_mut();
            st.settings.connection = match i {
                1 => Connection::PrismApi,
                _ => Connection::Direct,
            };
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_set_provider(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            let mut st = state_c.borrow_mut();
            if let Some(p) = PROVIDERS.get(i as usize) {
                st.settings.provider = p.id.to_string();
            }
            let (pid, hint, cm, local) = (
                st.settings.provider.clone(),
                model_hint(&st.settings),
                cached_models(&st.settings),
                st.settings.local_base_url.clone(),
            );
            drop(st);
            ui.set_provider(pid.into());
            ui.set_model_hint(hint);
            ui.set_cached_models(ModelRc::from(Rc::new(VecModel::from(cm))));
            ui.set_local_url(local.into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_model_edited(move |t| {
            let Some(ui) = ui_w.upgrade() else { return };
            let hint = {
                let mut st = state_c.borrow_mut();
                st.settings.model = t.to_string();
                model_hint(&st.settings)
            };
            ui.set_model_hint(hint);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_fetch_models(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let (base_url, api_key, status) = {
                let st = state_c.borrow_mut();
                if st.rx_models.is_some() {
                    return;
                }
                let provider = st.settings.provider.clone();
                let key = st.settings.key_for(&provider);
                let base_url = if provider == "ollama" {
                    st.settings.local_base_url.trim().to_string()
                } else {
                    providers::find(&provider)
                        .map(|p| p.base_url.to_string())
                        .unwrap_or_default()
                };
                let needs_key = providers::find(&provider)
                    .map(|p| p.needs_key)
                    .unwrap_or(false);
                if base_url.is_empty() || (needs_key && key.trim().is_empty()) {
                    (
                        String::new(),
                        String::new(),
                        "set an API key first".to_string(),
                    )
                } else {
                    (base_url, key, "fetching…".to_string())
                }
            };
            if base_url.is_empty() {
                ui.set_models_status(status.into());
                return;
            }
            let (tx, rx) = mpsc::channel();
            state_c.borrow_mut().rx_models = Some(rx);
            ui.set_models_status(status.into());
            host::spawn_models_fetch(
                ModelsRequest {
                    base_url,
                    api_key: api_key.trim().to_string(),
                },
                tx,
            );
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_pick_model(move |name| {
            let Some(ui) = ui_w.upgrade() else { return };
            state_c.borrow_mut().settings.model = name.to_string();
            ui.set_model(name);
            ui.set_model_hint("".into());
        });
    }
    {
        let state_c = state.clone();
        ui.on_key_edited(move |provider, key| {
            state_c
                .borrow_mut()
                .settings
                .provider_keys
                .insert(provider.to_string(), key.to_string());
        });
    }
    {
        let state_c = state.clone();
        ui.on_temperature_edited(move |v| {
            state_c.borrow_mut().settings.temperature = v as f32;
        });
    }
    {
        let state_c = state.clone();
        ui.on_sampling_edited(move |field, value| {
            let mut st = state_c.borrow_mut();
            match field.as_str() {
                "max-tokens" => {
                    if let Some(v) = parse_opt_u32(&value) {
                        st.settings.max_tokens = v;
                    }
                }
                "top-p" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.top_p = v;
                    }
                }
                "freq" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.frequency_penalty = v;
                    }
                }
                "pres" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.presence_penalty = v;
                    }
                }
                _ => {}
            }
        });
    }

    {
        let state_c = state.clone();
        ui.on_system_prompt_edited(move |t| {
            state_c.borrow_mut().settings.system_prompt = t.to_string();
        });
    }
    {
        let state_c = state.clone();
        ui.on_thinking_toggled(move |b| {
            state_c.borrow_mut().settings.thinking_enabled = b;
        });
    }
    {
        let state_c = state.clone();
        ui.on_compute_selected(move |i| {
            if let Some(c) = COMPUTE_LEVELS.get(i as usize) {
                state_c.borrow_mut().settings.hardware.preferred_compute = c.to_string();
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_cycle_gpu(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let label = {
                let mut st = state_c.borrow_mut();
                st.gpu_idx = (st.gpu_idx + 1) % GPU_LAYER_CYCLE.len();
                st.settings.hardware.gpu_layers_override = GPU_LAYER_CYCLE[st.gpu_idx];
                gpu_label(st.gpu_idx)
            };
            ui.set_gpu_label(label);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_cycle_ctx(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let label = {
                let mut st = state_c.borrow_mut();
                st.ctx_idx = (st.ctx_idx + 1) % CONTEXT_TOKEN_CYCLE.len();
                st.settings.hardware.context_tokens = CONTEXT_TOKEN_CYCLE[st.ctx_idx];
                ctx_label(st.ctx_idx)
            };
            ui.set_ctx_label(label);
        });
    }
    {
        let state_c = state.clone();
        ui.on_local_url_edited(move |t| {
            state_c.borrow_mut().settings.local_base_url = t.to_string();
        });
    }
    {
        let state_c = state.clone();
        ui.on_prism_url_edited(move |t| {
            state_c.borrow_mut().settings.prism_api_url = t.to_string();
        });
    }
    {
        let state_c = state.clone();
        ui.on_prism_token_edited(move |t| {
            state_c.borrow_mut().settings.prism_api_token = t.to_string();
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_save_settings(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let status = match host::save_settings(&state_c.borrow().settings) {
                Ok(()) => match host::settings_path() {
                    Some(path) => format!("saved to {}", path.display()),
                    None => "saved".into(),
                },
                Err(e) => format!("save failed: {e}"),
            };
            ui.set_settings_status(status.into());
        });
    }

    // ---- event pump ----
    let timer = slint::Timer::default();
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        timer.start(
            slint::TimerMode::Repeated,
            std::time::Duration::from_millis(50),
            move || {
                let Some(ui) = ui_w.upgrade() else { return };
                drain_events(&ui, &state_c, &lines_c);
                drain_models(&ui, &state_c);
            },
        );
    }

    ui.run().expect("slint event loop failed");
}

