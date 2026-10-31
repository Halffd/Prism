//! Settings model and storage-trait-backed persistence.
//!
//! Stored as JSON (atomic writes via the `Storage` trait; defaults on
//! missing or corrupt files). Note: API keys and tokens are stored in
//! plaintext, matching how the Prism extension stores keys in
//! chrome.storage.

use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Connection mode selected in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Connection {
    /// Talk straight to the selected provider over HTTP.
    Direct,
    /// Talk to a running Prism API server (non-streaming).
    PrismApi,
}

/// Hardware/low-spec profile for local inference servers, mirroring
/// `HardwareProfile` in @prism/shared-types and the TUI's hardware rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct HardwareSettings {
    /// auto | cpu-only | gpu-auto | gpu-nvidia | gpu-amd | gpu-intel
    pub preferred_compute: String,
    /// GPU offload layer override (Ollama `num_gpu`).
    pub gpu_layers_override: Option<u32>,
    /// Context size hint in tokens (Ollama `num_ctx`).
    pub context_tokens: Option<u32>,
}

impl Default for HardwareSettings {
    fn default() -> Self {
        HardwareSettings {
            preferred_compute: "auto".into(),
            gpu_layers_override: None,
            context_tokens: None,
        }
    }
}

/// True when hardware overrides must reach the server. Ollama gets them
/// via its native /api/chat options; llama.cpp/KoboldCpp take them as
/// launch flags, so overrides are ignored there (documented, not forced).
impl HardwareSettings {
    pub fn has_overrides(&self) -> bool {
        self.gpu_layers_override.is_some()
            || self.context_tokens.is_some()
            || self.preferred_compute == "cpu-only"
    }
}

/// Full application settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub connection: Connection,
    /// Provider id (see `providers::PROVIDERS`), used in direct mode.
    pub provider: String,
    /// Model id override; empty means provider default.
    pub model: String,
    /// Legacy single key, migrated to `provider_keys` on load.
    pub api_key: String,
    /// Bearer key per provider id (direct mode).
    pub provider_keys: HashMap<String, String>,
    /// Per-provider cached model ids ("Fetch Available Models" results).
    pub model_cache: HashMap<String, Vec<String>>,
    /// Sampling temperature.
    pub temperature: f32,
    /// `max_tokens` request field; None = omit (server default).
    pub max_tokens: Option<u32>,
    /// `top_p` request field; None = omit.
    pub top_p: Option<f32>,
    /// `frequency_penalty` request field; None = omit.
    pub frequency_penalty: Option<f32>,
    /// `presence_penalty` request field; None = omit.
    pub presence_penalty: Option<f32>,
    /// System prompt, sent as the first message (direct mode).
    pub system_prompt: String,
    /// Extended thinking via <thinking> scratchpad tags.
    pub thinking_enabled: bool,
    /// Hardware profile for local inference servers.
    pub hardware: HardwareSettings,
    /// Ollama base URL override (OpenAI-compatible, include `/v1`).
    pub local_base_url: String,
    /// Prism API server base URL (server mode).
    pub prism_api_url: String,
    /// Bearer JWT for the Prism API server (server mode).
    pub prism_api_token: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            connection: Connection::Direct,
            provider: "openai".into(),
            model: String::new(),
            api_key: String::new(),
            provider_keys: HashMap::new(),
            model_cache: HashMap::new(),
            temperature: 0.7,
            max_tokens: Some(2048),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            system_prompt: String::new(),
            thinking_enabled: false,
            hardware: HardwareSettings::default(),
            local_base_url: "http://localhost:11434/v1".into(),
            prism_api_url: "http://localhost:3000".into(),
            prism_api_token: String::new(),
        }
    }
}

impl Settings {
    /// Key for the given provider (per-provider map; legacy `api_key`
    /// applies when the map has no entry — e.g. just after migration).
    /// Falls back to the provider's environment variables when the user
    /// has not stored a key (see `providers::resolve_key`).
    pub fn key_for(&self, provider: &str) -> String {
        let stored = self
            .provider_keys
            .get(provider)
            .cloned()
            .unwrap_or_else(|| self.api_key.clone());
        match crate::providers::find(provider) {
            Some(def) => crate::providers::resolve_key(&stored, def),
            None => stored,
        }
    }
}

/// Migrate legacy settings: a non-empty top-level `api_key` moves into
/// `provider_keys[provider]` (per-provider map replaces the single key).
fn apply_migrations(mut s: Settings) -> Settings {
    if !s.api_key.is_empty() {
        s.provider_keys
            .entry(s.provider.clone())
            .or_insert_with(|| s.api_key.clone());
        s.api_key.clear();
    }
    s
}

/// Parse settings JSON (missing fields default) and apply migrations.
/// Errors are returned, not swallowed — callers loading from storage
/// use `load_settings`, which falls back to defaults.
pub fn settings_from_json(text: &str) -> Result<Settings, serde_json::Error> {
    Ok(apply_migrations(serde_json::from_str::<Settings>(text)?))
}

/// Load settings from `path`. Missing, unreadable, or corrupt files
/// yield defaults; a partially-filled file yields defaults for absent
/// fields.
pub fn load_settings(storage: &dyn Storage, path: &Path) -> Settings {
    let text = match storage.read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Settings::default(),
    };
    match settings_from_json(&text) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "prism-core: ignoring corrupt settings {}: {e}",
                path.display()
            );
            Settings::default()
        }
    }
}

/// Write settings to `path`, creating parent dirs. Atomic write
/// (tmp + rename) via the storage layer.
pub fn save_settings(
    storage: &dyn Storage,
    path: &Path,
    settings: &Settings,
) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        storage.create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
    storage.write_atomic(path, &json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::FsStorage;

    #[test]
    fn roundtrips_through_json() {
        let mut s = Settings {
            connection: Connection::PrismApi,
            provider: "gemini".into(),
            model: "gemini-2.5-flash".into(),
            temperature: 1.25,
            local_base_url: "http://127.0.0.1:9999/v1".into(),
            prism_api_url: "http://10.0.0.5:3000".into(),
            prism_api_token: "jwt".into(),
            system_prompt: "be terse".into(),
            thinking_enabled: true,
            max_tokens: Some(1024),
            top_p: Some(0.9),
            frequency_penalty: Some(0.1),
            presence_penalty: Some(0.2),
            ..Default::default()
        };
        s.provider_keys.insert("gemini".into(), "g-key".into());
        s.provider_keys.insert("openai".into(), "sk-test".into());
        s.model_cache
            .insert("openai".into(), vec!["gpt-4o".into(), "gpt-4o-mini".into()]);
        s.hardware = HardwareSettings {
            preferred_compute: "gpu-nvidia".into(),
            gpu_layers_override: Some(16),
            context_tokens: Some(8192),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let back: Settings = serde_json::from_str(r#"{"provider":"qwen"}"#).unwrap();
        assert_eq!(back.provider, "qwen");
        assert_eq!(back.connection, Connection::Direct);
        assert_eq!(back.temperature, 0.7);
        assert_eq!(back.model, "");
        assert_eq!(back.max_tokens, Some(2048));
        assert_eq!(back.top_p, None);
        assert_eq!(back.system_prompt, "");
        assert!(!back.thinking_enabled);
        assert_eq!(back.hardware.preferred_compute, "auto");
        assert_eq!(back.hardware.gpu_layers_override, None);
        assert!(back.provider_keys.is_empty());
        assert!(back.model_cache.is_empty());
    }

    #[test]
    fn corrupt_file_yields_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{not json").unwrap();
        let s = load_settings(&FsStorage, &path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn missing_file_yields_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let s = load_settings(&FsStorage, &path);
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn save_creates_dirs_and_reload_matches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("settings.json");
        let mut s = Settings::default();
        s.provider = "ollama".into();
        save_settings(&FsStorage, &path, &s).unwrap();
        let back = load_settings(&FsStorage, &path);
        assert_eq!(back, s);
        // No temp file left behind.
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn legacy_api_key_migrates_to_provider_keys_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // Pre-migration file shape: single api_key, no provider_keys.
        std::fs::write(
            &path,
            r#"{"provider":"openai","api_key":"sk-legacy","temperature":0.5}"#,
        )
        .unwrap();
        let s = load_settings(&FsStorage, &path);
        assert_eq!(s.key_for("openai"), "sk-legacy");
        assert_eq!(
            s.api_key, "",
            "legacy field must be cleared after migration"
        );
        assert_eq!(
            s.provider_keys.get("openai").map(String::as_str),
            Some("sk-legacy")
        );
        // Migration survives a save/reload cycle.
        let path2 = dir.path().join("2").join("settings.json");
        save_settings(&FsStorage, &path2, &s).unwrap();
        let back = load_settings(&FsStorage, &path2);
        assert_eq!(back.key_for("openai"), "sk-legacy");
    }

    #[test]
    fn key_for_prefers_provider_keys_over_legacy() {
        let mut s = Settings::default();
        s.api_key = "legacy".into();
        s.provider_keys.insert("qwen".into(), "q-key".into());
        assert_eq!(s.key_for("qwen"), "q-key");
        assert_eq!(s.key_for("openai"), "legacy");
    }

    #[test]
    fn hardware_has_overrides_logic() {
        let mut hw = HardwareSettings::default();
        assert!(!hw.has_overrides());
        hw.preferred_compute = "cpu-only".into();
        assert!(hw.has_overrides());
        hw.preferred_compute = "gpu-auto".into();
        assert!(!hw.has_overrides());
        hw.gpu_layers_override = Some(8);
        assert!(hw.has_overrides());
        hw.gpu_layers_override = None;
        hw.context_tokens = Some(4096);
        assert!(hw.has_overrides());
    }
}
