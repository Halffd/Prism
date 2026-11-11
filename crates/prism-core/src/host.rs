//! Native host glue shared by all native Prism frontends (egui today,
//! Slint tomorrow). Decides WHERE files go and HOW requests execute;
//! contains no AI logic.
//!
//! Env overrides: `$PRISM_CONFIG_DIR` (config root) and
//! `$PRISM_CONVERSATIONS_DIR` (conversation storage).

use crate::client::{
    run_api_chat, run_models_fetch, run_ollama_chat, run_stream, ApiChatRequest, ModelsEvent,
    ModelsRequest, OllamaChatRequest, StreamEvent, StreamRequest,
};
use crate::conversations::{self, Conversation, ConversationMeta};
use crate::settings::{self, Settings};
use crate::storage::{FsStorage, Storage};
use crate::transport::{ReqwestTransport, Transport};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use tokio::runtime::Runtime;

/// Shared tokio runtime for background HTTP work. Built lazily on
/// first use; frontends drive their own UI thread, requests run here.
pub fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
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

/// Config root: `$PRISM_CONFIG_DIR` overrides the platform config dir
/// (portable setups / tests).
pub fn config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PRISM_CONFIG_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    dirs::config_dir().map(|d| d.join("prism"))
}

pub fn settings_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("settings.json"))
}

/// Prompt input history file (`history.jsonl` in the config root).
pub fn prompt_history_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("history.jsonl"))
}

/// Load sent-prompt history, oldest first (callers index from the end).
pub fn load_prompt_history() -> Vec<crate::prompt_history::PromptEntry> {
    match prompt_history_path() {
        Some(path) => crate::prompt_history::load_history(storage(), &path),
        None => Vec::new(),
    }
}

/// Remember a sent prompt (dedupe + cap 50, self-healing rewrite).
pub fn record_prompt(text: &str) {
    if let Some(path) = prompt_history_path() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let _ = crate::prompt_history::record_prompt(
            storage(),
            &path,
            text,
            now,
            crate::prompt_history::MAX_HISTORY_ENTRIES,
        );
    }
}

/// Conversation storage dir; `$PRISM_CONVERSATIONS_DIR` overrides.
pub fn conversations_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PRISM_CONVERSATIONS_DIR") {
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

// --- data sync (export / import / clear) ---

/// Path of the export envelope file (config dir root).
pub fn sync_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("prism-data.json"))
}

/// Build the export envelope from settings + all conversations.
pub fn export_envelope() -> crate::sync::SyncEnvelope {
    let convs = list_conversations()
        .iter()
        .filter_map(|m| load_conversation(&m.id))
        .collect::<Vec<_>>();
    crate::sync::SyncEnvelope::from_core(&convs, &load_settings())
}

/// Write the envelope to disk (pretty JSON).
pub fn export_data(path: Option<&std::path::Path>) -> Result<(), String> {
    let path = match path {
        Some(p) => p.to_path_buf(),
        None => sync_path().ok_or("no config dir")?,
    };
    let env = export_envelope();
    if let Some(parent) = path.parent() {
        storage().create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    storage()
        .write_atomic(&path, &env.to_json())
        .map_err(|e| e.to_string())
}

/// Read + validate an envelope file.
pub fn load_envelope(path: &std::path::Path) -> Result<crate::sync::SyncEnvelope, String> {
    let text = storage()
        .read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    crate::sync::SyncEnvelope::from_json(&text).ok_or_else(|| "not a Prism data envelope".into())
}

/// Apply an imported envelope: every conversation is written to the
/// conversations dir (overwrites by id). Settings are NOT touched —
/// keys/credentials stay local unless the user edits them.
pub fn import_data(path: &std::path::Path) -> Result<usize, String> {
    let env = load_envelope(path)?;
    let Some(dir) = conversations_dir() else {
        return Err("no config dir".into());
    };
    storage().create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut n = 0;
    for conv in env.to_core() {
        conversations::save_conversation(storage(), &dir, &conv).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// Delete every local conversation. Settings and prompt history untouched.
pub fn clear_data() -> Result<usize, String> {
    let metas = list_conversations();
    let n = metas.len();
    for m in metas {
        let _ = delete_conversation(&m.id);
    }
    Ok(n)
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

/// Probe one local server's health. Blocking; call from a worker thread.
/// `base_url` overrides the provider's default when the user typed one.
pub fn probe_local(id: &str, base_url: Option<&str>) -> crate::local::Health {
    let Some(provider) = crate::local::find(id) else {
        return crate::local::Health::Down {
            reason: format!("unknown local provider '{id}'"),
        };
    };
    let base = base_url.unwrap_or(provider.base_url).trim().to_string();
    let url = provider.health_url(&base);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string());
    let Ok(rt) = rt else {
        return crate::local::Health::Down { reason: rt.err().unwrap() };
    };
    rt.block_on(async {
        let req = crate::transport::HttpRequest {
            url,
            headers: Vec::new(),
            body: None,
        };
        match transport().get_body(req).await {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                crate::local::health_from_body(provider, &text)
            }
            Err(e) => crate::local::Health::Down { reason: e },
        }
    })
}

/// Probe every local provider concurrently-ish (sequentially; each probe
/// is a fast TCP connect). Returns the reachable ids.
pub fn reachable_locals(base_urls: &std::collections::HashMap<String, String>) -> Vec<String> {
    crate::local::LOCAL_PROVIDERS
        .iter()
        .filter(|p| probe_local(p.id, base_urls.get(p.id).map(String::as_str)).reachable())
        .map(|p| p.id.to_string())
        .collect()
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

/// Spawn a media request (image, inpaint, video, 3D model).
///
/// The outcome arrives on `tx`: a ready media URL, a task id to poll, or
/// the reason the request failed.
pub fn spawn_media(
    kind: crate::media::MediaKind,
    req: crate::media::MediaRequest,
    tx: Sender<crate::media::MediaOutcome>,
) {
    runtime().spawn(async move {
        match crate::media::run_media(transport(), kind, &req).await {
            Ok(outcome) => {
                let _ = tx.send(outcome);
            }
            Err(e) => {
                let _ = tx.send(crate::media::MediaOutcome::Failed(e));
            }
        }
    });
}

/// Spawn a poll of an asynchronous media task.
pub fn spawn_media_poll(
    provider: String,
    base_url: String,
    api_key: String,
    task_id: String,
    tx: Sender<crate::media::MediaOutcome>,
) {
    runtime().spawn(async move {
        match crate::media::poll_media(transport(), &provider, &base_url, &api_key, &task_id).await
        {
            Ok(outcome) => {
                let _ = tx.send(outcome);
            }
            Err(e) => {
                let _ = tx.send(crate::media::MediaOutcome::Failed(e));
            }
        }
    });
}
