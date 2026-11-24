#![cfg(target_arch = "wasm32")]

//! The browser entry point `trunk` builds.
//!
//! The crate is web-only: the model, the canvas math and the generation
//! mapping are all compiled and tested on the host, and only this binary and
//! `app` itself require a browser. Gating the whole file on `wasm32` keeps
//! `cargo check -p prism-graph` on a desktop from trying to link them.

/// Mount the canvas.
fn main() {
    dioxus::launch(prism_graph::app::App);
}