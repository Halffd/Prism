//! Prism canvas node-graph studio — a ComfyUI-style editor for image
//! generation, built in Dioxus/WASM over prism-core.
//!
//! The crate is split so the testable part never touches a browser:
//! - `graph`  — nodes, typed ports, wires, bezier geometry, validation.
//! - `nodes`  — the six node definitions (which knobs exist, what can
//!   connect to what).
//! - `factory`— node creation and the starting drawing.
//! - `request`— flattening a graph into the browser host's request.
//! - `app`    — the Dioxus surface (canvas, pan/zoom, drag-and-drop).
//!
//! Like every other Prism host, the UI owns no Stable Diffusion rule:
//! samplers, clamps, defaults and request bodies all live in
//! `prism-core` and reach the browser through the WASM bridge.

pub mod graph;
pub mod nodes;
pub mod factory;
pub mod request;

#[cfg(any(target_arch = "wasm32", test))]
mod tests;

#[cfg(all(target_arch = "wasm32", not(test)))]
pub mod app;