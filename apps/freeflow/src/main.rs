//! FreeFlow's browser entry point.
//!
//! The *body* is gated, not the file. A crate-level `#![cfg(...)]` would
//! strip `main` from the crate root and turn a host `cargo check` into
//! `E0601: main function not found`; and `required-features` cannot work
//! because nothing enables the feature. So `main` always exists and the
//! browser mount only compiles where it can run.

fn main() {
    dioxus::launch(freeflow::app::App);
}