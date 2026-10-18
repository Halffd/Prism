//! Host glue for the egui app: platform paths, storage, transport and
//! executor wiring. All AI logic lives in `prism-core`; this module
//! only decides WHERE files go and HOW requests get executed.

use prism_core::client::{
    run_api_chat, run_models_fetch, run_ollama_chat, run_stream, ApiChatRequest, ModelsEvent,
    ModelsRequest, OllamaChatRequest, StreamEvent, StreamRequest,
};
use prism_core::conversations::{self, Conversation, ConversationMeta};
use prism_core::settings::{self, Settings};
use prism_core::storage::FsStorage;
use prism_core::transport::ReqwestTransport;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

/// Shared tokio runtime for background HTTP work. Built lazily on
/// first use; egui drives the UI thread, requests run here.
pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("failed to build tokio runtime")
    })
}

fn storage() -> &'static FsStorage {
    static S: OnceLock<FsStorage> = OnceLock::new();
    S.get_or_init(|| FsStorage)
}

/// Config root: `$PRISM_EGUI_CONFIG_DIR` overrides the platform config
/// dir (portable setups / tests).
fn config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PRISM_EGUI_CONFIG_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    dirs::config_dir().map(|d| d.join("prism-egui"))
}

pub fn settings_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("settings.json"))
}

/// Conversation storage dir; `$PRISM_EGUI_CONVERSATIONS` overrides.
fn conversations_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PRISM_EGUI_CONVERSATIONS") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    config_dir().map(|d| d.join("conversations"))
}

pub fn load_settings() -> Settings {
    match settings_path() {
        Some(path) => settings::load_settings(storage(), &path),
        None => Settings::default(),
    }
}

/// Save settings; `Err` carries a human-readable message.
pub fn save_settings(s: &Settings) -> Result<(), String> {
    let Some(path) = settings_path() else {
        return Err("no config dir on this platform".into());
    };
    settings::save_settings(storage(), &path, s).map_err(|e| e.to_string())
}

pub fn list_conversations() -> Vec<ConversationMeta> {
    match conversations_dir() {
        Some(dir) => conversations::list_conversations(storage(), &dir),
        None => Vec::new(),
    }
}

pub fn load_conversation(id: &str) -> Option<Conversation> {
    conversations_dir().and_then(|dir| conversations::load_conversation(storage(), &dir, id))
}

pub fn save_conversation(conv: &Conversation) -> Result<(), String> {
    let Some(dir) = conversations_dir() else {
        return Err("no config dir on this platform".into());
    };
    conversations::save_conversation(storage(), &dir, conv).map_err(|e| e.to_string())
}

pub fn delete_conversation(id: &str) -> Result<(), String> {
    let Some(dir) = conversations_dir() else {
        return Ok(());
    };
    conversations::delete_conversation(storage(), &dir, id).map_err(|e| e.to_string())
}

fn transport() -> &'static ReqwestTransport {
    static T: OnceLock<ReqwestTransport> = OnceLock::new();
    T.get_or_init(ReqwestTransport::new)
}

pub fn spawn_stream(req: StreamRequest, tx: Sender<StreamEvent>) {
    runtime().spawn(async move {
        if let Err(e) = run_stream(transport(), &req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

pub fn spawn_ollama_chat(req: OllamaChatRequest, tx: Sender<StreamEvent>) {
    runtime().spawn(async move {
        if let Err(e) = run_ollama_chat(transport(), &req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

pub fn spawn_api_chat(req: ApiChatRequest, tx: Sender<StreamEvent>) {
    runtime().spawn(async move {
        if let Err(e) = run_api_chat(transport(), &req, &tx).await {
            let _ = tx.send(StreamEvent::Error(e));
        }
    });
}

pub fn spawn_models_fetch(req: ModelsRequest, tx: Sender<ModelsEvent>) {
    runtime().spawn(async move {
        if let Err(e) = run_models_fetch(transport(), &req, &tx).await {
            let _ = tx.send(ModelsEvent::Error(e));
        }
    });
}
