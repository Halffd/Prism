//! Prism desktop client built with egui.
//!
//! Thin host over `prism-core` (single AI core for all Prism surfaces):
//! this crate owns the UI, the tokio executor and platform paths. All
//! provider clients, decoders, thinking, settings and conversation
//! persistence live in the core crate.
//!
//! See `docs/plans/single-core-plan.md`.

#![forbid(unsafe_code)]

mod app;
mod bridge;

use eframe::egui;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([960.0, 720.0])
            .with_min_inner_size([640.0, 480.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Prism",
        options,
        Box::new(|_cc| Ok(Box::new(app::PrismApp::new()))),
    )
}
