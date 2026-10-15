//! Prism desktop client built with egui.
//!
//! Chat with AI providers directly (OpenAI, Gemini, Qwen, Ollama —
//! all through OpenAI-compatible endpoints) or through a running
//! Prism API server.

#![forbid(unsafe_code)]

mod app;
mod client;
mod providers;
mod settings;

use std::sync::OnceLock;

/// Shared tokio runtime for background HTTP work. Built lazily on
/// first use; egui drives the UI thread, requests run here.
pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("failed to build tokio runtime")
    })
}

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
