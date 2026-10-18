//! Prism core: the single AI implementation for all Prism surfaces.
//!
//! One crate, compiled natively (desktop, mobile) and to WASM (browser
//! extension, web, Node hosts). Everything inside is transport-free and
//! storage-free except the explicitly-gated native impls:
//!
//! - `client`: streaming request/response types and byte-level stream
//!   decoders (OpenAI-compatible SSE, Ollama NDJSON, prism-api JSON,
//!   model lists). The decoders are the conformance surface: recorded
//!   wire fixtures in `contracts/fixtures/` must decode identically on
//!   every target.
//! - `providers`: the OpenAI-compatible provider table.
//! - `thinking`: `<thinking>` scratchpad handling.
//! - `settings` / `conversations`: state models plus storage-trait
//!   backed persistence (atomic writes, default-on-corrupt).
//! - `transport`: the HTTP boundary trait + the native reqwest impl
//!   (feature `native-transport`).
//! - `storage`: the filesystem boundary trait + the native impl.
//!
//! Wire contract: see `docs/plans/single-core-plan.md` — fixtures are
//! the spec.

pub mod client;
pub mod conversations;
pub mod providers;
pub mod settings;
pub mod storage;
pub mod thinking;
pub mod transport;

pub use client::{
    ApiChatRequest, ChatMessage, ModelsEvent, ModelsRequest, OllamaChatRequest, OllamaLine,
    StreamEvent, StreamRequest,
};
pub use settings::Settings;
