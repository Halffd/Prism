//! Prism canvas node-graph studio — a ComfyUI-style editor for image
//! generation, built in Dioxus/WASM over prism-core.
//!
//! The model is deliberately *not* duplicated here. Nodes, typed ports,
//! wires, bezier geometry, validation, the node palette and the flatten
//! step all live in `prism-core` (`graph`, `graph_nodes`,
//! `graph_factory`, `graph_request`, `graph_store`) and are re-exported
//! below for convenience. One tested definition backs this surface, the
//! Slint canvas and the sync API, so the three can never disagree about
//! the wire format — and the model stays testable without a browser.
//!
//! Like every other Prism host, the UI owns no Stable Diffusion rule:
//! samplers, clamps, defaults and request bodies all live in prism-core
//! and reach the browser through the WASM bridge.

pub use prism_core::graph;
pub use prism_core::graph_factory;
pub use prism_core::graph_nodes;
pub use prism_core::graph_request;
pub use prism_core::graph_store;

/// Canvas interaction math (view transform, hit-testing, drag state) as
/// pure functions, so `cargo test -p prism-graph` can cover the parts of
/// a canvas that are otherwise only verifiable by clicking in a browser.
pub mod canvas;

/// Turning a flattened canvas into images: the pure form→request mapping
/// is host-testable, and only the `fetch` calls are wasm-only.
pub mod generate;

/// The API transport: one shared canvas across every Prism surface.
/// Web-only, since it drives `fetch` through gloo-net.
#[cfg(target_arch = "wasm32")]
pub mod sync;

/// The Dioxus surface: node palette, pan/zoom, drag-and-drop wiring and
/// the Generate button that flattens the canvas into a request.
#[cfg(all(target_arch = "wasm32", not(test)))]
pub mod app;