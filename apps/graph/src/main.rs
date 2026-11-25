//! The browser entry point `trunk` builds.
//!
//! The crate is web-only: the model, the canvas math and the generation
//! mapping are all compiled and tested on the host, and only this binary and
//! `app` itself require a browser.
//!
//! The *body* is gated, not the file. A crate-level `#![cfg(...)]` cannot do
//! this job: it strips `main` from the crate root, so any host
//! `cargo check --workspace` fails with `E0601: main function not found`
//! rather than skipping the bin. And `required-features` cannot either,
//! because nothing enables the feature — `cargo build --bin prism-graph`
//! then fails with "requires the features: web", which is exactly what
//! `trunk serve` runs.

/// Mount the canvas.
fn main() {
    #[cfg(target_arch = "wasm32")]
    dioxus::launch(prism_graph::app::App);
}