//! The browser entry point `trunk` builds.
//!
//! The crate is web-only: the model, the canvas math and the generation
//! mapping are all compiled and tested on the host, and only this binary and
//! `app` itself require a browser.
//!
//! The host never compiles this file: the manifest gives the bin
//! `required-features = ["web"]`, and a `#![cfg]` cannot do that job — it
//! would strip `main` from the crate root and turn a plain `cargo check`
//! into `E0601: main function not found`.

/// Mount the canvas.
fn main() {
    dioxus::launch(prism_graph::app::App);
}