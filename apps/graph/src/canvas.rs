//! Canvas interaction.
//!
//! The geometry, hit-testing and drag state live in
//! `prism_core::graph_canvas`, shared with the Slint canvas and tested on
//! the host by the core's own suite. This alias keeps the surface's call
//! sites short.

pub use prism_core::graph_canvas::*;
