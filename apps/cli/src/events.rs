//! Event plumbing for the Prism CLI.
//!
//! One channel, one owner. Input threads and background chat jobs only
//! ever push `Event`s; the main loop applies them to the single `App`.

use crossterm::event::{
    Event as CrosstermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseEvent,
};
use prism_core::client::StreamEvent;
use std::sync::mpsc::Sender;

/// Everything that can mutate the app, in arrival order.
pub enum Event {
    Key(KeyEvent),
    Mouse(MouseEvent),
    Stream(StreamEvent),
    Resize(u16, u16),
    Tick(u64),
}

/// True for key-press events only. Windows fires extra Release events;
/// they would double-send every keystroke.
pub fn is_press(key: &KeyEvent) -> bool {
    key.kind == KeyEventKind::Press
}

/// Reader thread: terminal input -> events. Exits on send failure
/// (app gone) or ctrl-c-with-modifiers handled by the app itself.
pub fn spawn_input(tx: Sender<Event>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        loop {
            match crossterm::event::read() {
                Ok(CrosstermEvent::Key(key)) => {
                    // Terminal-level interrupt: quit immediately, the raw
                    // reader thread cannot outlive the app anyway.
                    if is_press(&key)
                        && key.code == KeyCode::Char('c')
                        && key.modifiers.contains(KeyModifiers::CONTROL)
                    {
                        let _ = tx.send(Event::Key(key));
                        return;
                    }
                    if tx.send(Event::Key(key)).is_err() {
                        return;
                    }
                }
                Ok(CrosstermEvent::Mouse(mouse)) => {
                    if tx.send(Event::Mouse(mouse)).is_err() {
                        return;
                    }
                }
                Ok(CrosstermEvent::Resize(w, h)) => {
                    if tx.send(Event::Resize(w, h)).is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    })
}

/// Forwarder thread: core stream events -> app events.
pub fn spawn_stream_forward(rx: std::sync::mpsc::Receiver<StreamEvent>, tx: Sender<Event>) {
    std::thread::spawn(move || {
        for ev in rx {
            if tx.send(Event::Stream(ev)).is_err() {
                return;
            }
        }
    });
}

pub const TICK_MILLIS: u64 = 120;
