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
    "Prism CLI — commands: /help /new /load N /del N /model X /provider X /key X /mode [id] /mix [id] /unmix [id] /cap [feature [on|off]] /perm <tool> allow|ask|deny /system X /think /temp X /conn direct|api /local <url> /search X /agent <task> /mcp [panel] /agents [list|spawn <name> <task>] /quit",
    "rag: /rag <path> indexes a local file (paragraph chunks, TF-IDF retrieval) · /rag list · /rag clear — relevant chunks ride into every request",
    "creative: /card <path.json>|off loads a V1/V2 character card (description, lore book, examples) · /persona <name[|description]> sets {{user}} · card prompts go through prism_core::cards",
    "storage: /vault list · /vault save · /vault open <id> · /vault delete <id> — the shared conversation store (same files as prism sessions)",
    "hardware: /hardware [show] · /hardware compute auto|cpu-only|gpu-auto|gpu-nvidia|gpu-amd|gpu-intel · /hardware gpu <n|off> · /hardware ctx <tokens|off> · /hardware reset",
    "modes: chat (no tools) · agent (tools+subagents) · code (style only) · creative (cards+lore) · daemon (tasks, always-on) · generative (image/video/audio) · Alt+M cycles, /mode lists",
    "mixing: /mix <id> blends another mode in (capabilities union, prompt voice stays primary) · /unmix <id> removes it · /cap tools|subagents|commands|character-cards|media|tasks|strategy [on|off] toggles one capability · /perm <tool> allow|ask|deny edits the policy",
    "agent shell: PRISM_AGENT_SANDBOX_POLICY (JSON or file) adds the sandboxed `shell` tool · prism sandbox preflight [--policy FILE] [--json] probes the host",
    "research: /web <query> (DuckDuckGo or SearXNG) · /deep <query> (search + fetch + synthesize) · /multi <prompt> (every provider) · /council [single-judge|peer-vote|consensus] <prompt> · /debate [turns] <topic> · /search-provider duckduckgo|searxng [url] — results open in one scrollable panel",
    "mcp: ~/.config/prism/mcp.json (PRISM_MCP_CONFIG overrides) — \"mcpServers\" registers stdio servers as mcp__server__tool in every agent run · /mcp reports what connects · /mcp panel monitors servers and calls any tool with JSON args",
    "subagents: /agents lists the core registry (explore, security-review, bugbot, ci-investigation, browser-use, shell-ops) plus \"subagents\" entries in mcp.json · /agents spawn <name> <task> runs one in the background with its forced model and clamped tools",
    "keys: Enter send · Esc stop/clear · Ctrl+F search (n/N navigate) · PgUp/PgDn scroll · Ctrl+T thinking · Alt+N new chat · Alt+P/K pick chat · Alt+O open · Alt+M mode · Ctrl+U clear input · Ctrl+W del word · Ctrl+C quit",
    "plugins: /snippets.list · /snippets.add <trigger> <body> · /memory.save <type> <scope> <text> · /memory.read [day] · /memory.search <q> · /ponytail.mode <off|lite|full|ultra> · /planning.plan|plans|read|link|spec|done · /usage.show · /skills.list",
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

    if app.mcp_panel.is_some() {
        draw_mcp_panel(f, app, outer[0]);
    } else if app.research_panel.is_some() {
        draw_research_panel(f, app, outer[0]);
    } else {
        draw_conversations(f, app, panes[0]);
        draw_timeline(f, app, panes[1]);
        draw_details(f, app, panes[2]);
    }
    draw_composer(f, app, outer[1]);
    draw_status(f, app, outer[2]);
}

/// The research panel: one scrollable transcript shared by `/web`,
/// `/deep`, `/multi`, `/council` and `/debate`.
fn draw_research_panel(f: &mut Frame, app: &App, area: Rect) {
    let Some(panel) = &app.research_panel else {
        return;
    };
    let title = format!(
        " {} {} ",
        panel.title,
        if panel.busy { "· running" } else { "· Esc closes" }
    );
    let hint = "↑/↓ scroll · PgUp/PgDn page · Esc/q close";
    let block = Block::new()
        .borders(Borders::ALL)
        .title(Span::styled(title, Style::new().fg(Color::Cyan)))
        .title_bottom(Span::styled(hint, Style::new().fg(Color::DarkGray)));
    let paragraph = Paragraph::new(panel.body.as_str())
        .block(block)
        .scroll((panel.scroll.min(u16::MAX as usize) as u16, 0))
        .wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}

/// The in-app MCP monitor/test panel: servers+tools on the left, the
/// selected tool's schema, arguments and last result on the right.
fn draw_mcp_panel(f: &mut Frame, app: &App, area: Rect) {
    let Some(panel) = &app.mcp_panel else {
        return;
    };
    let cols = Layout::horizontal([Constraint::Percentage(45), Constraint::Min(0)]).split(area);

    let mut items: Vec<ListItem> = Vec::new();
    let mut last_server = "";
    for (i, tool) in panel.tools.iter().enumerate() {
        if tool.server != last_server {
            items.push(ListItem::new(RtLine::from(Span::styled(
                format!("▸ {}", tool.server),
                Style::new().fg(Color::Cyan).add_modifier(Modifier::BOLD),
            ))));
            last_server = &tool.server;
        }
        let style = if i == panel.selected {
            Style::new().fg(Color::Black).bg(Color::Cyan)
        } else {
            Style::new().fg(Color::Gray)
        };
        items.push(ListItem::new(RtLine::from(Span::styled(
            format!("  {}", tool.raw),
            style,
        ))));
    }
    if items.is_empty() {
        items.push(ListItem::new(RtLine::from(Span::styled(
            if panel.busy {
                "connecting…"
            } else {
                "no tools — check mcp.json"
            },
            Style::new().fg(Color::DarkGray),
        ))));
    }
    let title = format!(
        " mcp · {} tool(s){} ",
        panel.tools.len(),
        if panel.busy { " · busy" } else { "" }
    );
    f.render_widget(
        List::new(items).block(
            Block::new()
                .borders(Borders::ALL)
                .title(Span::styled(title, Style::new().fg(Color::Cyan))),
        ),
        cols[0],
    );

    let mut rows: Vec<RtLine> = Vec::new();
    if let Some(path) = &panel.path {
        rows.push(kv("config", path));
    }
    for e in &panel.errors {
        rows.push(RtLine::from(Span::styled(
            format!("  ✗ {e}"),
            Style::new().fg(Color::Red),
        )));
    }
    match panel.selected_tool() {
        Some(tool) => {
            rows.push(kv("tool", &tool.advertised));
            rows.push(kv("server", &tool.server));
            rows.push(kv("raw", &tool.raw));
            rows.push(RtLine::from(""));
            for line in wrap_text(&tool.description, cols[1].width.saturating_sub(4) as usize) {
                rows.push(RtLine::from(Span::styled(
                    line,
                    Style::new().fg(Color::Gray),
                )));
            }
            rows.push(RtLine::from(""));
            let schema = serde_json::to_string_pretty(&tool.schema).unwrap_or_default();
            for line in schema.lines().take(8) {
                rows.push(RtLine::from(Span::styled(
                    format!("  {line}"),
                    Style::new().fg(Color::DarkGray),
                )));
            }
            rows.push(RtLine::from(""));
            let args_style = if panel.editing {
                Style::new().fg(Color::Yellow)
            } else {
                Style::new().fg(Color::Gray)
            };
            rows.push(RtLine::from(vec![
                Span::styled("  args: ", Style::new().fg(Color::DarkGray)),
                Span::styled(
                    if panel.editing {
                        format!("{}▌", panel.args)
                    } else {
                        panel.args.clone()
                    },
                    args_style,
                ),
            ]));
            rows.push(RtLine::from(Span::styled(
                if panel.editing {
                    "  Enter runs · Esc cancels · Ctrl+U clears"
                } else {
                    "  Enter edits args · r reconnects · ↑/↓ select · Esc closes"
                },
                Style::new().fg(Color::DarkGray),
            )));
        }
        None => rows.push(kv("tool", "—")),
    }
    rows.push(RtLine::from(""));
    rows.push(kv(
        "result",
        if panel.busy {
            "running…"
        } else {
            "PgUp/PgDn scroll"
        },
    ));
    if let Some(result) = &panel.result {
        let width = cols[1].width.saturating_sub(4) as usize;
        let wrapped = wrap_text(result, width);
        for line in wrapped.iter().skip(panel.result_scroll).take(30) {
            let style = if result.starts_with("Error:") {
                Style::new().fg(Color::Red)
            } else {
                Style::new().fg(Color::Gray)
            };
            rows.push(RtLine::from(Span::styled(format!("  {line}"), style)));
        }
    }
    f.render_widget(
        Paragraph::new(rows)
            .block(
                Block::new()
                    .borders(Borders::ALL)
                    .title(Span::styled(" test ", Style::new().fg(Color::Cyan))),
            )
            .wrap(Wrap { trim: false }),
        cols[1],
    );
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
        kv("mode", &app.imode.label()),
        kv("provider", &s.provider),
        kv("model", &app.effective_model()),
        kv("connection", conn),
        kv(
            "local url",
            if s.local_base_url.is_empty() {
                "provider default"
            } else {
                &s.local_base_url
            },
        ),
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
        kv(
            "card",
            &app.card
                .as_ref()
                .map(|c| c.name.clone())
                .unwrap_or_else(|| "—".into()),
        ),
        kv("persona", &app.persona.name),
        kv(
            "rag",
            &if app.rag.is_empty() {
                "—".into()
            } else {
                format!(
                    "{} doc(s) · {} chunks",
                    app.rag.documents.len(),
                    app.rag.chunk_count()
                )
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
    // Interaction-mode constraints: style contract, persistence scope,
    // and the hard caps (subagents / commands) so the user can see at a
    // glance what this mode allows.
    let t = app.imode.traits();
    rows.push(RtLine::from(""));
    rows.push(kv("style", t.style.style_label()));
    rows.push(kv("persists", t.persistence.label()));
    rows.push(kv(
        "subagents",
        if t.subagents { "allowed" } else { "denied" },
    ));
    let cmds = if t.commands.is_empty() {
        "—".to_string()
    } else {
        t.commands.join(" ")
    };
    rows.push(kv("commands", &cmds));

    // The live session: mode blend, effective capabilities, permission
    // policy. These are what the session can actually do, which is not
    // the same as what a single mode would grant.
    rows.push(RtLine::from(""));
    rows.push(kv("mix", &app.mix_summary()));
    let caps: Vec<String> = prism_core::modes::Feature::all()
        .iter()
        .map(|f| {
            format!(
                "{}{}",
                if app.session.feature(*f) { "+" } else { "-" },
                f.id()
            )
        })
        .collect();
    rows.push(kv("caps", &caps.join(" ")));
    let perms = app.session.capability.permission_rows();
    let perm_text = if perms.is_empty() {
        "no tools".to_string()
    } else {
        perms
            .iter()
            .map(|(t, p)| format!("{}={}", t, p.label()))
            .collect::<Vec<_>>()
            .join(" ")
    };
    rows.push(kv("perms", &perm_text));
    rows.push(RtLine::from(""));
    rows.push(kv(
        "plugins",
        &format!("{} active", app.plugins.ids().len()),
    ));
    let pstatus = app.plugins.status(
        &*prism_core::host::storage(),
        prism_core::host::config_dir().as_deref(),
    );
    if !pstatus.is_empty() {
        rows.push(kv("pluginext", &pstatus));
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
        "/help · /mode to switch (Alt+M cycles)"
    } else {
        "Enter send · Esc stop · Ctrl+F search"
    };
    let title = if app.is_streaming() {
        format!(" {} streaming — Esc stops ", app.spinner_char())
    } else {
        format!(" {} · composer ", app.imode.label())
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
        Mode::Mcp => "MCP · ",
        Mode::Research => "RESEARCH · ",
    };
    let im = app.imode;
    let t = im.traits();
    // Show the blend when there is one: "Chat + Agent" is a different
    // contract from "Chat" and the user must be able to see which.
    let badge = if app.session.mixed.is_empty() {
        format!("{} · {} · ", im.label(), t.style.style_label())
    } else {
        format!(
            "{} · {} · ",
            app.mix_summary(),
            app.session.active_traits().style.style_label()
        )
    };
    let line = RtLine::from(vec![
        Span::styled(format!(" {mode}"), Style::new().fg(Color::Magenta)),
        Span::styled(badge, Style::new().fg(Color::Cyan)),
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
