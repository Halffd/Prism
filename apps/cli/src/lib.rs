//! Prism CLI library surface: state machine, chat job wiring, events,
//! and rendering. The `prism` bin drives these over a terminal.
pub mod acp;
pub mod chat;
pub mod cmd;
pub mod events;
pub mod features;
pub mod serve;
pub mod state;
pub mod ui;
