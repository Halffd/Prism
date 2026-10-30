//! Prism desktop client built with Slint.
//!
//! Thin host over `prism-core`: the UI owns no AI logic. State machine
//! mirrors the egui app (chat, streaming, settings, conversations,
//! thinking, hardware) and runs entirely on the UI thread; network
//! requests spawn on the core's shared runtime and report back over
//! std channels drained by a 50 ms UI timer.

mod shared;

use shared::*;

fn main() {
    shared::run_ui();
}
