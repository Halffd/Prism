//! Prism CLI — native terminal harness over `prism-core`.
//!
//! Event-driven: input threads and chat jobs push `Event`s; the main
//! loop applies them to one `App` and redraws. State (conversations,
//! settings) lives on disk through the core's storage, so a restart
//! resumes the most recent chat.

use anyhow::Context;
use prism_cli::acp;
use prism_cli::cmd;
use prism_cli::events::{self, Event};
use prism_cli::serve;
use prism_cli::state::App;
use prism_cli::ui;
use std::io::stdout;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

struct TerminalGuard;
impl TerminalGuard {
    fn new() -> anyhow::Result<Self> {
        crossterm::terminal::enable_raw_mode().context("enable raw mode")?;
        crossterm::execute!(
            stdout(),
            crossterm::terminal::EnterAlternateScreen,
            crossterm::event::EnableMouseCapture
        )
        .context("enter alternate screen")?;
        Ok(TerminalGuard)
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = crossterm::execute!(
            stdout(),
            crossterm::event::DisableMouseCapture,
            crossterm::terminal::LeaveAlternateScreen
        );
        let _ = crossterm::terminal::disable_raw_mode();
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(arg) = args.get(1) {
        let rest = &args[2..];
        match arg.as_str() {
            "--version" | "-V" => {
                println!("prism {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            "resume" => {
                if let Some(id) = cmd::resume_cli(rest)? {
                    std::env::set_var("PRISM_RESUME_ID", id);
                } else {
                    return Ok(());
                }
            }
            "chats" => return prism_cli::features::chats_cli(rest),
            "sessions" => return cmd::sessions_cli(rest),
            "search" => return prism_cli::features::search_cli(rest),
            "tag" => return prism_cli::features::tag_cli(rest),
            "untag" => return prism_cli::features::untag_cli(rest),
            "archive" => return prism_cli::features::archive_cli(rest, true),
            "unarchive" => return prism_cli::features::archive_cli(rest, false),
            "read" => return prism_cli::features::read_cli(rest, true),
            "unread" => return prism_cli::features::read_cli(rest, false),
            "fork" => return prism_cli::features::fork_cli(rest),
            "export" => return prism_cli::features::export_cli(rest),
            "import" => return prism_cli::features::import_cli(rest),
            "models" => return cmd::models_cli(rest),
            "send" => return cmd::send_cli(rest),
            "run" => return cmd::run_cli(rest),
            "status" => return cmd::status_cli(rest),
            "agents" => return cmd::agents_cli(rest),
            "permissions" => return cmd::permissions_cli(rest),
            "mcp" => return cmd::mcp_cli(rest),
            "debug" => return cmd::debug_cli(rest),
            "reload" => return cmd::reload_cli(rest),
            "auth" => return cmd::auth_cli(rest),
            "pair" => return cmd::pair_cli(rest),
            "api" => return cmd::api_cli(rest),
            "ping" => return cmd::ping_cli(rest),
            "update" => return cmd::update_cli(rest),
            "uninstall" => return cmd::uninstall_cli(rest),
            "stop" => return serve::stop_cli(rest),
            "stop-all" => return serve::stop_all_cli(rest),
            "serve" => return serve::serve_cli(rest),
            "acp" => return acp::acp_cli(rest),
            "tui" | "ui" => {}
            "sandbox" => return sandbox_cli(std::env::args().skip(2)),
            other => anyhow::bail!("unknown argument: {other} (see prism --help)"),
        }
    }

    run_tui()
}

fn run_tui() -> anyhow::Result<()> {
    let settings = prism_core::host::load_settings();
    let mut app = App::new(settings);
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    events::spawn_input(tx.clone());

    let _guard = TerminalGuard::new();
    let mut terminal = ratatui::init();
    let res = run_loop(&mut terminal, &mut app, &rx, &tx);
    ratatui::restore();
    drop(_guard);

    // Persist whatever happened before exiting.
    app.save();
    res
}

fn print_help() {
    println!("prism — native terminal harness and local agent daemon");
    println!("usage: prism [command] [flags]");
    println!();
    println!("  (no command) | tui | ui       open the terminal UI");
    println!("  resume [id] [--json]          open the most recent (or named) chat");
    println!("  sessions [--limit N] [--json] list stored sessions");
    println!("  chats                         list stored chats");
    println!("  search [QUERY] [flags]        search every chat (--regex --role --tag --limit …)");
    println!("  tag/untag/archive/read …      conversation management");
    println!("  fork/export/import …          branch and back up chats");
    println!("  models [--provider id] [--fetch] [--json]");
    println!("  send <prompt> [--provider id] [--model id] [--system text] [--json]");
    println!("  run <task> [--json]           one agent run (tools + MCP)");
    println!("  agents [list|show <name>|run <name> <task>] [--json]");
    println!("  permissions [list|tools|set <tool> <level>|default <level>|reset [tool]]");
    println!("  mcp [list|tools|test|call <server> <tool> [json]]");
    println!("  auth [list|set <provider> <key>|clear <provider>|env]");
    println!("  api [status|url <url>|token <token>]");
    println!("  status [--json]               local state + daemon status");
    println!("  ping [--json]                 daemon, else provider reachability");
    println!("  serve [--port N] [--host H] [--token T|--token-file F]");
    println!("  stop <job-id> | stop-all      daemon jobs");
    println!("  reload                        re-read settings/MCP config");
    println!("  pair <browser|slint|remote> [--ttl seconds] [--json]");
    println!("  debug [--json]                redacted diagnostics");
    println!("  update [--check] [--yes]      reinstall from this checkout");
    println!("  uninstall [--yes] [--purge]   remove the cargo install (and config)");
    println!("  sandbox preflight [--policy FILE] [--json]");
    println!();
    println!("env: PRISM_CONFIG_DIR, PRISM_CONVERSATIONS_DIR, PRISM_MCP_CONFIG,");
    println!("     PRISM_AGENT_SANDBOX_POLICY (policy JSON or path)");
}

fn run_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    rx: &Receiver<Event>,
    tx: &Sender<Event>,
) -> anyhow::Result<()> {
    let mut tick: u64 = 0;
    loop {
        terminal
            .draw(|f| ui::draw(f, app))
            .context("terminal draw")?;
        match rx.recv_timeout(Duration::from_millis(events::TICK_MILLIS)) {
            Ok(ev) => app.handle(ev, tx),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                tick += 1;
                app.handle(Event::Tick(tick), tx);
            }
            // Every sender is gone: the app cannot receive anything anymore.
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
        }
        if app.quit {
            return Ok(());
        }
    }
}

/// `prism sandbox preflight [--policy FILE] [--json]` — probe the host
/// and (with a policy) report how a spawn would be planned, mirroring
/// the zugferd helper's `--preflight-only` exit contract:
/// exit 0 supported, 2 unsupported.
fn sandbox_cli(mut args: impl Iterator<Item = String>) -> anyhow::Result<()> {
    let sub = args.next().unwrap_or_else(|| "preflight".into());
    if sub != "preflight" {
        anyhow::bail!(
            "unknown sandbox subcommand: {sub} (usage: prism sandbox preflight [--policy FILE] [--json])"
        );
    }
    let mut policy_file: Option<String> = None;
    let mut as_json = false;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--policy" => {
                policy_file = Some(
                    args.next()
                        .context("--policy needs a policy JSON file path")?,
                )
            }
            "--json" => as_json = true,
            other => anyhow::bail!("unknown flag: {other}"),
        }
    }

    let report = prism_core::sandbox::preflight();
    if as_json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "landlock: {}{}",
            if report.landlock_supported {
                "supported"
            } else {
                "UNSUPPORTED"
            },
            report
                .landlock_abi
                .map(|abi| format!(" (abi v{abi})"))
                .unwrap_or_default()
        );
        for note in &report.notes {
            println!("note: {note}");
        }
    }

    if let Some(path) = policy_file {
        let text = std::fs::read_to_string(&path).with_context(|| format!("read policy {path}"))?;
        let policy = prism_core::sandbox::parse_policy(&text).map_err(anyhow::Error::msg)?;
        let res = prism_core::sandbox::resolve_policy(&policy);
        let plan = prism_core::sandbox::plan_spawn(&res);
        if as_json {
            let plan_json = match &plan {
                Ok(used) => {
                    serde_json::json!({ "sandbox_used": used, "error": serde_json::Value::Null })
                }
                Err(outcome) => {
                    serde_json::json!({ "sandbox_used": serde_json::Value::Null, "error": outcome })
                }
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "policy": policy,
                    "plan": plan_json,
                }))?
            );
        } else {
            match &plan {
                Ok(used) => println!("plan: {used:?}"),
                Err(outcome) => println!("plan: rejected — {outcome:?}"),
            }
        }
        // Mirror the helper: strict policy on an unsupported host is the
        // only failing plan (exit 2), so automation can trust the code.
        if matches!(
            plan,
            Err(prism_core::sandbox::SpawnOutcome::SandboxUnsupported { .. })
        ) {
            std::process::exit(2);
        }
    }
    Ok(())
}
