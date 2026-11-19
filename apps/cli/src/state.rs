//! Application state and event application for the Prism CLI.
//!
//! Single-owner design: only the main loop mutates `App`, and only
//! through `handle_*` methods. Chat jobs run in background threads and
//! report back as `Event::Stream`.

use crate::chat;
use crate::events::{Event, McpToolRow};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use prism_core::agent::Tool as _;
use prism_core::client::StreamEvent;
use prism_core::conversations::{self, Conversation, ConversationMeta, StoredMessage};
use prism_core::host;
use prism_core::providers;
use prism_core::settings::Connection;
use prism_core::thinking;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// One visible line-group in the timeline. `thinking` is the extracted
/// reasoning for assistant messages (from `<thinking>` scratchpads).
#[derive(Debug, Clone)]
pub struct Line {
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
}

#[derive(Debug)]
pub struct StreamState {
    pub aborted: bool,
    pub started: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Search,
    /// The in-app MCP monitor/test panel owns the keyboard.
    Mcp,
}

/// The in-app MCP panel: every tool the configured servers advertise,
/// the connection errors, and one directly executable call.
#[derive(Debug, Clone)]
pub struct McpPanel {
    pub path: Option<String>,
    pub tools: Vec<McpToolRow>,
    pub errors: Vec<String>,
    pub selected: usize,
    pub args: String,
    pub editing: bool,
    pub busy: bool,
    pub result: Option<String>,
    pub result_scroll: usize,
}

impl McpPanel {
    fn new() -> Self {
        McpPanel {
            path: None,
            tools: Vec::new(),
            errors: Vec::new(),
            selected: 0,
            args: "{}".into(),
            editing: false,
            busy: true,
            result: None,
            result_scroll: 0,
        }
    }

    pub fn selected_tool(&self) -> Option<&McpToolRow> {
        self.tools.get(self.selected)
    }
}

/// Interaction mode: the six-mode taxonomy (Chat/Agent/Code/Creative/
/// Daemon/Generative). Independent of the key-handling `Mode` above —
/// one is what you're doing, the other is which keymap is active.
pub use prism_core::modes::Mode as IMode;

/// One background subagent run, tracked on the session so `/agents`
/// can report status without a second event loop.
#[derive(Debug, Clone)]
pub struct BackgroundJob {
    pub id: String,
    pub spec: String,
    pub task: String,
    /// "running" | "done" | "failed"
    pub status: String,
    pub answer: Option<String>,
    pub error: Option<String>,
    pub started_at: u64,
}

pub struct App {
    pub settings: prism_core::settings::Settings,
    pub plugins: prism_core::plugins::Registry,
    pub conv: Conversation,
    pub metas: Vec<ConversationMeta>,
    pub selected: usize,

    pub input: Vec<char>,
    pub cursor: usize,
    pub mode: Mode,
    pub imode: IMode,
    /// The layered session: holds the mode blend, per-feature overrides
    /// and the permission policy. The TUI's raw `Settings` stays the
    /// transport-level config; this is the capability contract.
    pub session: prism_core::session::Session,
    pub search: Option<String>,
    pub matches: Vec<usize>,
    pub match_sel: usize,

    pub streaming: Option<StreamState>,
    pub queue: VecDeque<String>,
    pub queue_paused: bool,
    pub agent_running: bool,
    pub last_agent_task: String,
    /// Background subagent runs (see `BackgroundJob`).
    pub jobs: Vec<BackgroundJob>,
    pub spinner: usize,

    /// Lines counted from the bottom that are hidden (0 = follow).
    pub scroll: usize,
    /// (message index, first rendered line) per message, filled by the UI.
    pub line_index: Vec<(usize, usize)>,
    pub total_lines: usize,
    pub viewport: usize,

    pub history: VecDeque<String>,
    pub history_pos: Option<usize>,
    pub status: String,
    pub quit: bool,

    /// Active character card and the user's persona (creative mode).
    pub card: Option<prism_core::cards::CharacterCard>,
    pub persona: prism_core::cards::Persona,
    /// Open MCP monitor/test panel.
    pub mcp_panel: Option<McpPanel>,
    /// Session-scoped retrieval over local files (`/rag`).
    pub rag: prism_core::rag::RagStore,
}

impl App {
    pub fn new(settings: prism_core::settings::Settings) -> Self {
        let mut app = App {
            settings,
            plugins: prism_core::plugins::Registry::with_defaults(),
            conv: Conversation {
                id: conversations::new_id(),
                title: String::new(),
                created_at: conversations::now_ms(),
                updated_at: conversations::now_ms(),
                messages: Vec::new(),
                tags: Vec::new(),
                archived: false,
                read: true,
                forked_from: None,
                forked_at_message: None,
            },
            metas: host::list_conversations(),
            selected: 0,
            input: Vec::new(),
            cursor: 0,
            mode: Mode::Normal,
            imode: IMode::Chat,
            session: prism_core::session::Session::new(
                IMode::Chat,
                &crate::chat::agent_job::available_tool_names(),
            ),
            search: None,
            matches: Vec::new(),
            match_sel: 0,
            streaming: None,
            queue: VecDeque::new(),
            queue_paused: false,
            agent_running: false,
            last_agent_task: String::new(),
            jobs: Vec::new(),
            spinner: 0,
            scroll: 0,
            line_index: Vec::new(),
            total_lines: 0,
            viewport: 0,
            history: VecDeque::new(),
            history_pos: None,
            status: "ready".into(),
            quit: false,
            card: None,
            persona: prism_core::cards::Persona {
                name: "User".into(),
                description: String::new(),
            },
            mcp_panel: None,
            rag: prism_core::rag::RagStore::new(),
        };
        // Resume the requested conversation (`prism resume [id]` sets
        // the env var), else the most recent one so a restart keeps
        // working.
        let wanted = std::env::var("PRISM_RESUME_ID")
            .ok()
            .filter(|s| !s.is_empty());
        let resume = wanted
            .as_deref()
            .and_then(|id| {
                app.metas
                    .iter()
                    .find(|m| m.id == id || m.id.starts_with(id))
                    .map(|m| m.id.clone())
            })
            .or_else(|| app.metas.first().map(|m| m.id.clone()));
        if let Some(id) = resume {
            if let Some(conv) = host::load_conversation(&id) {
                app.conv = conv;
                app.selected = app.metas.iter().position(|m| m.id == id).unwrap_or(0);
            }
        }
        let total = providers::PROVIDERS.len() + app.settings.custom_providers.len();
        let _pos = (0..total)
            .find(|&i| app.provider_id_at(i).as_deref() == Some(app.settings.provider.as_str()))
            .unwrap_or(0);
        app.status = format!(
            "ready · {} · {}",
            app.settings.provider,
            app.effective_model()
        );
        app
    }

    /// Dropdown labels: built-ins then custom ("Label (custom)").
    pub fn provider_labels(&self) -> Vec<String> {
        let mut v: Vec<String> = providers::PROVIDERS
            .iter()
            .map(|p| p.label.to_string())
            .collect();
        for (id, cp) in &self.settings.custom_providers {
            let label = if cp.label.is_empty() {
                match prism_core::providers::find(&cp.canonical) {
                    Some(def) => format!("{} (custom)", def.label),
                    None => id.clone(),
                }
            } else {
                cp.label.clone()
            };
            v.push(label);
        }
        v
    }

    /// Provider id at a dropdown index (mirrors `provider_labels`).
    pub fn provider_id_at(&self, idx: usize) -> Option<String> {
        if idx < providers::PROVIDERS.len() {
            return Some(providers::PROVIDERS[idx].id.to_string());
        }
        self.settings
            .custom_providers
            .keys()
            .nth(idx - providers::PROVIDERS.len())
            .cloned()
    }

    pub fn effective_model(&self) -> String {
        if !self.settings.model.trim().is_empty() {
            return self.settings.model.trim().to_string();
        }
        match self.settings.resolve_provider(&self.settings.provider) {
            Some(r) => {
                if !r.default_model.is_empty() {
                    return r.default_model;
                }
                prism_core::catalog::snapshot()
                    .providers
                    .get(&self.settings.provider)
                    .and_then(|p| p.default_model())
                    .unwrap_or("")
                    .to_string()
            }
            None => providers::find(&self.settings.provider)
                .map(|p| p.default_model.to_string())
                .unwrap_or_default(),
        }
    }

    /// Conversation history for the model, excluding system lines.
    fn history(&self) -> Vec<prism_core::client::ChatMessage> {
        self.conv
            .messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| prism_core::client::ChatMessage::text(&m.role, &m.content))
            .collect()
    }

    /// Append and persist a transcript message (also used for system notes).
    pub fn push_message(&mut self, role: &str, content: &str) {
        self.conv.messages.push(StoredMessage {
            role: role.into(),
            content: content.into(),
            thinking: None,
            id: None,
            tags: Vec::new(),
            read: true,
            edited_at: None,
        });
        self.invalidate_search();
        self.save();
    }

    /// Persist the conversation through the core's storage.
    pub fn save(&mut self) {
        if self.conv.title.is_empty() {
            self.conv.title = conversations::derive_title(&self.conv.messages);
        }
        self.conv.updated_at = conversations::now_ms();
        match host::save_conversation(&self.conv) {
            Ok(()) => self.refresh_meta(),
            Err(e) => self.status = format!("save failed: {e}"),
        }
    }

    fn refresh_meta(&mut self) {
        let meta = ConversationMeta {
            id: self.conv.id.clone(),
            title: self.conv.title.clone(),
            updated_at: self.conv.updated_at,
            tags: self.conv.tags.clone(),
            archived: self.conv.archived,
            read: self.conv.read,
        };
        if let Some(pos) = self.metas.iter().position(|m| m.id == meta.id) {
            self.metas[pos] = meta;
        } else {
            self.metas.insert(0, meta);
            self.selected = 0;
        }
        self.metas.sort_by_key(|m| std::cmp::Reverse(m.updated_at));
        self.selected = self
            .metas
            .iter()
            .position(|m| m.id == self.conv.id)
            .unwrap_or(0);
    }

    // -- event application ------------------------------------------------

    pub fn handle(&mut self, ev: Event, tx: &std::sync::mpsc::Sender<Event>) {
        match ev {
            Event::Key(key) => self.handle_key(key, tx),
            Event::Mouse(mouse) => self.handle_mouse(mouse),
            Event::Stream(ev) => self.handle_stream(ev, tx),
            Event::AgentDone(result) => self.handle_agent_done(result),
            Event::Notice(text) => self.push_message("system", &text),
            Event::SubagentDone { id, spec, result } => {
                self.handle_subagent_done(&id, &spec, result)
            }
            Event::McpTools {
                path,
                tools,
                errors,
            } => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    panel.path = path;
                    panel.busy = false;
                    panel.selected = panel.selected.min(tools.len().saturating_sub(1));
                    panel.tools = tools;
                    panel.errors = errors;
                    let n = panel.tools.len();
                    let failed = panel.errors.len();
                    self.status = if failed == 0 {
                        format!("mcp: {n} tool(s) ready — ↑/↓ select, Enter to call")
                    } else {
                        format!("mcp: {n} tool(s), {failed} server(s) failed — r to retry")
                    };
                }
            }
            Event::McpCall { tool, output } => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    panel.busy = false;
                    panel.result = Some(output);
                    panel.result_scroll = 0;
                    self.status = format!("mcp: called {tool}");
                }
            }
            Event::Resize(_, _) => {}
            Event::Tick(t) => self.handle_tick(t),
        }
    }

    pub fn handle_tick(&mut self, _tick: u64) {
        if self.streaming.is_some() {
            self.spinner = (self.spinner + 1) % 10;
        }
    }

    pub fn handle_mouse(&mut self, mouse: MouseEvent) {
        match mouse.kind {
            MouseEventKind::ScrollUp => self.scroll_page(3),
            MouseEventKind::ScrollDown => self.scroll_page(-3),
            MouseEventKind::Down(MouseButton::Left) => {
                self.status = format!("mouse click at {},{}", mouse.column, mouse.row);
            }
            _ => {}
        }
    }

    fn handle_agent_done(&mut self, result: prism_core::agent::AgentResult) {
        self.agent_running = false;
        for (i, step) in result.steps.iter().enumerate() {
            self.push_message(
                "system",
                &format!(
                    "[{}/{}] {}: {} -> {}",
                    i + 1,
                    result.steps.len(),
                    step.action,
                    step.action_input,
                    if step.observation.len() > 120 {
                        format!("{}…", &step.observation[..120])
                    } else {
                        step.observation.clone()
                    }
                ),
            );
        }
        if result.completed {
            self.push_message("assistant", &result.answer);
            self.conv.messages.push(StoredMessage {
                role: "user".into(),
                content: self.last_agent_task.clone(),
                thinking: None,
                id: None,
                tags: Vec::new(),
                read: true,
                edited_at: None,
            });
            self.conv.messages.push(StoredMessage {
                role: "assistant".into(),
                content: result.answer.clone(),
                thinking: None,
                id: None,
                tags: Vec::new(),
                read: true,
                edited_at: None,
            });
            self.save();
            self.status = "agent finished".into();
        } else {
            self.push_message("system", result.error.as_deref().unwrap_or("agent stopped"));
            self.status = "agent failed".into();
        }
    }

    fn handle_subagent_done(
        &mut self,
        id: &str,
        spec: &str,
        result: prism_core::agent::AgentResult,
    ) {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == id) {
            if result.completed {
                job.status = "done".into();
                job.answer = Some(result.answer.clone());
            } else {
                job.status = "failed".into();
                job.error = result
                    .error
                    .clone()
                    .or_else(|| Some("stopped without a final answer".into()));
            }
        }
        for (i, step) in result.steps.iter().enumerate() {
            self.push_message(
                "system",
                &format!(
                    "[bg {spec} {}/{}] {}: {} -> {}",
                    i + 1,
                    result.steps.len(),
                    step.action,
                    step.action_input,
                    if step.observation.len() > 120 {
                        format!("{}…", &step.observation[..120])
                    } else {
                        step.observation.clone()
                    }
                ),
            );
        }
        if result.completed {
            self.push_message("assistant", &result.answer);
            self.conv.messages.push(StoredMessage {
                role: "user".into(),
                content: format!("[{spec}] {}", self.job_task(id).unwrap_or_default()),
                thinking: None,
                id: None,
                tags: vec!["subagent".into()],
                read: true,
                edited_at: None,
            });
            self.conv.messages.push(StoredMessage {
                role: "assistant".into(),
                content: result.answer.clone(),
                thinking: None,
                id: None,
                tags: vec!["subagent".into()],
                read: true,
                edited_at: None,
            });
            self.save();
            self.status = format!("subagent {spec} finished");
        } else {
            let reason = result.error.as_deref().unwrap_or("agent stopped");
            self.push_message("system", &format!("bg {spec} failed ({id}): {reason}"));
            self.status = format!("subagent {spec} failed");
        }
    }

    fn job_task(&self, id: &str) -> Option<String> {
        self.jobs
            .iter()
            .find(|j| j.id == id)
            .map(|j| j.task.clone())
    }

    pub fn handle_stream(&mut self, ev: StreamEvent, tx: &std::sync::mpsc::Sender<Event>) {
        // Take ownership so the slot can be cleared/replaced below.
        let Some(state) = self.streaming.take() else {
            return;
        };
        match ev {
            StreamEvent::Chunk(text) => {
                if !state.aborted {
                    if let Some(last) = self.conv.messages.last_mut() {
                        if last.role == "assistant" {
                            last.content.push_str(&text);
                        }
                    }
                    self.invalidate_search();
                }
                self.streaming = Some(state);
            }
            StreamEvent::Done => {
                let aborted = state.aborted;
                if let Some(last) = self.conv.messages.last_mut() {
                    if last.role == "assistant" {
                        let (clean, reasoning) = thinking::strip_thinking(&last.content);
                        // Plugin pipeline: table alignment etc. (pure text).
                        let content = self.plugins.format_output(
                            &*host::storage(),
                            host::config_dir().as_deref(),
                            &clean,
                        );
                        last.content = content;
                        last.thinking = reasoning;
                    }
                }
                if aborted {
                    if let Some(last) = self.conv.messages.last_mut() {
                        if last.role == "assistant" && last.content.trim().is_empty() {
                            self.conv.messages.pop();
                        }
                    }
                    self.push_message("system", "generation stopped");
                }
                self.save();
                self.status = format!(
                    "done in {:.1}s · {}",
                    state.started.elapsed().as_secs_f32(),
                    self.estimate_tokens(),
                );
                if !self.queue_paused {
                    self.drain_queue(tx);
                }
            }
            StreamEvent::Error(e) => {
                self.queue_paused = true;
                self.push_message("system", &format!("error: {e}"));
                self.status = "stream error — queue paused (send to resume)".into();
            }
            StreamEvent::Retrying {
                attempt,
                max,
                delay_ms,
                reason,
            } => {
                self.push_message(
                    "system",
                    &format!(
                        "provider retry {attempt}/{max} in {:.1}s ({reason})",
                        delay_ms as f32 / 1000.0
                    ),
                );
                self.status = format!("retrying ({attempt}/{max})…");
            }
        }
    }

    fn drain_queue(&mut self, tx: &std::sync::mpsc::Sender<Event>) {
        if self.streaming.is_none() {
            if let Some(next) = self.queue.pop_front() {
                self.send_message(&next, tx);
            }
        }
    }

    // -- sending ----------------------------------------------------------

    /// Send user text: stream now, or queue while a generation is running.
    pub fn send_message(&mut self, content: &str, tx: &std::sync::mpsc::Sender<Event>) {
        let content = content.trim().to_string();
        if content.is_empty() {
            return;
        }
        if self.streaming.is_some() {
            self.queue.push_back(content);
            self.status = format!("queued ({} pending)", self.queue.len());
            return;
        }
        self.queue_paused = false;
        let history = self.history();
        // Plugin pipeline: snippet expansion, tone suffix, counters.
        let content = self.plugins.before_send(
            &*host::storage(),
            host::config_dir().as_deref(),
            &content,
            &self.settings,
        );

        // Retrieval first: the best chunks become a system block both
        // the card path and the plain path carry into the request.
        let rag_context = if self.rag.is_empty() {
            String::new()
        } else {
            self.rag.context(&content, 4)
        };

        // With a character card active the prompt is the card's system
        // blocks + triggered lore + the transcript + this turn, exactly
        // as `prism_core::cards` builds it for the desktop app.
        let (messages, prebuilt) = match &self.card {
            Some(card) => {
                let lore = card
                    .character_book
                    .as_ref()
                    .map(|book| {
                        let recent: Vec<String> = history
                            .iter()
                            .rev()
                            .take(10)
                            .map(|m| m.content.clone())
                            .collect();
                        prism_core::cards::scan_lore(book, &content, &recent)
                    })
                    .unwrap_or_default();
                let mut messages = prism_core::cards::build_messages(
                    card,
                    &self.persona,
                    &history,
                    &lore,
                    &content,
                    None,
                );
                if !rag_context.is_empty() {
                    messages.insert(
                        0,
                        prism_core::client::ChatMessage::text("system", &rag_context),
                    );
                }
                (messages, true)
            }
            None => {
                let mut history = history;
                if !rag_context.is_empty() {
                    history.insert(
                        0,
                        prism_core::client::ChatMessage::text("system", &rag_context),
                    );
                }
                history.push(prism_core::client::ChatMessage::text("user", &content));
                (history, false)
            }
        };

        let started = if prebuilt {
            chat::start_job_prebuilt(&self.settings, messages, tx)
        } else {
            chat::start_job(&self.settings, messages, tx)
        };
        match started {
            Ok(()) => {
                self.push_message("user", &content);
                self.conv.messages.push(StoredMessage {
                    role: "assistant".into(),
                    content: String::new(),
                    thinking: None,
                    id: None,
                    tags: Vec::new(),
                    read: true,
                    edited_at: None,
                });
                self.streaming = Some(StreamState {
                    aborted: false,
                    started: Instant::now(),
                });
                self.scroll = 0;
                self.status = format!(
                    "streaming · {} · {}",
                    self.settings.provider,
                    self.effective_model()
                );
                self.save();
            }
            Err(e) => {
                self.push_message("system", &e);
            }
        }
    }

    pub fn abort_stream(&mut self) {
        if let Some(state) = self.streaming.as_mut() {
            state.aborted = true;
            self.status = "stopping…".into();
        }
    }

    // -- commands ----------------------------------------------------------

    fn run_command(&mut self, raw: &str, tx: &std::sync::mpsc::Sender<Event>) {
        let line = raw.trim_start_matches('/');
        let mut parts = line.splitn(2, char::is_whitespace);
        let cmd = parts.next().unwrap_or("");
        let arg = parts.next().unwrap_or("").trim().to_string();
        match cmd {
            "help" => {
                for l in crate::ui::HELP_LINES {
                    self.push_message("system", l);
                }
            }
            "new" => {
                self.save();
                self.conv = Conversation {
                    id: conversations::new_id(),
                    title: String::new(),
                    created_at: conversations::now_ms(),
                    updated_at: conversations::now_ms(),
                    messages: Vec::new(),
                    tags: Vec::new(),
                    archived: false,
                    read: true,
                    forked_from: None,
                    forked_at_message: None,
                };
                self.search = None;
                self.matches.clear();
                self.scroll = 0;
                self.save();
                self.status = "new conversation".into();
            }
            "load" => {
                let target = if arg.is_empty() {
                    Some(self.selected)
                } else {
                    arg.parse::<usize>().ok().map(|n| n.saturating_sub(1))
                };
                match target.and_then(|i| self.metas.get(i).map(|m| m.id.clone())) {
                    Some(id) => self.open_conversation(&id),
                    None => self.push_message("system", "usage: /load <list number>"),
                }
            }
            "del" => {
                let target = if arg.is_empty() {
                    Some(self.selected)
                } else {
                    arg.parse::<usize>().ok().map(|n| n.saturating_sub(1))
                };
                match target.and_then(|i| self.metas.get(i).cloned()) {
                    Some(meta) => {
                        let was_current = meta.id == self.conv.id;
                        match host::delete_conversation(&meta.id) {
                            Ok(()) => {
                                self.metas.retain(|m| m.id != meta.id);
                                if was_current {
                                    self.conv = Conversation {
                                        id: conversations::new_id(),
                                        title: String::new(),
                                        created_at: conversations::now_ms(),
                                        updated_at: conversations::now_ms(),
                                        messages: Vec::new(),
                                        tags: Vec::new(),
                                        archived: false,
                                        read: true,
                                        forked_from: None,
                                        forked_at_message: None,
                                    };
                                    self.save();
                                }
                                self.selected =
                                    self.selected.min(self.metas.len().saturating_sub(1));
                                self.status = format!("deleted: {}", meta.title);
                            }
                            Err(e) => self.status = format!("delete failed: {e}"),
                        }
                    }
                    None => self.push_message("system", "nothing selected"),
                }
            }
            "model" => {
                if arg.is_empty() {
                    self.push_message(
                        "system",
                        &format!("model: {} (usage: /model <id>)", self.effective_model()),
                    );
                } else {
                    self.settings.model = arg.clone();
                    self.persist_settings();
                    self.status = format!("model: {}", arg);
                }
            }
            "provider" => {
                if providers::find(&arg).is_some() {
                    self.settings.provider = arg.clone();
                    self.persist_settings();
                    self.status = format!("provider: {} ({})", arg, self.effective_model());
                } else {
                    let ids: Vec<&str> = providers::PROVIDERS.iter().map(|p| p.id).collect();
                    self.push_message(
                        "system",
                        &format!("unknown provider; options: {}", ids.join(", ")),
                    );
                }
            }
            "key" => {
                if arg.is_empty() {
                    self.push_message("system", "usage: /key <api-key> (stored in settings.json)");
                } else {
                    self.settings
                        .provider_keys
                        .insert(self.settings.provider.clone(), arg);
                    self.persist_settings();
                    self.status = format!("key set for {}", self.settings.provider);
                }
            }
            "mode" => {
                if arg.is_empty() {
                    let ids: Vec<&str> = prism_core::modes::Mode::all()
                        .iter()
                        .map(|m| m.id())
                        .collect();
                    self.push_message(
                        "system",
                        &format!(
                            "mode: {} (options: {}, Alt+M cycles)",
                            self.imode.id(),
                            ids.join(", ")
                        ),
                    );
                } else {
                    let m = prism_core::modes::Mode::from_id(&arg);
                    if m.id() != arg.trim().to_lowercase() {
                        let ids: Vec<&str> = prism_core::modes::Mode::all()
                            .iter()
                            .map(|m| m.id())
                            .collect();
                        self.push_message(
                            "system",
                            &format!("unknown mode; options: {}", ids.join(", ")),
                        );
                    } else {
                        self.set_imode(m);
                    }
                }
            }
            "mix" => {
                // Blend another mode into the session: its capabilities
                // are unioned in, its prompt voice is not.
                if arg.is_empty() {
                    let ids: Vec<&str> = prism_core::modes::Mode::all()
                        .iter()
                        .map(|m| m.id())
                        .collect();
                    self.push_message(
                        "system",
                        &format!("mix: {} (options: {})", self.mix_summary(), ids.join(", ")),
                    );
                } else {
                    let m = prism_core::modes::Mode::from_id(&arg);
                    if m.id() != arg.trim().to_lowercase() {
                        self.push_message(
                            "system",
                            &format!(
                                "unknown mode; options: {}",
                                prism_core::modes::Mode::all()
                                    .iter()
                                    .map(|m| m.id())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ),
                        );
                    } else if m == self.imode {
                        self.push_message(
                            "system",
                            &format!("{} is already the primary mode", m.label()),
                        );
                    } else {
                        self.session.add_mode(m);
                        // Blending in a tool-bearing mode grants the
                        // tool surface the primary mode lacked.
                        if self.session.feature(prism_core::modes::Feature::Tools)
                            && self.session.capability.tools.is_empty()
                        {
                            self.session.capability.tools =
                                crate::chat::agent_job::available_tool_names();
                        }
                        self.apply_session();
                        self.status = format!("mix: {}", self.mix_summary());
                    }
                }
            }
            "unmix" => {
                if arg.is_empty() {
                    self.push_message(
                        "system",
                        &format!("mix: {} (usage: /unmix <mode>)", self.mix_summary()),
                    );
                } else {
                    let m = prism_core::modes::Mode::from_id(&arg);
                    if m.id() != arg.trim().to_lowercase() {
                        self.push_message(
                            "system",
                            &format!(
                                "unknown mode; options: {}",
                                prism_core::modes::Mode::all()
                                    .iter()
                                    .map(|m| m.id())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ),
                        );
                    } else if !self.session.remove_mode(m) {
                        self.push_message("system", &format!("{} is not mixed in", m.label()));
                    } else {
                        self.apply_session();
                        self.status = format!("mix: {}", self.mix_summary());
                    }
                }
            }
            "cap" => {
                // Toggle one capability on the session.
                if arg.is_empty() {
                    let rows: Vec<String> = prism_core::modes::Feature::all()
                        .iter()
                        .map(|f| {
                            format!(
                                "{} {}",
                                if self.session.feature(*f) { "+" } else { "-" },
                                f.id()
                            )
                        })
                        .collect();
                    self.push_message(
                        "system",
                        &format!(
                            "capabilities: {} (usage: /cap <feature> [on|off])",
                            rows.join("  ")
                        ),
                    );
                } else {
                    let mut parts = arg.splitn(2, char::is_whitespace);
                    let id = parts.next().unwrap_or("");
                    let value = parts.next().unwrap_or("").trim();
                    let Some(feature) = prism_core::modes::Feature::from_id(id) else {
                        self.push_message(
                            "system",
                            &format!(
                                "unknown capability '{}'; options: {}",
                                id,
                                prism_core::modes::Feature::all()
                                    .iter()
                                    .map(|f| f.id())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ),
                        );
                        return;
                    };
                    let enabled = match value.to_lowercase().as_str() {
                        "" | "on" | "enable" => true,
                        "off" | "disable" => false,
                        _ => {
                            self.push_message("system", "usage: /cap <feature> [on|off]");
                            return;
                        }
                    };
                    self.session.set_feature(feature, enabled);
                    self.apply_session();
                    self.status = format!(
                        "{} {}",
                        if enabled { "enabled" } else { "disabled" },
                        feature.id()
                    );
                }
            }
            "perm" => {
                // Edit the permission policy for one tool.
                if arg.is_empty() {
                    let rows: Vec<String> = self
                        .session
                        .capability
                        .permission_rows()
                        .iter()
                        .map(|(t, p)| format!("{}={}", t, p.label()))
                        .collect();
                    self.push_message(
                        "system",
                        &format!(
                            "permissions: {} (usage: /perm <tool> allow|ask|deny)",
                            if rows.is_empty() {
                                "no tools".into()
                            } else {
                                rows.join("  ")
                            }
                        ),
                    );
                } else {
                    let mut parts = arg.splitn(2, char::is_whitespace);
                    let tool = parts.next().unwrap_or("").trim();
                    let level = parts.next().unwrap_or("").trim();
                    let Some(permission) = prism_core::session::PermissionLevel::from_label(level)
                    else {
                        self.push_message("system", "usage: /perm <tool> allow|ask|deny");
                        return;
                    };
                    if !self.session.capability.set_permission(tool, permission) {
                        self.push_message("system", &format!("no such tool: {}", tool));
                    } else {
                        self.status = format!("{} = {}", tool, permission.label());
                    }
                }
            }
            "system" => {
                self.settings.system_prompt = arg.clone();
                self.persist_settings();
                self.status = if arg.is_empty() {
                    "system prompt cleared".into()
                } else {
                    "system prompt updated".into()
                };
            }
            "think" => {
                self.settings.thinking_enabled = !self.settings.thinking_enabled;
                self.persist_settings();
                self.status = format!("thinking: {}", self.settings.thinking_enabled);
            }
            "temp" => match arg.parse::<f32>() {
                Ok(t) if (0.0..=2.0).contains(&t) => {
                    self.settings.temperature = t;
                    self.persist_settings();
                    self.status = format!("temperature: {t}");
                }
                _ => self.push_message("system", "usage: /temp <0.0-2.0>"),
            },
            "conn" => match arg.as_str() {
                "direct" => {
                    self.settings.connection = Connection::Direct;
                    self.persist_settings();
                    self.status = "connection: direct".into();
                }
                "api" => {
                    self.settings.connection = Connection::PrismApi;
                    self.persist_settings();
                    self.status = "connection: prism api".into();
                }
                _ => self.push_message("system", "usage: /conn direct|api"),
            },
            "local" => {
                if arg.is_empty() {
                    self.push_message(
                        "system",
                        &format!(
                            "local base url: {} (usage: /local <url>|off)",
                            if self.settings.local_base_url.is_empty() {
                                "provider default"
                            } else {
                                &self.settings.local_base_url
                            }
                        ),
                    );
                } else if matches!(arg.as_str(), "off" | "default") {
                    self.settings.local_base_url.clear();
                    self.persist_settings();
                    self.status = "local base url: provider default".into();
                } else {
                    self.settings.local_base_url = arg.clone();
                    self.persist_settings();
                    self.status = format!("local base url: {arg}");
                }
            }
            "search" => {
                self.mode = Mode::Search;
                self.input = arg.chars().collect();
                self.cursor = self.input.len();
            }
            "agent" => {
                if arg.is_empty() {
                    self.push_message(
                        "system",
                        "usage: /agent <task> — run the core agent loop (calculator + file tools; writes are denied headless). Set PRISM_AGENT_SANDBOX_POLICY (JSON or policy file) to add the sandboxed shell tool",
                    );
                } else if !self.session.feature(prism_core::modes::Feature::Tools) {
                    // Tool-less modes cannot run the loop at all. This is
                    // the "no mode leakage" guarantee made real — and it
                    // reads the *session* traits, so a mix that grants
                    // tools (or a /cap that revokes them) is honoured.
                    self.push_message(
                        "system",
                        &format!(
                            "{} mode has no tools — /agent needs agent, daemon, or /mode agent",
                            self.imode.label()
                        ),
                    );
                } else if self.agent_running {
                    self.push_message("system", "agent already running");
                } else if self.streaming.is_some() {
                    self.push_message("system", "wait for the chat stream to finish");
                } else {
                    let root = host::config_dir()
                        .and_then(|d| d.parent().map(|p| p.to_path_buf()))
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    self.last_agent_task = arg.clone();
                    self.agent_running = true;
                    self.status = "agent running…".into();
                    if let Err(e) = crate::chat::agent_job::spawn(&self.settings, &arg, root, tx) {
                        self.agent_running = false;
                        self.push_message("system", &e);
                    }
                }
            }
            "quit" | "q" => self.quit = true,
            "mcp" => {
                if arg == "panel" || arg == "ui" || arg == "test" {
                    self.open_mcp_panel(tx);
                    return;
                }
                // Probe the configured MCP servers: connect, list, stop.
                // Agent runs connect their own sessions, so this is a
                // diagnostic — it never touches a live run.
                let tx = tx.clone();
                self.push_message("system", "mcp: probing configured servers…");
                std::thread::spawn(move || {
                    let path = prism_core::mcp::config_path()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "<no config root>".into());
                    let Some(file) = prism_core::mcp::load_file() else {
                        let _ = tx.send(Event::Notice(format!(
                            "mcp: no configuration at {path} — add an \"mcpServers\" object"
                        )));
                        return;
                    };
                    if file.mcp_servers.is_empty() {
                        let _ = tx.send(Event::Notice(format!(
                            "mcp: {path} has no usable servers (command required)"
                        )));
                        return;
                    }
                    let surface =
                        prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
                    let mut lines = vec![format!(
                        "mcp: {} tool(s) from {} configured server(s) — {path}",
                        surface.tools.len(),
                        file.mcp_servers.len()
                    )];
                    for server in file.mcp_servers.keys() {
                        let tools: Vec<&str> = surface
                            .tools
                            .iter()
                            .filter(|t| t.server_name() == server)
                            .map(|t| t.advertised.as_str())
                            .collect();
                        lines.push(if tools.is_empty() {
                            format!("  {server}: connected, no tools")
                        } else {
                            format!("  {server}: {}", tools.join(", "))
                        });
                    }
                    for e in &surface.errors {
                        lines.push(format!("  failed: {e}"));
                    }
                    for line in lines {
                        let _ = tx.send(Event::Notice(line));
                    }
                });
            }
            "agents" => {
                // Background subagents on the core's registry (shipped
                // profiles + `subagents` entries in the MCP config file).
                let (registry, warnings) = crate::chat::agent_job::config_registry();
                if arg.is_empty() || arg == "list" || arg == "help" {
                    let mut lines =
                        vec!["agents — background subagents (core registry):".to_string()];
                    for name in registry.names() {
                        let Some(spec) = registry.get(&name) else {
                            continue;
                        };
                        let model = spec
                            .forced_model
                            .as_ref()
                            .map(|m| format!(" · model {m}"))
                            .unwrap_or_default();
                        let tools = if spec.tool_allowlist.is_empty() {
                            "full surface".to_string()
                        } else {
                            spec.tool_allowlist.join(", ")
                        };
                        lines.push(format!("  {name}: {}", spec.description));
                        lines.push(format!("    tools: {tools}{model}"));
                    }
                    for w in &warnings {
                        lines.push(format!("  config warning: {w}"));
                    }
                    let running: Vec<&BackgroundJob> = self
                        .jobs
                        .iter()
                        .filter(|j| j.status == "running" || j.status == "queued")
                        .collect();
                    for job in running {
                        lines.push(format!(
                            "  running: {} ({}) — {}",
                            job.spec, job.id, job.task
                        ));
                    }
                    lines.push("spawn one: /agents spawn <name> <task>".into());
                    for l in lines {
                        self.push_message("system", &l);
                    }
                } else if let Some(rest) = arg.strip_prefix("spawn ") {
                    if !self.session.feature(prism_core::modes::Feature::Tools) {
                        self.push_message(
                            "system",
                            &format!(
                                "{} mode has no tools — /agents needs agent, daemon, or /mode agent",
                                self.imode.label()
                            ),
                        );
                        return;
                    }
                    let rest = rest.trim();
                    let name = rest.split_whitespace().next().unwrap_or("").to_string();
                    let task = rest[name.len()..].trim().to_string();
                    if name.is_empty() || task.is_empty() {
                        self.push_message("system", "usage: /agents spawn <name> <task>");
                        return;
                    }
                    if registry.get(&name).is_none() {
                        self.push_message(
                            "system",
                            &format!(
                                "unknown subagent {name:?} — known: {}",
                                registry.names().join(", ")
                            ),
                        );
                        return;
                    }
                    let id = format!("bg_{}", prism_core::conversations::now_ms());
                    self.jobs.push(BackgroundJob {
                        id: id.clone(),
                        spec: name.clone(),
                        task: task.clone(),
                        status: "queued".into(),
                        answer: None,
                        error: None,
                        started_at: prism_core::conversations::now_ms(),
                    });
                    self.push_message("system", &format!("bg {name} queued ({id}) — {task}"));
                    for w in &warnings {
                        self.push_message("system", &format!("agents config warning: {w}"));
                    }
                    let root = host::config_dir()
                        .and_then(|d| d.parent().map(|p| p.to_path_buf()))
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    match crate::chat::agent_job::spawn_subagent(
                        &self.settings,
                        &id,
                        &name,
                        &task,
                        root,
                        tx,
                    ) {
                        Ok(()) => {
                            if let Some(job) = self.jobs.iter_mut().find(|j| j.id == id) {
                                job.status = "running".into();
                            }
                            self.push_message("system", &format!("bg {name} running ({id})"));
                            self.status = format!("subagent {name} running…");
                        }
                        Err(e) => {
                            if let Some(job) = self.jobs.iter_mut().find(|j| j.id == id) {
                                job.status = "failed".into();
                                job.error = Some(e.clone());
                            }
                            self.push_message("system", &format!("bg {name} failed ({id}): {e}"));
                        }
                    }
                } else {
                    self.push_message(
                        "system",
                        "usage: /agents [list] | /agents spawn <name> <task>",
                    );
                }
            }
            "vault" => {
                // The shared conversation store (same files the desktop
                // and `prism sessions` read).
                let mut it = arg.split_whitespace();
                let sub = it.next().unwrap_or("list");
                match sub {
                    "list" => {
                        if self.metas.is_empty() {
                            self.push_message("system", "vault: empty");
                        } else {
                            let rows: Vec<String> = self
                                .metas
                                .iter()
                                .take(10)
                                .map(|m| {
                                    format!(
                                        "  {}  {}  {}",
                                        &m.id[..m.id.len().min(8)],
                                        m.updated_at,
                                        m.title
                                    )
                                })
                                .collect();
                            for line in rows {
                                self.push_message("system", &line);
                            }
                        }
                    }
                    "save" => {
                        self.save();
                        self.push_message(
                            "system",
                            &format!("vault: saved {} — {}", self.conv.id, self.conv.title),
                        );
                    }
                    "open" => match it.next() {
                        Some(id) => {
                            let full = self
                                .metas
                                .iter()
                                .find(|m| m.id == id)
                                .or_else(|| self.metas.iter().find(|m| m.id.starts_with(id)))
                                .map(|m| m.id.clone());
                            match full {
                                Some(id) => self.open_conversation(&id),
                                None => {
                                    self.push_message("system", &format!("vault: no chat {id:?}"))
                                }
                            }
                        }
                        None => self.push_message("system", "usage: /vault open <id>"),
                    },
                    "delete" | "del" => match it.next() {
                        Some(id) => {
                            let full = self
                                .metas
                                .iter()
                                .find(|m| m.id == id)
                                .or_else(|| self.metas.iter().find(|m| m.id.starts_with(id)))
                                .map(|m| m.id.clone());
                            match full {
                                Some(id) => match host::delete_conversation(&id) {
                                    Ok(()) => {
                                        self.metas.retain(|m| m.id != id);
                                        if self.conv.id == id {
                                            self.push_message(
                                                "system",
                                                "vault: current chat deleted — /new",
                                            );
                                        } else {
                                            self.push_message(
                                                "system",
                                                &format!(
                                                    "vault: deleted {}",
                                                    &id[..id.len().min(8)]
                                                ),
                                            );
                                        }
                                    }
                                    Err(e) => self.push_message(
                                        "system",
                                        &format!("vault: delete failed: {e}"),
                                    ),
                                },
                                None => {
                                    self.push_message("system", &format!("vault: no chat {id:?}"))
                                }
                            }
                        }
                        None => self.push_message("system", "usage: /vault delete <id>"),
                    },
                    _ => self.push_message(
                        "system",
                        "vault: /vault list · /vault save · /vault open <id> · /vault delete <id>",
                    ),
                }
            }
            "rag" => {
                let sub = arg.split_whitespace().next().unwrap_or("");
                match sub {
                    "" | "list" | "status" => {
                        if self.rag.is_empty() {
                            self.push_message(
                                "system",
                                "rag: no documents — /rag <path> to index a file",
                            );
                        } else {
                            let rows: Vec<String> = self
                                .rag
                                .documents
                                .iter()
                                .map(|d| {
                                    format!(
                                        "  {} · {} chunk(s) · {}",
                                        d.title,
                                        d.chunk_count(),
                                        d.path
                                    )
                                })
                                .collect();
                            self.push_message(
                                "system",
                                &format!(
                                    "rag: {} document(s), {} chunk(s)",
                                    self.rag.documents.len(),
                                    self.rag.chunk_count()
                                ),
                            );
                            for row in rows {
                                self.push_message("system", &row);
                            }
                        }
                    }
                    "clear" => {
                        let n = self.rag.documents.len();
                        self.rag.clear();
                        self.status = format!("rag: cleared {n} document(s)");
                    }
                    _ => {
                        let path = std::path::PathBuf::from(&arg);
                        match self.rag.ingest_path(&path) {
                            Ok(doc) => {
                                let (title, chunks) = (doc.title.clone(), doc.chunk_count());
                                self.status = format!("rag: {title} indexed ({chunks} chunks)");
                                self.push_message(
                                    "system",
                                    &format!(
                                        "rag: indexed {title} — {chunks} chunk(s); ask a question to retrieve it"
                                    ),
                                );
                            }
                            Err(e) => self.push_message("system", &format!("rag: {e}")),
                        }
                    }
                }
            }
            "card" => {
                if arg.is_empty() {
                    match &self.card {
                        Some(card) => self.push_message(
                            "system",
                            &format!(
                                "card: {} · {} lore entries · /card off to unload",
                                card.name,
                                card.character_book
                                    .as_ref()
                                    .map(|b| b.entries.len())
                                    .unwrap_or(0)
                            ),
                        ),
                        None => self.push_message(
                            "system",
                            "no card — /card <path.json> loads a V1/V2 character card",
                        ),
                    }
                } else if matches!(arg.as_str(), "off" | "none" | "clear") {
                    self.card = None;
                    self.push_message("system", "card unloaded — plain chat");
                } else {
                    match std::fs::read_to_string(&arg)
                        .map_err(|e| e.to_string())
                        .and_then(|text| prism_core::cards::parse_card(&text))
                    {
                        Ok(card) => {
                            let name = card.name.clone();
                            let first = card.first_mes.clone();
                            let lore = card
                                .character_book
                                .as_ref()
                                .map(|b| b.entries.len())
                                .unwrap_or(0);
                            let first_turn = self.conv.messages.is_empty();
                            self.card = Some(card);
                            if first_turn && !first.trim().is_empty() {
                                self.push_message("assistant", &first);
                            }
                            self.push_message(
                                "system",
                                &format!("card loaded: {name} ({lore} lore entries)"),
                            );
                        }
                        Err(e) => self.push_message("system", &format!("card: {e}")),
                    }
                }
            }
            "persona" => {
                if arg.is_empty() {
                    self.push_message(
                        "system",
                        &format!(
                            "persona: {} | {} (usage: /persona <name[|description]>)",
                            self.persona.name, self.persona.description
                        ),
                    );
                } else if let Some((name, desc)) = arg.split_once('|') {
                    self.persona.name = name.trim().to_string();
                    self.persona.description = desc.trim().to_string();
                    self.status = format!("persona: {}", self.persona.name);
                } else {
                    self.persona.name = arg.trim().to_string();
                    self.persona.description.clear();
                    self.status = format!("persona: {}", self.persona.name);
                }
            }
            "hardware" => {
                let mut it = arg.split_whitespace();
                let sub = it.next().unwrap_or("show");
                match sub {
                    "show" | "" => {
                        self.push_message(
                            "system",
                            &format!(
                                "hardware: compute {} · gpu {:?} · ctx {:?}",
                                self.settings.hardware.preferred_compute,
                                self.settings.hardware.gpu_layers_override,
                                self.settings.hardware.context_tokens
                            ),
                        );
                    }
                    "compute" => match it.next() {
                        Some(level)
                            if matches!(
                                level,
                                "auto"
                                    | "cpu-only"
                                    | "gpu-auto"
                                    | "gpu-nvidia"
                                    | "gpu-amd"
                                    | "gpu-intel"
                            ) =>
                        {
                            self.settings.hardware.preferred_compute = level.to_string();
                            self.persist_settings();
                            self.status = format!("compute: {level}");
                        }
                        _ => self.push_message(
                            "system",
                            "usage: /hardware compute auto|cpu-only|gpu-auto|gpu-nvidia|gpu-amd|gpu-intel",
                        ),
                    },
                    "gpu" => match it.next() {
                        Some("off") => {
                            self.settings.hardware.gpu_layers_override = None;
                            self.persist_settings();
                            self.status = "gpu layers: auto".into();
                        }
                        Some(n) => match n.parse::<u32>() {
                            Ok(v) => {
                                self.settings.hardware.gpu_layers_override = Some(v);
                                self.persist_settings();
                                self.status = format!("gpu layers: {v}");
                            }
                            Err(_) => self.push_message("system", "usage: /hardware gpu <n|off>"),
                        },
                        None => self.push_message("system", "usage: /hardware gpu <n|off>"),
                    },
                    "ctx" => match it.next() {
                        Some("off") => {
                            self.settings.hardware.context_tokens = None;
                            self.persist_settings();
                            self.status = "context: server default".into();
                        }
                        Some(n) => match n.parse::<u32>() {
                            Ok(v) => {
                                self.settings.hardware.context_tokens = Some(v);
                                self.persist_settings();
                                self.status = format!("context: {v}");
                            }
                            Err(_) => self.push_message("system", "usage: /hardware ctx <tokens|off>"),
                        },
                        None => self.push_message("system", "usage: /hardware ctx <tokens|off>"),
                    },
                    "reset" => {
                        self.settings.hardware = prism_core::settings::HardwareSettings::default();
                        self.persist_settings();
                        self.status = "hardware: defaults".into();
                    }
                    _ => self.push_message(
                        "system",
                        "hardware: /hardware [compute <level>|gpu <n|off>|ctx <n|off>|reset]",
                    ),
                }
            }
            other => {
                // Plugin commands are namespaced: /memory.save, /snippets.add...
                // Rewrite `/memory.save foo` -> `plugins.run_command("memory.save", "foo")`.
                if let Some((plugin_id, sub)) = other.split_once('.') {
                    let res = self.plugins.run_command(
                        &*host::storage(),
                        host::config_dir().as_deref(),
                        &format!("{plugin_id}.{sub}"),
                        &arg,
                    );
                    match res {
                        Some(Ok(lines)) => {
                            for line in lines {
                                self.push_message("system", &line);
                            }
                        }
                        Some(Err(e)) => {
                            self.push_message("system", &format!("{plugin_id}.{sub} failed: {e}"))
                        }
                        None => self.push_message(
                            "system",
                            &format!("unknown command /{other} — try /help"),
                        ),
                    }
                } else {
                    self.push_message("system", &format!("unknown command /{other} — try /help"));
                }
            }
        }
    }

    // -- MCP panel ---------------------------------------------------------

    /// Open (or re-focus) the MCP monitor and start a discovery pass.
    fn open_mcp_panel(&mut self, tx: &std::sync::mpsc::Sender<Event>) {
        if self.mcp_panel.is_none() {
            self.mcp_panel = Some(McpPanel::new());
        }
        self.mode = Mode::Mcp;
        self.refresh_mcp_panel(tx);
        self.status = "mcp panel — ↑/↓ select · Enter args · r refresh · Esc close".into();
    }

    /// Connect every configured server on a background thread; results
    /// arrive as [`Event::McpTools`] so the UI never blocks.
    fn refresh_mcp_panel(&mut self, tx: &std::sync::mpsc::Sender<Event>) {
        if let Some(panel) = self.mcp_panel.as_mut() {
            panel.busy = true;
            panel.errors.clear();
        }
        let tx = tx.clone();
        std::thread::spawn(move || {
            let path = prism_core::mcp::config_path().map(|p| p.display().to_string());
            let Some(file) = prism_core::mcp::load_file() else {
                let _ = tx.send(Event::McpTools {
                    path,
                    tools: Vec::new(),
                    errors: vec!["no usable configuration (add an \"mcpServers\" object)".into()],
                });
                return;
            };
            if file.mcp_servers.is_empty() {
                let _ = tx.send(Event::McpTools {
                    path,
                    tools: Vec::new(),
                    errors: vec!["configuration has no servers with a command".into()],
                });
                return;
            }
            let surface = prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
            let tools = surface
                .tools
                .iter()
                .map(|t| McpToolRow {
                    server: t.server_name().to_string(),
                    raw: t.raw.clone(),
                    advertised: t.advertised.clone(),
                    description: t.description().to_string(),
                    schema: t.schema.clone(),
                })
                .collect();
            let _ = tx.send(Event::McpTools {
                path,
                tools,
                errors: surface.errors,
            });
        });
    }

    /// Call the selected tool with the panel's JSON args on a background
    /// thread. A fresh server is spawned for the call, so a hung tool can
    /// never wedge the UI.
    fn run_mcp_call(&mut self, tx: &std::sync::mpsc::Sender<Event>) {
        let Some(panel) = self.mcp_panel.as_mut() else {
            return;
        };
        let Some(tool) = panel.selected_tool().cloned() else {
            return;
        };
        let args = panel.args.trim().to_string();
        panel.busy = true;
        panel.editing = false;
        panel.result = None;
        panel.result_scroll = 0;
        let tx = tx.clone();
        std::thread::spawn(move || {
            let output = match prism_core::mcp::load_file()
                .and_then(|f| f.mcp_servers.get(&tool.server).cloned())
            {
                Some(cfg) => match prism_core::mcp::StdioMcpServer::spawn(
                    &tool.server,
                    &cfg,
                    Duration::from_secs(20),
                ) {
                    Ok(server) => {
                        let out = server.call_tool(
                            &tool.raw,
                            if args.is_empty() { "{}" } else { &args },
                            &tool.schema,
                        );
                        server.stop();
                        out
                    }
                    Err(e) => format!("Error: {e}"),
                },
                None => format!(
                    "Error: server {:?} is no longer configured — refresh",
                    tool.server
                ),
            };
            let _ = tx.send(Event::McpCall {
                tool: tool.advertised,
                output,
            });
        });
    }

    fn close_mcp_panel(&mut self) {
        self.mcp_panel = None;
        self.mode = Mode::Normal;
        self.status = "ready".into();
    }

    fn persist_settings(&mut self) {
        if let Err(e) = host::save_settings(&self.settings) {
            self.status = format!("settings save failed: {e}");
        }
    }

    fn open_conversation(&mut self, id: &str) {
        match host::load_conversation(id) {
            Some(conv) => {
                self.save();
                self.conv = conv;
                self.scroll = 0;
                self.invalidate_search();
                self.refresh_meta();
                self.status = format!("opened: {}", self.conv.title);
            }
            None => self.status = format!("conversation not found: {id}"),
        }
    }

    // -- keys ---------------------------------------------------------------

    pub fn handle_key(&mut self, key: KeyEvent, tx: &std::sync::mpsc::Sender<Event>) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        let alt = key.modifiers.contains(KeyModifiers::ALT);
        match (self.mode, key.code, ctrl, alt) {
            (_, KeyCode::Char('c'), true, _) => {
                self.quit = true;
            }
            (Mode::Mcp, KeyCode::Esc, _, _) => {
                let editing = self.mcp_panel.as_ref().map(|p| p.editing).unwrap_or(false);
                if editing {
                    if let Some(panel) = self.mcp_panel.as_mut() {
                        panel.editing = false;
                    }
                    self.status = "mcp: args discarded".into();
                } else {
                    self.close_mcp_panel();
                }
            }
            (Mode::Mcp, KeyCode::Enter, _, _) => {
                let editing = self.mcp_panel.as_ref().map(|p| p.editing).unwrap_or(false);
                if editing {
                    self.run_mcp_call(tx);
                } else if let Some(panel) = self.mcp_panel.as_mut() {
                    panel.editing = true;
                    if panel.args.trim().is_empty() {
                        panel.args = "{}".into();
                    }
                    self.status = "mcp: edit JSON args, Enter to run, Esc to cancel".into();
                }
            }
            (Mode::Mcp, KeyCode::Up, false, false) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    if !panel.editing {
                        panel.selected = panel.selected.saturating_sub(1);
                    }
                }
            }
            (Mode::Mcp, KeyCode::Down, false, false) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    if !panel.editing && panel.selected + 1 < panel.tools.len() {
                        panel.selected += 1;
                    }
                }
            }
            (Mode::Mcp, KeyCode::PageUp, _, _) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    panel.result_scroll = panel.result_scroll.saturating_sub(5);
                }
            }
            (Mode::Mcp, KeyCode::PageDown, _, _) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    panel.result_scroll += 5;
                }
            }
            (Mode::Mcp, KeyCode::Char('r'), false, false) => {
                let editing = self.mcp_panel.as_ref().map(|p| p.editing).unwrap_or(false);
                if !editing {
                    self.refresh_mcp_panel(tx);
                }
            }
            (Mode::Mcp, KeyCode::Backspace, false, _) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    if panel.editing {
                        panel.args.pop();
                    }
                }
            }
            (Mode::Mcp, KeyCode::Char('u'), true, _) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    if panel.editing {
                        panel.args.clear();
                    }
                }
            }
            (Mode::Mcp, KeyCode::Char(c), false, false) => {
                if let Some(panel) = self.mcp_panel.as_mut() {
                    if panel.editing && panel.args.len() < 4096 {
                        panel.args.push(c);
                    }
                }
            }
            (Mode::Search, KeyCode::Esc, _, _) => {
                self.mode = Mode::Normal;
                self.input.clear();
                self.cursor = 0;
            }
            (Mode::Search, KeyCode::Enter, _, _) => {
                let needle: String = self.input.iter().collect();
                self.apply_search(&needle);
                self.mode = Mode::Normal;
                self.input.clear();
                self.cursor = 0;
                if let Some(&msg) = self.matches.first() {
                    self.jump_to_message(msg);
                }
            }
            (Mode::Search, KeyCode::Backspace, false, _) => {
                self.pop_char();
                let needle: String = self.input.iter().collect();
                self.apply_search_live(&needle);
            }
            (Mode::Search, KeyCode::Char(c), false, _) => {
                self.insert_char(c);
                let needle: String = self.input.iter().collect();
                self.apply_search_live(&needle);
            }
            (Mode::Normal, KeyCode::Esc, _, _) => {
                if self.streaming.is_some() {
                    self.abort_stream();
                } else if !self.input.is_empty() {
                    self.input.clear();
                    self.cursor = 0;
                    self.history_pos = None;
                }
            }
            (Mode::Normal, KeyCode::Enter, _, false) => {
                let text: String = self.input.iter().collect();
                let text = text.trim().to_string();
                self.input.clear();
                self.cursor = 0;
                self.history_pos = None;
                if text.is_empty() {
                    return;
                }
                self.history.push_back(text.clone());
                if self.history.len() > 100 {
                    self.history.pop_front();
                }
                if text.starts_with('/') {
                    self.run_command(&text, tx);
                } else {
                    self.send_message(&text, tx);
                }
            }
            (Mode::Normal, KeyCode::Char(c), false, true) => {
                self.handle_alt_key(c);
            }
            (Mode::Normal, KeyCode::Up, false, false) => {
                if self.input.is_empty() || self.history_pos.is_some() {
                    self.browse_history(-1);
                } else {
                    self.scroll_page(1);
                }
            }
            (Mode::Normal, KeyCode::Down, false, false) => {
                if self.history_pos.is_some() {
                    self.browse_history(1);
                } else if self.scroll > 0 {
                    self.scroll_page(-1);
                }
            }
            (Mode::Normal, KeyCode::PageUp, _, _) => self.scroll_page(10),
            (Mode::Normal, KeyCode::PageDown, _, _) => self.scroll_page(-10),
            (Mode::Normal, KeyCode::Home, false, false) => {
                self.scroll = self.total_lines.saturating_sub(self.viewport.max(1));
            }
            (Mode::Normal, KeyCode::End, false, false) => self.scroll = 0,
            (Mode::Normal, KeyCode::Char('f'), true, _) => {
                self.mode = Mode::Search;
                self.input.clear();
                self.cursor = 0;
                self.status = "search: type, Enter to jump, n/N to navigate".into();
            }
            (Mode::Normal, KeyCode::Char('n'), false, _) if self.search.is_some() => {
                self.cycle_match(1);
            }
            (Mode::Normal, KeyCode::Char('N'), false, _) if self.search.is_some() => {
                self.cycle_match(-1);
            }
            (Mode::Normal, KeyCode::Char('t'), true, _) => {
                self.settings.thinking_enabled = !self.settings.thinking_enabled;
                self.persist_settings();
                self.status = format!("thinking: {}", self.settings.thinking_enabled);
            }
            (Mode::Normal, KeyCode::Char('u'), true, _) => {
                self.input.clear();
                self.cursor = 0;
                self.history_pos = None;
            }
            (Mode::Normal, KeyCode::Char('w'), true, _) => self.delete_word(),
            (Mode::Normal, KeyCode::Backspace, false, _) => self.pop_char(),
            (Mode::Normal, KeyCode::Delete, false, _) => self.delete_at_cursor(),
            (Mode::Normal, KeyCode::Left, false, _) => self.cursor = self.cursor.saturating_sub(1),
            (Mode::Normal, KeyCode::Right, false, _) => {
                self.cursor = (self.cursor + 1).min(self.input.len())
            }
            (Mode::Normal, KeyCode::Home, false, true) => self.cursor = 0,
            (Mode::Normal, KeyCode::End, false, true) => self.cursor = self.input.len(),
            (Mode::Normal, KeyCode::Char(c), false, false) => self.insert_char(c),
            (Mode::Normal, KeyCode::Char('n'), true, _) => {
                // Ctrl+N: next queued message preview.
                self.status = format!("queue: {} pending", self.queue.len());
            }
            _ => {}
        }
    }

    fn handle_alt_key(&mut self, c: char) {
        match c {
            'n' | 'N' => {
                self.save();
                self.conv = Conversation {
                    id: conversations::new_id(),
                    title: String::new(),
                    created_at: conversations::now_ms(),
                    updated_at: conversations::now_ms(),
                    messages: Vec::new(),
                    tags: Vec::new(),
                    archived: false,
                    read: true,
                    forked_from: None,
                    forked_at_message: None,
                };
                self.search = None;
                self.matches.clear();
                self.scroll = 0;
                self.save();
                self.status = "new conversation".into();
            }
            'p' | 'P' => {
                self.selected = self.selected.saturating_sub(1);
                self.status = format!("selected: {}", self.list_title(self.selected));
            }
            'k' | 'K' => {
                if self.selected + 1 < self.metas.len() {
                    self.selected += 1;
                }
                self.status = format!("selected: {}", self.list_title(self.selected));
            }
            '\r' | 'o' | 'O' => {
                if let Some(meta) = self.metas.get(self.selected).cloned() {
                    self.open_conversation(&meta.id);
                }
            }
            'm' | 'M' => {
                let next = IMode::all()
                    .iter()
                    .copied()
                    .position(|m| m == self.imode)
                    .map(|i| IMode::all()[(i + 1) % IMode::all().len()])
                    .unwrap_or(IMode::Chat);
                self.set_imode(next);
            }
            'q' | 'Q' => self.quit = true,
            _ => {}
        }
    }

    /// The modes in this session, as a short human string.
    pub fn mix_summary(&self) -> String {
        self.session
            .active_modes()
            .iter()
            .map(|m| m.label())
            .collect::<Vec<_>>()
            .join(" + ")
    }

    /// Push the session's effective traits into the surfaces that read
    /// them: the capability layer's tool list and the agent gate. The
    /// session is the source of truth for what the TUI may do.
    fn apply_session(&mut self) {
        let traits = self.session.active_traits();
        // The advertised tool list follows the Tools capability: with
        // tools off, no tool may be permitted even if an override says
        // allow.
        if !traits.tools {
            self.session.capability.tools.clear();
            self.session.capability.permissions.clear();
            self.agent_running = false;
        }
    }

    /// Switch interaction mode. The mode is not a label: Code and Chat
    /// advertise no tools, so the system prompt is reset to the mode
    /// preset (any user override is discarded, because "style only"
    /// cannot coexist with a prompt that says "use the shell"), and the
    /// agent job refuses to start.
    pub fn set_imode(&mut self, mode: IMode) {
        self.imode = mode;
        // Keep the session's primary mode in step; switching modes
        // clears the blend and the feature overrides, matching the core.
        // The full available tool list is passed so a mode that grants
        // tools advertises all of them.
        self.session
            .set_mode(mode, &crate::chat::agent_job::available_tool_names());
        let t = mode.traits();
        // The mode preset becomes the system prompt unless the user set
        // one explicitly (then Mode::Code would be a no-op switch).
        let preset = prism_core::session::default_system_prompt(mode).to_string();
        let user_set = !self.settings.system_prompt.trim().is_empty();
        if !user_set {
            self.settings.system_prompt = preset.clone();
        }
        let mut bits = vec![mode.label().to_string()];
        if t.tools {
            bits.push("tools".into());
        }
        if t.subagents {
            bits.push("subagents".into());
        }
        if t.commands.is_empty() {
            bits.push("no commands".into());
        }
        if t.tools {
            self.status = format!("mode: {} · {}", bits.join(" + "), t.style.style_label());
        } else {
            // Style-only modes: no agent run and no tool surface.
            self.agent_running = false;
            self.status = format!(
                "mode: {} · {} · tools off{}",
                bits.join(" + "),
                t.style.style_label(),
                if user_set { " (prompt kept)" } else { "" }
            );
        }
        self.persist_settings();
    }

    fn list_title(&self, idx: usize) -> String {
        self.metas
            .get(idx)
            .map(|m| {
                if m.title.is_empty() {
                    "(untitled)".to_string()
                } else {
                    m.title.clone()
                }
            })
            .unwrap_or_else(|| "(none)".to_string())
    }

    // -- editing helpers ---------------------------------------------------

    fn insert_char(&mut self, c: char) {
        self.input.insert(self.cursor.min(self.input.len()), c);
        self.cursor += 1;
    }

    fn pop_char(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            self.input.remove(self.cursor);
        }
    }

    fn delete_at_cursor(&mut self) {
        if self.cursor < self.input.len() {
            self.input.remove(self.cursor);
        }
    }

    fn delete_word(&mut self) {
        while self.cursor > 0 && self.input[self.cursor - 1].is_whitespace() {
            self.cursor -= 1;
        }
        while self.cursor > 0 && !self.input[self.cursor - 1].is_whitespace() {
            self.cursor -= 1;
        }
        self.input.truncate(self.cursor);
    }

    fn browse_history(&mut self, dir: i32) {
        if self.history.is_empty() {
            return;
        }
        let len = self.history.len() as i64;
        let pos = self.history_pos.map(|p| p as i64).unwrap_or(len);
        let next = (pos + dir as i64).clamp(0, len);
        self.history_pos = Some(next as usize);
        let text = if next == len {
            String::new()
        } else {
            self.history[next as usize].clone()
        };
        self.input = text.chars().collect();
        self.cursor = self.input.len();
    }

    // -- scrolling ---------------------------------------------------------

    pub fn scroll_page(&mut self, lines: i32) {
        let max = self.total_lines.saturating_sub(self.viewport.max(1));
        if lines >= 0 {
            self.scroll = (self.scroll + lines as usize).min(max);
        } else {
            self.scroll = self.scroll.saturating_sub(lines.unsigned_abs() as usize);
        }
    }

    // -- search ------------------------------------------------------------

    fn apply_search(&mut self, needle: &str) {
        if needle.is_empty() {
            self.search = None;
            self.matches.clear();
            self.status = "search cleared".into();
            return;
        }
        self.search = Some(needle.to_string());
        self.compute_matches();
        self.match_sel = 0;
        self.status = if self.matches.is_empty() {
            format!("no matches for “{needle}”")
        } else {
            format!(
                "{} matches for “{}” · n/N to navigate",
                self.matches.len(),
                needle
            )
        };
    }

    fn apply_search_live(&mut self, needle: &str) {
        if needle.is_empty() {
            self.matches.clear();
            return;
        }
        self.search = Some(needle.to_string());
        self.compute_matches();
        self.status = format!("search: {} matches", self.matches.len());
    }

    fn invalidate_search(&mut self) {
        if self.search.is_some() {
            self.compute_matches();
        }
    }

    fn compute_matches(&mut self) {
        self.matches.clear();
        if let Some(needle) = &self.search {
            let needle = needle.to_lowercase();
            for (i, msg) in self.conv.messages.iter().enumerate() {
                if msg.content.to_lowercase().contains(&needle)
                    || msg
                        .thinking
                        .as_deref()
                        .map(|t| t.to_lowercase().contains(&needle))
                        .unwrap_or(false)
                {
                    self.matches.push(i);
                }
            }
        }
        if self.match_sel >= self.matches.len() {
            self.match_sel = 0;
        }
    }

    pub fn cycle_match(&mut self, dir: i32) {
        if self.matches.is_empty() {
            return;
        }
        let len = self.matches.len() as i64;
        let sel = self.match_sel as i64;
        self.match_sel = ((sel + dir as i64).rem_euclid(len)) as usize;
        self.jump_to_message(self.matches[self.match_sel]);
    }

    pub fn jump_to_message(&mut self, msg_idx: usize) {
        if let Some(&(_, line)) = self.line_index.iter().find(|(m, _)| *m == msg_idx) {
            let view = self.viewport.max(1);
            self.scroll = self.total_lines.saturating_sub(view).saturating_sub(line);
        }
    }

    // -- misc ----------------------------------------------------------------

    pub fn estimate_tokens(&self) -> usize {
        self.conv
            .messages
            .iter()
            .map(|m| m.content.chars().count() + m.thinking.as_deref().map(str::len).unwrap_or(0))
            .sum::<usize>()
            / 4
    }

    pub fn input_text(&self) -> String {
        self.input.iter().collect()
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming.is_some()
    }

    pub fn spinner_char(&self) -> &'static str {
        const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        FRAMES[self.spinner % FRAMES.len()]
    }
}
