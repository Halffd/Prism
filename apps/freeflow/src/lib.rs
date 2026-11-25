//! FreeFlow — a free, unlocked AI creative suite.
//!
//! Everything here is presentation and local state. There is no credit
//! meter, no paywall, no "Pro" badge, and no back end: the generation step
//! produces *procedural placeholders* rather than pretending a model ran.
//! That is deliberate — a demo that lies about generating video is worse
//! than one that is honest and beautiful about being a UI shell.
//!
//! The three-column shell lives in `app`; the reusable pieces in
//! `components`; the design tokens (colour, spacing, motion) in
//! `assets/main.css`.

pub mod app;
pub mod components;
pub mod icons;