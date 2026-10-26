//! Prism CLI — native terminal harness over `prism-core`.
//!
//! Event-driven: input threads and chat jobs push `Event`s; the main
//! loop applies them to one `App` and redraws. State (conversations,
//! settings) lives on disk through the core's storage, so a restart
//! resumes the most recent chat.

use anyhow::Context;
use prism_cli::events::{self, Event};
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
    if let Some(arg) = std::env::args().nth(1) {
        match arg.as_str() {
            "--version" | "-V" => {
                println!("prism {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--help" | "-h" => {
                println!("prism — native terminal harness over prism-core");
                println!("usage: prism [--version] [--help]");
                println!(
                    "env: PRISM_CONFIG_DIR (config root), PRISM_CONVERSATIONS_DIR (chat storage)"
                );
                return Ok(());
            }
            other => anyhow::bail!("unknown argument: {other} (see prism --help)"),
        }
    }

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
