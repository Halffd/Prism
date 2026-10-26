//! Rendering: ratatui panes over the single `App` state.
//!
//! Layout per the CLI design: left pane = conversation list, center =
//! searchable timeline with persistent scrollback, right = session
//! details, bottom = composer + queue + keybinding hints.

use crate::state::{App, Mode};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line as RtLine, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
use ratatui::Frame;

pub const HELP_LINES: &[&str] = &[
    "Prism CLI — commands: /help /new /load N /del N /model X /provider X /key X /system X /think /temp X /conn direct|api /search X /quit",
    "keys: Enter send · Esc stop/clear · Ctrl+F search (n/N navigate) · PgUp/PgDn scroll · Ctrl+T thinking · Alt+N new chat · Alt+P/K pick chat · Alt+O open · Ctrl+U clear input · Ctrl+W del word · Ctrl+C quit",
];

const LEFT_WIDTH: u16 = 26;
const RIGHT_WIDTH: u16 = 30;

pub fn draw(f: &mut Frame, app: &mut App) {
    let outer = Layout::vertical([
        Constraint::Min(0),
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .split(f.area());

    let panes = Layout::horizontal([
        Constraint::Length(LEFT_WIDTH),
        Constraint::Min(0),
        Constraint::Length(RIGHT_WIDTH),
    ])
    .split(outer[0]);

    draw_conversations(f, app, panes[0]);
    draw_timeline(f, app, panes[1]);
    draw_details(f, app, panes[2]);
    draw_composer(f, app, outer[1]);
    draw_status(f, app, outer[2]);
}

fn age(now: u64, then: u64) -> String {
    let secs = now.saturating_sub(then) / 1000;
    match secs {
        0..=59 => format!("{secs}s"),
        60..=3599 => format!("{}m", secs / 60),
        3600..=86399 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86400),
    }
}

fn draw_conversations(f: &mut Frame, app: &App, area: Rect) {
    let inner_w = area.width.saturating_sub(2) as usize;
    let items: Vec<ListItem> = app
        .metas
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let marker = if m.id == app.conv.id { "●" } else { " " };
            let selected = if i == app.selected { "▸" } else { " " };
            let title = if m.title.is_empty() {
                "(untitled)".to_string()
            } else {
                let mut t: String = m.title.chars().take(inner_w.saturating_sub(14)).collect();
                if m.title.chars().count() > inner_w.saturating_sub(14) {
                    t.push('…');
                }
                t
            };
            let style = if i == app.selected {
                Style::new().fg(Color::Cyan).add_modifier(Modifier::BOLD)
            } else if m.id == app.conv.id {
                Style::new().fg(Color::Green)
            } else {
                Style::new().fg(Color::DarkGray)
            };
            ListItem::new(RtLine::from(Span::styled(
                format!(
                    "{marker}{selected} {} · {}",
                    title,
                    age(conversations_now(), m.updated_at)
                ),
                style,
            )))
        })
        .collect();

    let list = List::new(items).block(Block::new().borders(Borders::ALL).title(Span::styled(
        " conversations ",
        Style::new().fg(Color::Cyan),
    )));
    f.render_widget(list, area);
}

fn conversations_now() -> u64 {
    prism_core::conversations::now_ms()
}

fn draw_timeline(f: &mut Frame, app: &mut App, area: Rect) {
    let inner_w = area.width.saturating_sub(2).max(10) as usize;
    let mut lines: Vec<RtLine> = Vec::new();
    let mut index: Vec<(usize, usize)> = Vec::new();
    let sel_match = app.matches.get(app.match_sel).copied();

    if app.conv.messages.is_empty() {
        lines.push(RtLine::from(Span::styled(
            "Empty chat — type a message, /help for commands.",
            Style::new().fg(Color::DarkGray),
        )));
    }

    let streaming_last = app.is_streaming();
    let total_msgs = app.conv.messages.len();
    for (i, msg) in app.conv.messages.iter().enumerate() {
        index.push((i, lines.len()));
        let highlight = app.search.as_deref().map(|n| {
            let hay = format!(
                "{} {}",
                msg.content,
                msg.thinking.clone().unwrap_or_default()
            );
            hay.to_lowercase().contains(&n.to_lowercase())
        });
        let marker = if Some(i) == sel_match {
            "⇒ "
        } else if highlight == Some(true) {
            "› "
        } else {
            ""
        };

        match msg.role.as_str() {
            "user" => {
                push_wrapped(
                    &mut lines,
                    &wrap_text(&format!("{marker}you ▸ {}", msg.content), inner_w),
                    Style::new().fg(Color::Cyan),
                );
            }
            "system" => {
                push_wrapped(
                    &mut lines,
                    &wrap_text(&format!("{marker}· {}", msg.content), inner_w),
                    Style::new().fg(Color::Yellow).add_modifier(Modifier::DIM),
                );
            }
            _ => {
                if let Some(think) = &msg.thinking {
                    push_wrapped(
                        &mut lines,
                        &wrap_text(&format!("{marker}· thinking ·"), inner_w),
                        Style::new().fg(Color::Magenta).add_modifier(Modifier::DIM),
                    );
                    push_wrapped(
                        &mut lines,
                        &wrap_text(think, inner_w.saturating_sub(2)),
                        Style::new()
                            .fg(Color::DarkGray)
                            .add_modifier(Modifier::ITALIC),
                    );
                }
                let mut content = msg.content.clone();
                if streaming_last && i + 1 == total_msgs {
                    content = format!("{} {}", content, app.spinner_char());
                }
                push_wrapped(
                    &mut lines,
                    &wrap_text(&format!("{marker}prism ▸ {content}"), inner_w),
                    Style::new().fg(Color::White),
                );
            }
        }
        // One blank separator line between messages.
        lines.push(RtLine::from(""));
    }
    // Drop trailing separator for a tight bottom edge.
    if lines.len() > 1 {
        lines.pop();
    }

    app.line_index = index;
    app.total_lines = lines.len();
    let view = area.height.saturating_sub(2) as usize;
    app.viewport = view;
    let max_scroll = app.total_lines.saturating_sub(view.max(1));
    app.scroll = app.scroll.min(max_scroll);
    let skip = max_scroll.saturating_sub(app.scroll);

    let title = if app.conv.title.is_empty() {
        " chat ".to_string()
    } else {
        format!(" {} ", truncate(&app.conv.title, inner_w.saturating_sub(8)))
    };
    let block = Block::new()
        .borders(Borders::ALL)
        .title(Span::styled(title, Style::new().fg(Color::Cyan)));
    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((skip as u16, 0));
    f.render_widget(paragraph, area);
}

fn draw_details(f: &mut Frame, app: &App, area: Rect) {
    let s = &app.settings;
    let def = prism_core::providers::find(&s.provider);
    let key_set = !s.key_for(&s.provider).trim().is_empty();
    let needs_key = def.map(|d| d.needs_key).unwrap_or(false);
    let conn = match s.connection {
        prism_core::settings::Connection::Direct => "direct",
        prism_core::settings::Connection::PrismApi => "prism api",
    };
    let mut rows: Vec<RtLine> = vec![
        kv("provider", &s.provider),
        kv("model", &app.effective_model()),
        kv("connection", conn),
        kv(
            "key",
            if needs_key && !key_set {
                "MISSING (/key)"
            } else if needs_key {
                "set"
            } else {
                "n/a"
            },
        ),
        kv("temperature", &format!("{:.2}", s.temperature)),
        kv(
            "max tokens",
            &s.max_tokens
                .map(|v| v.to_string())
                .unwrap_or("server".into()),
        ),
        kv(
            "thinking",
            if s.thinking_enabled {
                "on (Ctrl+T)"
            } else {
                "off (Ctrl+T)"
            },
        ),
        kv(
            "hardware",
            &if s.hardware.has_overrides() {
                format!(
                    "{} · gpu {:?} · ctx {:?}",
                    s.hardware.preferred_compute,
                    s.hardware.gpu_layers_override,
                    s.hardware.context_tokens
                )
            } else {
                "defaults".into()
            },
        ),
        RtLine::from(""),
        kv("messages", &app.conv.messages.len().to_string()),
        kv("ctx ~tokens", &app.estimate_tokens().to_string()),
        kv(
            "queue",
            &if app.queue.is_empty() {
                "empty".into()
            } else {
                format!(
                    "{} pending{}",
                    app.queue.len(),
                    if app.queue_paused { " (paused)" } else { "" }
                )
            },
        ),
        RtLine::from(""),
        kv("search", app.search.as_deref().unwrap_or("—")),
        kv(
            "matches",
            &if app.matches.is_empty() {
                "—".into()
            } else {
                format!("{} / {}", app.match_sel + 1, app.matches.len())
            },
        ),
    ];
    if app.is_streaming() {
        rows.push(kv("streaming", "running (Esc to stop)"));
    }
    let block = Block::new()
        .borders(Borders::ALL)
        .title(Span::styled(" session ", Style::new().fg(Color::Cyan)));
    let paragraph = Paragraph::new(rows).block(block).wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

fn kv(k: &str, v: &str) -> RtLine<'static> {
    RtLine::from(vec![
        Span::styled(format!("{k:>12} "), Style::new().fg(Color::DarkGray)),
        Span::styled(v.to_string(), Style::new().fg(Color::Gray)),
    ])
}

fn draw_composer(f: &mut Frame, app: &App, area: Rect) {
    let inner_w = area.width.saturating_sub(2) as usize;
    let mut text = String::new();
    for (i, c) in app.input.iter().enumerate() {
        if i == app.cursor {
            text.push('▌');
        }
        text.push(*c);
    }
    if app.cursor >= app.input.len() {
        text.push('▌');
    }
    let hint = if app.input.first() == Some(&'/') {
        "/help for commands"
    } else {
        "Enter send · Esc stop · Ctrl+F search"
    };
    let title = if app.is_streaming() {
        format!(" {} streaming — Esc stops ", app.spinner_char())
    } else {
        " composer ".to_string()
    };
    let block = Block::new().borders(Borders::ALL).title(Span::styled(
        title,
        Style::new().fg(if app.is_streaming() {
            Color::Green
        } else {
            Color::Cyan
        }),
    ));
    let mut lines = vec![RtLine::from(Span::styled(
        truncate(&text, inner_w),
        Style::new().fg(Color::White),
    ))];
    if app.queue.is_empty() {
        lines.push(RtLine::from(Span::styled(
            truncate(hint, inner_w),
            Style::new().fg(Color::DarkGray),
        )));
    } else {
        let first = app.queue.front().cloned().unwrap_or_default();
        lines.push(RtLine::from(Span::styled(
            truncate(
                &format!("⏳ {} queued · next: {}", app.queue.len(), first),
                inner_w,
            ),
            Style::new().fg(Color::Yellow).add_modifier(Modifier::DIM),
        )));
    }
    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}

fn draw_status(f: &mut Frame, app: &App, area: Rect) {
    let mode = match app.mode {
        Mode::Normal => "",
        Mode::Search => "SEARCH · ",
    };
    let line = RtLine::from(vec![
        Span::styled(format!(" {mode}"), Style::new().fg(Color::Magenta)),
        Span::styled(
            truncate(&app.status, area.width.saturating_sub(4) as usize),
            Style::new().fg(Color::Gray),
        ),
    ]);
    f.render_widget(line, area);
}

// -- helpers -----------------------------------------------------------------

fn truncate(s: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

/// Greedy word wrap with hard breaks; `width` in chars (approximation
/// for wide glyphs, fine for pane navigation).
pub fn wrap_text(s: &str, width: usize) -> Vec<String> {
    let width = width.max(4);
    let mut out = Vec::new();
    for paragraph in s.split('\n') {
        let mut current = String::new();
        for word in paragraph.split(' ') {
            let wlen = word.chars().count();
            if wlen > width {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
                let mut chunk = String::new();
                for c in word.chars() {
                    if chunk.chars().count() == width {
                        out.push(std::mem::take(&mut chunk));
                    }
                    chunk.push(c);
                }
                current = chunk;
            } else if current.chars().count() + wlen + 1 > width {
                out.push(std::mem::take(&mut current));
                current = word.to_string();
            } else {
                if !current.is_empty() {
                    current.push(' ');
                }
                current.push_str(word);
            }
        }
        out.push(current);
    }
    out
}

fn push_wrapped(lines: &mut Vec<RtLine<'static>>, wrapped: &[String], style: Style) {
    for l in wrapped {
        lines.push(RtLine::from(Span::styled(l.clone(), style)));
    }
}
