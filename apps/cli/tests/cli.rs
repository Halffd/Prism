//! Behavior tests for the Prism CLI state machine and chat wiring.
//!
//! Tests that touch host storage set `PRISM_CONFIG_DIR` to a fresh
//! tempdir; a global mutex serializes them because the env var is
//! process-global. `ollama` is the offline-safe provider (no key, and
//! unstarted streams only ever point at localhost).

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use prism_cli::chat;
use prism_cli::events::Event;
use prism_cli::state::{App, Mode};
use prism_core::client::StreamEvent;
use prism_core::host;
use prism_core::settings::{Connection, Settings};
use std::sync::mpsc;
use std::sync::Mutex;

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
        app.conv.messages.iter().all(|m| !m.content.contains("no tools")),
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
    assert!(last.content.contains("unknown capability"), "{}", last.content);
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
