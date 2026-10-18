//! Host glue for the egui app: thin re-export of the native host glue
//! from `prism-core::host`, so the app code stays stable while the
//! implementation is shared with the Slint frontend.

pub use prism_core::host::*;
