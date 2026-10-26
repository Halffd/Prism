//! Application state and event application for the Prism CLI.
//!
//! Single-owner design: only the main loop mutates `App`, and only
//! through `handle_*` methods. Chat jobs run in background threads and
//! report back as `Event::Stream`.

use crate::chat;
use crate::events::Event;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use prism_core::client::StreamEvent;
use prism_core::conversations::{self, Conversation, ConversationMeta, StoredMessage};
use prism_core::host;
use prism_core::providers;
use prism_core::settings::Connection;
use prism_core::thinking;
use std::collections::VecDeque;
use std::time::Instant;

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
}

pub struct App {
    pub settings: prism_core::settings::Settings,
    pub conv: Conversation,
    pub metas: Vec<ConversationMeta>,
    pub selected: usize,

    pub input: Vec<char>,
    pub cursor: usize,
    pub mode: Mode,
    pub search: Option<String>,
    pub matches: Vec<usize>,
    pub match_sel: usize,

    pub streaming: Option<StreamState>,
    pub queue: VecDeque<String>,
    pub queue_paused: bool,
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
}

impl App {
    pub fn new(settings: prism_core::settings::Settings) -> Self {
        let mut app = App {
            settings,
            conv: Conversation {
                id: conversations::new_id(),
                title: String::new(),
                created_at: conversations::now_ms(),
                updated_at: conversations::now_ms(),
                messages: Vec::new(),
            },
            metas: host::list_conversations(),
            selected: 0,
            input: Vec::new(),
            cursor: 0,
            mode: Mode::Normal,
            search: None,
            matches: Vec::new(),
            match_sel: 0,
            streaming: None,
            queue: VecDeque::new(),
            queue_paused: false,
            spinner: 0,
            scroll: 0,
            line_index: Vec::new(),
            total_lines: 0,
            viewport: 0,
            history: VecDeque::new(),
            history_pos: None,
            status: "ready".into(),
            quit: false,
        };
        // Resume the most recent conversation so a restart keeps working.
        if let Some(meta) = app.metas.first().cloned() {
            if let Some(conv) = host::load_conversation(&meta.id) {
                app.conv = conv;
                app.selected = 0;
            }
        }
        app.status = format!(
            "ready · {} · {}",
            app.settings.provider,
            app.effective_model()
        );
        app
    }

    pub fn effective_model(&self) -> String {
        if !self.settings.model.trim().is_empty() {
            self.settings.model.trim().to_string()
        } else {
            providers::find(&self.settings.provider)
                .map(|p| p.default_model.to_string())
                .unwrap_or_default()
        }
    }

    /// Conversation history for the model, excluding system lines.
    fn history(&self) -> Vec<prism_core::client::ChatMessage> {
        self.conv
            .messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| prism_core::client::ChatMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect()
    }

    /// Append and persist a transcript message (also used for system notes).
    pub fn push_message(&mut self, role: &str, content: &str) {
        self.conv.messages.push(StoredMessage {
            role: role.into(),
            content: content.into(),
            thinking: None,
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
                        last.content = clean;
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
        let mut history = self.history();
        history.push(prism_core::client::ChatMessage {
            role: "user".into(),
            content: content.clone(),
        });

        match chat::start_job(&self.settings, history, tx) {
            Ok(()) => {
                self.push_message("user", &content);
                self.conv.messages.push(StoredMessage {
                    role: "assistant".into(),
                    content: String::new(),
                    thinking: None,
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

    fn run_command(&mut self, raw: &str) {
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
            "search" => {
                self.mode = Mode::Search;
                self.input = arg.chars().collect();
                self.cursor = self.input.len();
            }
            "quit" | "q" => self.quit = true,
            other => self.push_message("system", &format!("unknown command /{other} — try /help")),
        }
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
                    self.run_command(&text);
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
            'q' | 'Q' => self.quit = true,
            _ => {}
        }
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
