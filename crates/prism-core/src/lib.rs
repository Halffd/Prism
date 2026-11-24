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
//! - `native_llm` / `native_sd`: deterministic, in-process preview engines
//!   for chat and images (no model weights, no sockets).
//! - `candle_llm` / `candle_sd`: feature-gated real neural inference from
//!   local GGUF/SD weights (no network, no Python).
//! - `thinking`: `<thinking>` scratchpad handling.
//! - `settings` / `conversations`: state models plus storage-trait
//!   backed persistence (atomic writes, default-on-corrupt).
//! - `transport`: the HTTP boundary trait + the native reqwest impl
//!   (feature `native-transport`).
//! - `storage`: the filesystem boundary trait + the native impl.
//!
//! Wire contract: see `docs/plans/single-core-plan.md` — fixtures are
//! the spec.

pub mod agent;
pub mod backup;
pub mod cards;
pub mod graph;
pub mod graph_factory;
pub mod graph_nodes;
pub mod graph_request;
pub mod graph_store;
#[cfg(test)]
mod graph_store_tests;
#[cfg(test)]
mod graph_tests;
#[cfg(feature = "candle-llm")]
pub mod candle_llm;
#[cfg(feature = "candle-sd")]
pub mod candle_sd;
pub mod catalog;
pub mod client;
pub mod commands;
pub mod ensemble;
pub mod context;
pub mod conversations;
#[cfg(feature = "native-transport")]
pub mod host;
pub mod local;
#[cfg(feature = "native-transport")]
pub mod mcp;
pub mod media;
pub mod memory_graph;
pub mod modes;
pub mod native_llm;
pub mod native_sd;
pub mod native_tools;
pub mod plugins;
pub mod prompt_history;
pub mod prompt_picker;
pub mod providers;
pub mod rag;
pub mod sandbox;
pub mod search;
pub mod session;
pub mod session_ops;
pub mod settings;
pub mod storage;
pub mod subagents;
pub mod sync;
pub mod thinking;
pub mod toolgate;
pub mod web;
pub mod transport;
#[cfg(feature = "native-transport")]
pub mod workspace;

pub use client::{
    ApiChatRequest, ChatMessage, ModelsEvent, ModelsRequest, OllamaChatRequest, OllamaLine,
    StreamEvent, StreamRequest,
};
pub use settings::Settings;
