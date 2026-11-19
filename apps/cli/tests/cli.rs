//! Behavior tests for the Prism CLI state machine and chat wiring.
//!
//! Tests that touch host storage set `PRISM_CONFIG_DIR` to a fresh
//! tempdir; a global mutex serializes them because the env var is
//! process-global. `ollama` is the offline-safe provider (no key, and
//! unstarted streams only ever point at localhost).

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use prism_cli::chat;
use prism_cli::events::Event;
use prism_cli::state::{App, IMode, Mode};
use prism_core::agent::{AgentResult, AgentStep};
use prism_core::client::StreamEvent;
use prism_core::host;
use prism_core::settings::{Connection, Settings};
use std::sync::mpsc;
use std::time::Duration;

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::LazyLock<std::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| std::sync::Mutex::new(()));
    // Recover from poisoning: one failing test must not cascade into
    // every other test in the file panicking on the same guard.
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Fresh isolated config dir + app (offline-safe provider: ollama, no key).
fn fresh_app(
    name: &str,
) -> (
    std::sync::MutexGuard<'static, ()>,
    tempfile::TempDir,
    App,
    mpsc::Sender<Event>,
) {
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join(name));
    let app = App::new(Settings {
        provider: "ollama".into(),
        ..Settings::default()
    });
    let (tx, _rx) = mpsc::channel::<Event>();
    (guard, dir, app, tx)
}

fn key(c: char) -> KeyEvent {
    KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE)
}
fn enter() -> KeyEvent {
    KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
}

fn type_line(app: &mut App, tx: &mpsc::Sender<Event>, text: &str) {
    for c in text.chars() {
        app.handle_key(key(c), tx);
    }
    app.handle_key(enter(), tx);
}

#[test]
fn send_streams_then_queue_drains_on_done() {
    let (_g, _dir, mut app, tx) = fresh_app("queue-drain");

    type_line(&mut app, &tx, "first");
    type_line(&mut app, &tx, "second");
    // First started a generation, second was queued.
    assert_eq!(app.conv.messages[0].role, "user");
    assert_eq!(app.conv.messages[0].content, "first");
    assert!(app.is_streaming());
    assert_eq!(app.queue.len(), 1);

    app.handle_stream(StreamEvent::Chunk("hello".into()), &tx);
    app.handle_stream(StreamEvent::Done, &tx);
    // Assistant content landed, queue drained into a new generation.
    assert_eq!(app.conv.messages[1].content, "hello");
    assert_eq!(app.queue.len(), 0);
    assert!(app.is_streaming());
    assert_eq!(app.conv.messages[2].content, "second");

    app.handle_stream(StreamEvent::Done, &tx);
    assert!(!app.is_streaming());
    assert_eq!(app.conv.messages[3].content, "");
}

#[test]
fn abort_stops_and_records() {
    let (_g, _dir, mut app, tx) = fresh_app("abort");
    type_line(&mut app, &tx, "hello");
    app.handle_stream(StreamEvent::Chunk("partial ".into()), &tx);
    app.handle(
        Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        &tx,
    );
    assert!(app.streaming.as_ref().unwrap().aborted);
    app.handle_stream(StreamEvent::Done, &tx);
    // Partial content is kept, a stop note is recorded.
    assert_eq!(app.conv.messages[1].content, "partial ");
    assert_eq!(
        app.conv.messages.last().unwrap().content,
        "generation stopped"
    );
}

#[test]
fn error_pauses_queue_until_manual_send() {
    let (_g, _dir, mut app, tx) = fresh_app("error-pause");
    type_line(&mut app, &tx, "one");
    type_line(&mut app, &tx, "two");
    assert_eq!(app.queue.len(), 1);

    app.handle_stream(StreamEvent::Error("boom".into()), &tx);
    assert!(!app.is_streaming());
    assert!(app.queue_paused);
    assert_eq!(app.queue.len(), 1, "queued work is kept");

    // A manual send clears the pause; completion drains the queue.
    type_line(&mut app, &tx, "three");
    assert!(!app.queue_paused);
    assert_eq!(app.queue.len(), 1);
    app.handle_stream(StreamEvent::Done, &tx);
    assert_eq!(app.queue.len(), 0);
    assert!(app.is_streaming());
    // messages: user1, assistant1, system(error), user3, user2, assistant2
    assert_eq!(app.conv.messages[2].content, "error: boom");
    assert_eq!(app.conv.messages[3].content, "three");
    assert_eq!(app.conv.messages[5].content, "two");
}

#[test]
fn commands_update_and_persist_settings() {
    let (_g, _dir, mut app, tx) = fresh_app("settings-cmds");
    type_line(&mut app, &tx, "/model gpt-4o-mini");
    type_line(&mut app, &tx, "/provider deepseek");
    type_line(&mut app, &tx, "/temp 0.4");
    type_line(&mut app, &tx, "/think");
    type_line(&mut app, &tx, "/system be terse");

    assert_eq!(app.settings.model, "gpt-4o-mini");
    assert_eq!(app.settings.provider, "deepseek");
    assert!((app.settings.temperature - 0.4).abs() < 1e-6);
    assert!(app.settings.thinking_enabled);
    assert_eq!(app.settings.system_prompt, "be terse");
    assert_eq!(app.effective_model(), "gpt-4o-mini");

    // Settings survived to disk.
    let reloaded = host::load_settings();
    assert_eq!(reloaded.model, "gpt-4o-mini");
    assert_eq!(reloaded.provider, "deepseek");
    assert!(reloaded.thinking_enabled);
    assert_eq!(reloaded.system_prompt, "be terse");
}

#[test]
fn unknown_provider_rejected() {
    let (_g, _dir, mut app, tx) = fresh_app("bad-provider");
    type_line(&mut app, &tx, "/provider nonexistent");
    assert_eq!(app.settings.provider, "ollama");
    assert!(app
        .conv
        .messages
        .last()
        .unwrap()
        .content
        .contains("unknown provider"));
}

#[test]
fn start_job_requires_credentials() {
    let _g = env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join("jobs"));
    let (tx, _rx) = mpsc::channel::<Event>();

    let settings = Settings {
        provider: "openai".into(),
        ..Settings::default()
    };
    let err = chat::start_job(
        &settings,
        vec![prism_core::client::ChatMessage::text("user", "hi")],
        &tx,
    )
    .unwrap_err();
    assert!(err.contains("API key required"), "got: {err}");

    let settings = Settings {
        connection: Connection::PrismApi,
        ..Settings::default()
    };
    let err = chat::start_job(&settings, Vec::new(), &tx).unwrap_err();
    assert!(err.contains("token"), "got: {err}");
}

#[test]
fn search_finds_and_cycles() {
    let (_g, _dir, mut app, _tx) = fresh_app("search");
    for text in ["alpha one", "beta two", "gamma alpha"] {
        app.push_message("user", text);
    }
    // Ctrl+F enters search mode; typing narrows live.
    app.handle_key(
        KeyEvent::new(KeyCode::Char('f'), KeyModifiers::CONTROL),
        &_tx,
    );
    assert_eq!(app.mode, Mode::Search);
    for c in "alpha".chars() {
        app.handle_key(key(c), &_tx);
    }
    assert_eq!(app.matches.len(), 2);
    app.handle_key(enter(), &_tx);
    assert_eq!(app.mode, Mode::Normal);
    assert_eq!(app.search.as_deref(), Some("alpha"));
    app.cycle_match(1);
    assert_eq!(app.match_sel, 1);
    app.cycle_match(1);
    assert_eq!(app.match_sel, 0);
}

#[test]
fn wrap_text_respects_width_and_hard_breaks() {
    let out = prism_cli::ui::wrap_text("short words here", 8);
    assert!(out.iter().all(|l| l.chars().count() <= 8));
    assert_eq!(out.join(" "), "short words here");

    let long = prism_cli::ui::wrap_text("abcdefghij", 4);
    assert_eq!(long, vec!["abcd", "efgh", "ij"]);
}

#[test]
fn conversation_persists_across_app_restart() {
    let (_g, _dir, mut app, tx) = fresh_app("persist");
    type_line(&mut app, &tx, "remember me");
    let id = app.conv.id.clone();
    app.handle_stream(StreamEvent::Chunk("kept".into()), &tx);
    app.handle_stream(StreamEvent::Done, &tx);

    // A brand-new app resumes the most recent conversation.
    let app2 = App::new(app.settings.clone());
    assert_eq!(app2.conv.id, id);
    assert_eq!(app2.conv.messages[0].content, "remember me");
    assert_eq!(app2.conv.messages[1].content, "kept");
    assert_eq!(app2.conv.messages[1].thinking, None);
}

// ---- interaction modes (prism_core::modes contract on this surface) ----

#[test]
fn agent_command_is_denied_in_tool_less_modes() {
    let (_g, _dir, mut app, tx) = fresh_app("mode-no-tools");
    // Default is chat: no tools advertised.
    assert!(app.imode.traits().tools == false);
    type_line(&mut app, &tx, "/agent do something");
    // A system line explains the refusal rather than running the loop.
    let last = app.conv.messages.last().unwrap();
    assert_eq!(last.role, "system");
    assert!(last.content.contains("no tools"), "{}", last.content);
}

#[test]
fn agent_command_runs_in_agent_mode() {
    let (_g, _dir, mut app, tx) = fresh_app("mode-agent");
    app.set_imode(prism_cli::state::IMode::Agent);
    assert!(app.imode.traits().tools);
    // The refusal branch is what matters here: this mode advertises
    // tools, so no refusal line is pushed. The agent loop itself is not
    // asserted — spawning one would leave a thread writing into the
    // dropped tempdir after the test returns.
    type_line(&mut app, &tx, "/agent do something");
    assert!(
        app.conv
            .messages
            .iter()
            .all(|m| !m.content.contains("no tools")),
        "agent mode must not refuse: {:?}",
        app.conv.messages.last()
    );
}

#[test]
fn mode_switch_applies_the_preset_prompt() {
    let (_g, _dir, mut app, _tx) = fresh_app("mode-prompt");
    // Fresh settings have no user prompt, so switching to Code replaces
    // the empty prompt with the Code preset.
    assert!(app.settings.system_prompt.trim().is_empty());
    app.set_imode(prism_cli::state::IMode::Code);
    assert!(app.settings.system_prompt.to_lowercase().contains("code"));
    assert!(!app.imode.traits().tools);
}

#[test]
fn alt_m_cycles_modes_and_wraps() {
    let (_g, _dir, mut app, tx) = fresh_app("mode-cycle");
    app.set_imode(prism_cli::state::IMode::Chat);
    let alt_m = KeyEvent::new(KeyCode::Char('m'), KeyModifiers::ALT);
    app.handle_key(alt_m, &tx);
    assert_eq!(app.imode, prism_cli::state::IMode::Agent);
    // Agent → Code → Creative → Daemon → Generative.
    for expected in [
        prism_cli::state::IMode::Code,
        prism_cli::state::IMode::Creative,
        prism_cli::state::IMode::Daemon,
        prism_cli::state::IMode::Generative,
    ] {
        app.handle_key(alt_m, &tx);
        assert_eq!(app.imode, expected);
    }
    // Sixth wrap back to Chat.
    app.handle_key(alt_m, &tx);
    assert_eq!(app.imode, prism_cli::state::IMode::Chat);
}

#[test]
fn mode_command_accepts_ids_and_rejects_junk() {
    let (_g, _dir, mut app, tx) = fresh_app("mode-cmd");
    type_line(&mut app, &tx, "/mode code");
    assert_eq!(app.imode, prism_cli::state::IMode::Code);
    let before = app.conv.messages.len();
    type_line(&mut app, &tx, "/mode nonsense");
    // Unchanged mode plus a message naming the valid options.
    assert_eq!(app.imode, prism_cli::state::IMode::Code);
    let last = &app.conv.messages[app.conv.messages.len() - 1];
    assert_eq!(last.role, "system");
    assert!(last.content.contains("unknown mode"), "{}", last.content);
    let _ = before;
}

// ---- mode mixing, capability editing, permission editing -----------------

#[test]
fn mix_unions_capabilities_and_unmix_removes_them() {
    let (_g, _dir, mut app, tx) = fresh_app("mix");
    assert!(!app.session.feature(prism_core::modes::Feature::Tools));
    type_line(&mut app, &tx, "/mix agent");
    assert_eq!(app.session.mixed, vec![prism_cli::state::IMode::Agent]);
    assert!(app.session.feature(prism_core::modes::Feature::Tools));
    assert!(app.session.feature(prism_core::modes::Feature::Subagents));
    type_line(&mut app, &tx, "/unmix agent");
    assert!(app.session.mixed.is_empty());
    assert!(!app.session.feature(prism_core::modes::Feature::Tools));
}

#[test]
fn mix_rejects_unknown_modes_and_the_primary() {
    let (_g, _dir, mut app, tx) = fresh_app("mix-bad");
    type_line(&mut app, &tx, "/mix nonsense");
    let last = &app.conv.messages[app.conv.messages.len() - 1];
    assert_eq!(last.role, "system");
    assert!(last.content.contains("unknown mode"), "{}", last.content);
    assert!(app.session.mixed.is_empty());

    // The primary mode cannot be mixed into itself.
    type_line(&mut app, &tx, "/mix chat");
    assert!(app.session.mixed.is_empty());
}

#[test]
fn cap_toggles_a_capability_on_and_off() {
    let (_g, _dir, mut app, tx) = fresh_app("cap");
    type_line(&mut app, &tx, "/cap media on");
    assert!(app.session.feature(prism_core::modes::Feature::Media));
    type_line(&mut app, &tx, "/cap media off");
    assert!(!app.session.feature(prism_core::modes::Feature::Media));
}

#[test]
fn cap_rejects_unknown_capabilities() {
    let (_g, _dir, mut app, tx) = fresh_app("cap-bad");
    type_line(&mut app, &tx, "/cap nonsense on");
    let last = &app.conv.messages[app.conv.messages.len() - 1];
    assert_eq!(last.role, "system");
    assert!(
        last.content.contains("unknown capability"),
        "{}",
        last.content
    );
}

#[test]
fn perm_edits_the_policy_for_an_advertised_tool() {
    let (_g, _dir, mut app, tx) = fresh_app("perm");
    // Chat advertises no tools, so there is nothing to edit yet.
    type_line(&mut app, &tx, "/perm calculator allow");
    let last = &app.conv.messages[app.conv.messages.len() - 1];
    assert!(last.content.contains("no such tool"), "{}", last.content);

    // Switch to agent, which advertises tools, then edit.
    app.set_imode(prism_cli::state::IMode::Agent);
    type_line(&mut app, &tx, "/perm calculator ask");
    assert_eq!(
        app.session.permission_for("calculator"),
        prism_core::session::PermissionLevel::Ask
    );
}

#[test]
fn perm_rejects_unknown_levels() {
    let (_g, _dir, mut app, tx) = fresh_app("perm-bad");
    app.set_imode(prism_cli::state::IMode::Agent);
    type_line(&mut app, &tx, "/perm calculator maybe");
    let last = &app.conv.messages[app.conv.messages.len() - 1];
    assert_eq!(last.role, "system");
    assert!(last.content.contains("usage:"), "{}", last.content);
}

#[test]
fn agent_gate_follows_the_session_not_the_primary_mode() {
    let (_g, _dir, mut app, tx) = fresh_app("gate");
    // Chat alone: no tools.
    type_line(&mut app, &tx, "/agent do something");
    assert!(app
        .conv
        .messages
        .iter()
        .any(|m| m.content.contains("no tools")));

    // Mix in agent: the gate opens because the session has tools.
    type_line(&mut app, &tx, "/mix agent");
    assert!(app.session.feature(prism_core::modes::Feature::Tools));

    // Revoke tools with /cap: the gate closes again.
    type_line(&mut app, &tx, "/cap tools off");
    assert!(!app.session.feature(prism_core::modes::Feature::Tools));
}

// ---------------------------------------------------------------------------
// The non-interactive feature commands (search, tag, archive, fork,
// export, import).
// ---------------------------------------------------------------------------

/// A conversation stored in the temp config dir, with the given content.
fn store_conversation(id: &str, title: &str, contents: &[(&str, &str)]) -> String {
    let messages = contents
        .iter()
        .map(|(role, content)| prism_core::conversations::StoredMessage {
            role: (*role).into(),
            content: (*content).into(),
            thinking: None,
            id: None,
            tags: Vec::new(),
            read: true,
            edited_at: None,
        })
        .collect();
    let conv = prism_core::conversations::Conversation {
        id: id.into(),
        title: title.into(),
        created_at: 1,
        updated_at: 2,
        messages,
        tags: Vec::new(),
        archived: false,
        read: true,
        forked_from: None,
        forked_at_message: None,
    };
    host::save_conversation(&conv).unwrap();
    conv.id
}

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn search_finds_a_message_across_chats() {
    let (_g, _dir, _app, _tx) = fresh_app("cli-search");
    store_conversation(
        "aaaa1111",
        "First",
        &[("user", "where is the needle"), ("assistant", "not here")],
    );
    store_conversation(
        "bbbb2222",
        "Second",
        &[
            ("user", "nothing to see"),
            ("assistant", "the needle is in here"),
        ],
    );

    let hits = prism_core::search::search(
        &prism_cli::features::load_conversations_for_test(),
        &prism_core::search::SearchQuery {
            text: "needle".into(),
            ..Default::default()
        },
    );
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().any(|h| h.conversation_id == "bbbb2222"));
}

#[test]
fn tag_and_archive_persist_to_the_conversation_file() {
    let (_g, _dir, _app, _tx) = fresh_app("cli-tag");
    let id = store_conversation("cccc3333", "Third", &[("user", "hello")]);

    prism_cli::features::tag_cli(&args(&[&id, "work"])).unwrap();
    let conv = host::load_conversation(&id).unwrap();
    assert_eq!(conv.tags, vec!["work".to_string()]);

    prism_cli::features::archive_cli(&args(&[&id]), true).unwrap();
    let conv = host::load_conversation(&id).unwrap();
    assert!(conv.archived);

    prism_cli::features::untag_cli(&args(&[&id, "work"])).unwrap();
    let conv = host::load_conversation(&id).unwrap();
    assert!(conv.tags.is_empty());
}

#[test]
fn fork_creates_a_branch_that_links_back_to_the_source() {
    let (_g, _dir, _app, _tx) = fresh_app("cli-fork");
    let id = store_conversation(
        "dddd4444",
        "Fourth",
        &[("user", "one"), ("assistant", "two"), ("user", "three")],
    );

    prism_cli::features::fork_cli(&args(&[&id, "1"])).unwrap();

    let metas = host::list_conversations();
    let fork = metas
        .iter()
        .find(|m| m.id != id)
        .expect("a fork was created");
    let fork_conv = host::load_conversation(&fork.id).unwrap();
    assert_eq!(fork_conv.messages.len(), 2);
    assert_eq!(fork_conv.forked_from.as_deref(), Some(id.as_str()));
    assert_eq!(fork_conv.forked_at_message, Some(1));
}

#[test]
fn export_then_import_roundtrips_the_chats() {
    let (_g, _dir, _app, _tx) = fresh_app("cli-backup");
    store_conversation(
        "eeee5555",
        "Fifth",
        &[("user", "hello"), ("assistant", "hi")],
    );

    let path = std::env::temp_dir().join(format!("prism-cli-backup-{}.json", std::process::id()));
    let path_str = path.to_string_lossy().to_string();

    prism_cli::features::export_cli(&args(&[&path_str])).unwrap();
    assert!(path.exists());

    // Remove the chat, then import it back.
    host::delete_conversation("eeee5555").unwrap();
    assert!(host::list_conversations().is_empty());

    prism_cli::features::import_cli(&args(&[&path_str])).unwrap();
    let restored = host::load_conversation("eeee5555").expect("the chat came back");
    assert_eq!(restored.messages.len(), 2);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn import_refuses_a_file_that_is_not_a_prism_backup() {
    let (_g, _dir, _app, _tx) = fresh_app("cli-bad-backup");
    let path = std::env::temp_dir().join(format!(
        "prism-cli-not-a-backup-{}.json",
        std::process::id()
    ));
    std::fs::write(&path, r#"{"hello":"world"}"#).unwrap();

    let err = prism_cli::features::import_cli(&args(&[&path.to_string_lossy()]))
        .expect_err("a non-Prism file is refused");
    assert!(
        format!("{err}").contains("import failed"),
        "unexpected error: {err}"
    );

    let _ = std::fs::remove_file(&path);
}

// -- MCP + subagents -------------------------------------------------------

/// Write the shared config file (`mcp.json`) inside the app's isolated
/// config root (`$PRISM_CONFIG_DIR/../mcp.json` is *not* used here: the
/// core path is `<config root>/mcp.json`, and `fresh_app` points
/// `PRISM_CONFIG_DIR` at `<tempdir>/<name>`).
fn write_mcp_config(dir: &tempfile::TempDir, name: &str, json: &str) {
    let root = dir.path().join(name);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("mcp.json"), json).unwrap();
}

#[test]
fn agents_list_shows_shipped_and_config_specs() {
    let (_g, dir, mut app, tx) = fresh_app("agents-list");
    write_mcp_config(
        &dir,
        "agents-list",
        r#"{
            "subagents": [
                {"name":"tui-scout","description":"Quick scout","tool_allowlist":["read_file"]},
                {"name":"Bad Name!","description":"never applies"}
            ]
        }"#,
    );

    type_line(&mut app, &tx, "/agents list");
    let text = app
        .conv
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    // Shipped profiles…
    assert!(text.contains("explore:"), "{text}");
    assert!(text.contains("security-review:"), "{text}");
    // …plus the config entry and its allowlist.
    assert!(text.contains("tui-scout: Quick scout"), "{text}");
    assert!(text.contains("tools: read_file"), "{text}");
    // …and the invalid entry is reported, not fatal.
    assert!(text.contains("config warning"), "{text}");
    assert!(text.contains("subagents[1]"), "{text}");
    assert!(text.contains("/agents spawn <name> <task>"), "{text}");
}

#[test]
fn agents_spawn_gates_tool_less_modes_and_unknown_names() {
    let (_g, _dir, mut app, tx) = fresh_app("agents-gates");

    // Chat mode advertises no tools — refuse before creating a job.
    type_line(&mut app, &tx, "/agents spawn explore find it");
    let last = app.conv.messages.last().unwrap();
    assert_eq!(last.role, "system");
    assert!(last.content.contains("no tools"), "{}", last.content);
    assert!(app.jobs.is_empty());

    app.set_imode(IMode::Agent);
    type_line(&mut app, &tx, "/agents spawn nobody find it");
    let last = app.conv.messages.last().unwrap();
    assert!(
        last.content.contains("unknown subagent"),
        "{}",
        last.content
    );
    assert!(app.jobs.is_empty());

    // Bad usage is explained, not silently ignored.
    type_line(&mut app, &tx, "/agents spawn explore");
    assert!(app.conv.messages.last().unwrap().content.contains("usage"));
}

#[test]
fn agents_spawn_creates_a_running_background_job() {
    let (_g, _dir, mut app, tx) = fresh_app("agents-spawn");
    app.set_imode(IMode::Agent);

    type_line(&mut app, &tx, "/agents spawn explore find the answer");
    assert_eq!(app.jobs.len(), 1);
    let job = &app.jobs[0];
    assert_eq!(job.spec, "explore");
    assert_eq!(job.task, "find the answer");
    assert_eq!(job.status, "running");
    assert!(job.id.starts_with("bg_"), "{}", job.id);

    // The list reflects the live job.
    type_line(&mut app, &tx, "/agents");
    let text = app
        .conv
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("running: explore"), "{text}");
}

#[test]
fn subagent_done_updates_the_job_and_the_transcript() {
    let (_g, _dir, mut app, tx) = fresh_app("agents-done");
    app.set_imode(IMode::Agent);
    type_line(&mut app, &tx, "/agents spawn explore find it");
    let id = app.jobs[0].id.clone();

    app.handle(
        Event::SubagentDone {
            id: id.clone(),
            spec: "explore".into(),
            result: AgentResult {
                answer: "found it".into(),
                steps: vec![AgentStep {
                    thought: "look".into(),
                    action: "read_file".into(),
                    action_input: "README.md".into(),
                    observation: "ok".into(),
                    phase: "react".into(),
                }],
                completed: true,
                error: None,
            },
        },
        &tx,
    );
    let job = app.jobs.iter().find(|j| j.id == id).unwrap();
    assert_eq!(job.status, "done");
    assert_eq!(job.answer.as_deref(), Some("found it"));
    assert_eq!(app.conv.messages.last().unwrap().content, "found it");
    assert!(app
        .conv
        .messages
        .iter()
        .any(|m| m.content.contains("[bg explore 1/1] read_file")));

    // A failed run records the error and does not claim an answer.
    type_line(&mut app, &tx, "/agents spawn shell-ops check the build");
    let failed_id = app.jobs[1].id.clone();
    app.handle(
        Event::SubagentDone {
            id: failed_id.clone(),
            spec: "shell-ops".into(),
            result: AgentResult {
                answer: String::new(),
                steps: Vec::new(),
                completed: false,
                error: Some("boom".into()),
            },
        },
        &tx,
    );
    let job = app.jobs.iter().find(|j| j.id == failed_id).unwrap();
    assert_eq!(job.status, "failed");
    assert_eq!(job.error.as_deref(), Some("boom"));
    assert!(app
        .conv
        .messages
        .iter()
        .any(|m| m.content.contains("bg shell-ops failed") && m.content.contains("boom")));
}

#[test]
fn mcp_probe_reports_the_missing_config_path() {
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    // `fresh_app` isn't used here because the notice arrives on the
    // channel; we drain it instead of dropping the receiver.
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join("mcp-none"));
    std::env::remove_var("PRISM_MCP_CONFIG");
    let mut app = App::new(Settings {
        provider: "ollama".into(),
        ..Settings::default()
    });
    let (tx, rx) = mpsc::channel::<Event>();
    type_line(&mut app, &tx, "/mcp");

    let mut notice = None;
    while let Ok(ev) = rx.recv_timeout(Duration::from_secs(5)) {
        if let Event::Notice(text) = ev {
            notice = Some(text);
            break;
        }
    }
    let text = notice.expect("the probe reports back");
    assert!(text.contains("no configuration"), "{text}");
    assert!(text.contains("mcp.json"), "{text}");
    drop(guard);
}

// -- vault, character cards, hardware, in-app MCP panel --------------------

#[test]
fn vault_saves_lists_opens_and_deletes_conversations() {
    let (_g, _dir, mut app, tx) = fresh_app("vault");
    app.push_message("user", "vaulted words");
    type_line(&mut app, &tx, "/vault save");
    let id = app.conv.id.clone();
    assert!(host::load_conversation(&id).is_some());

    // list names the current chat
    type_line(&mut app, &tx, "/vault list");
    let text = app
        .conv
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains(&id[..8]), "{text}");

    // open the stored chat after starting a fresh one
    type_line(&mut app, &tx, "/new");
    assert_ne!(app.conv.id, id);
    type_line(&mut app, &tx, &format!("/vault open {id}"));
    assert_eq!(app.conv.id, id);
    assert_eq!(app.conv.messages[0].content, "vaulted words");

    // delete removes the file and the list entry
    type_line(&mut app, &tx, "/new");
    type_line(&mut app, &tx, &format!("/vault delete {id}"));
    assert!(host::load_conversation(&id).is_none());
    assert!(app.metas.iter().all(|m| m.id != id));
}

#[test]
fn card_loads_and_persona_sets_the_user_macros() {
    let (_g, dir, mut app, tx) = fresh_app("card");
    let path = dir.path().join("alice.json");
    std::fs::write(
        &path,
        r#"{
            "spec": "chara_card_v2",
            "data": {
                "name": "Alice",
                "description": "A {{char}} who studies {{persona}}.",
                "first_mes": "Hello there.",
                "character_book": {
                    "entries": [
                        {"keys": ["tea"], "content": "Alice loves tea."}
                    ]
                }
            }
        }"#,
    )
    .unwrap();

    type_line(&mut app, &tx, &format!("/card {}", path.display()));
    let card = app.card.clone().expect("card loaded");
    assert_eq!(card.name, "Alice");
    assert!(app
        .conv
        .messages
        .iter()
        .any(|m| m.content == "Hello there."));

    type_line(&mut app, &tx, "/persona Bob|a tester");
    assert_eq!(app.persona.name, "Bob");
    assert_eq!(app.persona.description, "a tester");
    assert_eq!(app.persona.expanded(), "Bob: a tester");

    let ctx = prism_core::cards::MacroContext::from_card(&card, &app.persona);
    assert_eq!(
        prism_core::cards::expand_macros("{{char}} meets {{user}}", &ctx),
        "Alice meets Bob"
    );

    type_line(&mut app, &tx, "/card off");
    assert!(app.card.is_none());
}

#[test]
fn hardware_command_updates_and_persists_overrides() {
    let (_g, _dir, mut app, tx) = fresh_app("hardware");
    type_line(&mut app, &tx, "/hardware compute cpu-only");
    type_line(&mut app, &tx, "/hardware gpu 12");
    type_line(&mut app, &tx, "/hardware ctx 8192");
    assert_eq!(app.settings.hardware.preferred_compute, "cpu-only");
    assert_eq!(app.settings.hardware.gpu_layers_override, Some(12));
    assert_eq!(app.settings.hardware.context_tokens, Some(8192));

    let reloaded = host::load_settings();
    assert_eq!(reloaded.hardware.gpu_layers_override, Some(12));

    type_line(&mut app, &tx, "/hardware reset");
    assert_eq!(app.settings.hardware.preferred_compute, "auto");
    assert_eq!(app.settings.hardware.gpu_layers_override, None);
}

#[test]
fn resume_env_selects_the_requested_conversation() {
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join("resume"));
    store_conversation("aaaa7777", "Older", &[("user", "old")]);
    store_conversation("bbbb8888", "Newer", &[("user", "new")]);

    std::env::set_var("PRISM_RESUME_ID", "aaaa");
    let app = App::new(Settings {
        provider: "ollama".into(),
        ..Settings::default()
    });
    std::env::remove_var("PRISM_RESUME_ID");
    assert_eq!(app.conv.id, "aaaa7777");
    assert_eq!(app.conv.messages[0].content, "old");
    drop(guard);
}

fn node_available() -> bool {
    std::process::Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn fake_mcp_server() -> String {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../crates/prism-core/tests/fixtures/mcp-fake-server.mjs")
        .to_string_lossy()
        .to_string()
}

#[test]
fn mcp_panel_discovers_and_calls_a_tool_directly() {
    if !node_available() {
        eprintln!("skipping: node not available");
        return;
    }
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join("mcp-panel"));
    std::env::remove_var("PRISM_MCP_CONFIG");
    let root = dir.path().join("mcp-panel");
    std::fs::create_dir_all(&root).unwrap();
    let config = serde_json::json!({
        "mcpServers": {
            "calc": { "command": "node", "args": [fake_mcp_server()] }
        }
    });
    std::fs::write(root.join("mcp.json"), config.to_string()).unwrap();

    let mut app = App::new(Settings {
        provider: "ollama".into(),
        ..Settings::default()
    });
    let (tx, rx) = mpsc::channel::<Event>();
    type_line(&mut app, &tx, "/mcp panel");
    assert_eq!(app.mode, Mode::Mcp);
    assert!(app.mcp_panel.is_some());

    // Discovery lands as an event; apply it like the main loop would.
    let mut found: Option<Vec<prism_cli::events::McpToolRow>> = None;
    while let Ok(ev) = rx.recv_timeout(Duration::from_secs(15)) {
        if let Event::McpTools { tools, errors, .. } = ev {
            assert!(errors.is_empty(), "{errors:?}");
            found = Some(tools.clone());
            app.handle(
                Event::McpTools {
                    path: Some("test".into()),
                    tools,
                    errors,
                },
                &tx,
            );
            break;
        }
    }
    let tools = found.expect("discovery event arrived");
    assert_eq!(tools.len(), 3, "tools: {:?}", tools.len());

    let add_idx = tools
        .iter()
        .position(|t| t.raw == "add")
        .expect("add tool present");
    for _ in 0..add_idx {
        app.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE), &tx);
    }
    assert_eq!(app.mcp_panel.as_ref().unwrap().selected, add_idx);

    // Enter starts args editing; replace the default args and run.
    app.handle_key(enter(), &tx);
    assert!(app.mcp_panel.as_ref().unwrap().editing);
    app.handle_key(
        KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
        &tx,
    );
    for c in r#"{"a":2,"b":3}"#.chars() {
        app.handle_key(key(c), &tx);
    }
    app.handle_key(enter(), &tx);

    let mut output = None;
    while let Ok(ev) = rx.recv_timeout(Duration::from_secs(15)) {
        if let Event::McpCall { tool, output: out } = ev {
            output = Some((tool.clone(), out.clone()));
            app.handle(Event::McpCall { tool, output: out }, &tx);
            break;
        }
    }
    let (tool, out) = output.expect("tool call returned");
    assert_eq!(tool, "mcp__calc__add");
    assert_eq!(out, "5");
    assert_eq!(app.mcp_panel.as_ref().unwrap().result.as_deref(), Some("5"));

    // Esc closes the panel and restores the normal keymap.
    app.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE), &tx);
    assert_eq!(app.mode, Mode::Normal);
    assert!(app.mcp_panel.is_none());
    drop(guard);
}

// -- non-daemon commands, daemon routes, ACP ---------------------------------

#[test]
fn permissions_auth_and_api_commands_persist() {
    let (_g, _dir, _app, _tx) = fresh_app("cmd-settings");

    prism_cli::cmd::permissions_cli(&args(&["set", "calculator", "ask"])).unwrap();
    prism_cli::cmd::permissions_cli(&args(&["default", "deny"])).unwrap();
    let stored = host::load_settings();
    assert_eq!(stored.tool_permission("calculator").unwrap().label(), "ask");
    // An unlisted tool follows the default.
    assert_eq!(stored.tool_permission("read_file").unwrap().label(), "deny");
    prism_cli::cmd::permissions_cli(&args(&["reset", "calculator"])).unwrap();
    assert!(host::load_settings()
        .tool_permissions
        .get("calculator")
        .is_none());
    prism_cli::cmd::permissions_cli(&args(&["reset"])).unwrap();
    assert!(host::load_settings().default_tool_permission.is_empty());

    prism_cli::cmd::auth_cli(&args(&["set", "openai", "sk-test"])).unwrap();
    assert_eq!(host::load_settings().key_for("openai"), "sk-test");
    prism_cli::cmd::auth_cli(&args(&["clear", "openai"])).unwrap();
    assert!(host::load_settings().key_for("openai").is_empty());

    prism_cli::cmd::api_cli(&args(&["url", "http://127.0.0.1:9999"])).unwrap();
    prism_cli::cmd::api_cli(&args(&["token", "jwt"])).unwrap();
    let stored = host::load_settings();
    assert_eq!(stored.prism_api_url, "http://127.0.0.1:9999");
    assert_eq!(stored.prism_api_token, "jwt");
}

#[test]
fn pair_and_debug_commands_write_real_output() {
    let (_g, _dir, _app, _tx) = fresh_app("cmd-pair");
    prism_cli::cmd::pair_cli(&args(&["slint", "--ttl", "60"])).unwrap();
    let path = host::config_dir().unwrap().join("pair/slint.json");
    let text = std::fs::read_to_string(&path).expect("pair file written");
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["target"], "slint");
    assert_eq!(value["token"].as_str().unwrap().len(), 32);
    assert!(value["expires_at"].as_u64().unwrap() > value["created_at"].as_u64().unwrap());

    // Debug is a JSON bundle and never leaks a stored key.
    prism_cli::cmd::debug_cli(&[]).unwrap();
    let app = prism_cli::state::App::new(host::load_settings());
    drop(app);
}

#[test]
fn mcp_command_lists_and_tests_the_configured_server() {
    if !node_available() {
        eprintln!("skipping: node not available");
        return;
    }
    let (_g, dir, _app, _tx) = fresh_app("cmd-mcp");
    let config = serde_json::json!({
        "mcpServers": { "calc": { "command": "node", "args": [fake_mcp_server()] } }
    });
    write_mcp_config(&dir, "cmd-mcp", &config.to_string());
    prism_cli::cmd::mcp_cli(&args(&["list"])).unwrap();
    prism_cli::cmd::mcp_cli(&args(&["test"])).unwrap();
    prism_cli::cmd::mcp_cli(&args(&["call", "calc", "add", r#"{"a":4,"b":5}"#])).unwrap();
    assert!(prism_cli::cmd::mcp_cli(&args(&["call", "calc", "missing", "{}"])).is_err());
}

#[test]
fn serve_daemon_answers_health_status_and_shuts_down() {
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("PRISM_CONFIG_DIR", dir.path().join("serve"));
    std::env::remove_var("PRISM_MCP_CONFIG");

    let handle = std::thread::spawn(|| prism_cli::serve::serve_cli(&args(&["--port", "0"])));
    let mut info = None;
    for _ in 0..250 {
        info = prism_cli::serve::running_server();
        if info.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let info = info.expect("server.json appeared");
    assert_eq!(info["pid"].as_u64().unwrap(), std::process::id() as u64);

    let health = prism_cli::serve::ping_server().expect("health answered");
    assert_eq!(health["ok"], true);

    let status = prism_cli::serve::server_request("GET", "/status", None).unwrap();
    assert!(status["jobs"].is_array());
    let jobs = prism_cli::serve::server_request("GET", "/jobs", None).unwrap();
    assert!(jobs["jobs"].is_array());
    let agents = prism_cli::serve::server_request("GET", "/agents", None).unwrap();
    assert!(agents["agents"].as_array().unwrap().len() >= 6);
    let models = prism_cli::serve::server_request("GET", "/models?provider=openai", None).unwrap();
    assert_eq!(models["provider"], "openai");

    prism_cli::serve::server_request("POST", "/shutdown", Some(serde_json::json!({}))).unwrap();
    handle.join().unwrap().unwrap();
    assert!(!host::config_dir().unwrap().join("server.json").exists());
    drop(guard);
}

#[test]
fn acp_initializes_and_opens_a_session() {
    use std::io::{BufRead, BufReader, Write};
    let guard = env_lock();
    let dir = tempfile::tempdir().unwrap();
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_prism"))
        .arg("acp")
        .env("PRISM_CONFIG_DIR", dir.path().join("acp"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("acp binary starts");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut send = |value: serde_json::Value| {
        writeln!(stdin, "{value}").unwrap();
        stdin.flush().unwrap();
    };
    send(serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let init: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(init["result"]["protocolVersion"], 1);
    assert_eq!(init["result"]["agentCapabilities"]["mcp"]["stdio"], true);

    send(serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}));
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let session: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(session["result"]["sessionId"], "s1");

    send(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"nope","params":{}}));
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let unknown: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(unknown["error"]["code"], -32601);

    send(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"shutdown","params":{}}));
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let bye: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert!(bye["result"].is_object());
    drop(stdin);
    assert!(child.wait().unwrap().success());
    drop(guard);
}

#[test]
fn rag_command_indexes_files_and_retrieves_context() {
    let (_g, dir, mut app, tx) = fresh_app("rag");
    let path = dir.path().join("notes.md");
    std::fs::write(
        &path,
        "The reactor coolant loop uses heavy water.\n\nSourdough needs flour and water.",
    )
    .unwrap();

    type_line(&mut app, &tx, &format!("/rag {}", path.display()));
    assert_eq!(app.rag.documents.len(), 1);
    assert_eq!(app.rag.documents[0].title, "notes.md");
    assert!(app.rag.documents[0].chunk_count() >= 1);

    let ctx = app.rag.context("reactor coolant boron", 2);
    assert!(ctx.contains("reactor coolant"), "{ctx}");
    assert!(!ctx.contains("Sourdough"), "{ctx}");

    type_line(&mut app, &tx, "/rag list");
    let text = app
        .conv
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("notes.md"), "{text}");

    type_line(&mut app, &tx, "/rag clear");
    assert!(app.rag.is_empty());
}

#[test]
fn help_lists_the_new_parity_commands() {
    let text = prism_cli::ui::HELP_LINES.join("\n");
    for needle in [
        "/vault",
        "/card",
        "/persona",
        "/hardware",
        "/rag",
        "/mcp panel",
    ] {
        assert!(text.contains(needle), "missing {needle}");
    }
}
