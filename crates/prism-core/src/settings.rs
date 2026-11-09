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

/// User-defined provider (trimmed to what the OpenAI-compat transport
/// needs). Two shapes:
///
/// - **Canonical alias**: `canonical` names a built-in provider; the
///   custom entry clones its defaults (label, default model) and only
///   overrides the base URL / headers. Good for "my OpenRouter proxy".
/// - **Bare endpoint**: no canonical; `label` + `base_url` describe a
///   generic OpenAI-compatible server (LM Studio, vLLM, a gateway).
///
/// `models` overlays per-model metadata (currently default-model hint
/// list); unknown ids are ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigProvider {
    /// Built-in provider id this entry is an alias of (empty = bare).
    pub canonical: String,
    /// Display label (palette/dropdown). Empty for aliases = reuse
    /// the canonical provider's label + " (custom)".
    pub label: String,
    /// OpenAI-compatible base URL (no trailing slash).
    pub base_url: String,
    /// Static headers merged into every request to this provider.
    pub headers: HashMap<String, String>,
    /// Env-var names that may carry the key (checked in order when no
    /// stored key). Empty = none.
    pub env: Vec<String>,
    /// Per-model display-name overrides / hints. Not yet dispatched
    /// into requests; reserved so the schema is stable.
    pub models: HashMap<String, String>,
}

impl Default for ConfigProvider {
    fn default() -> Self {
        ConfigProvider {
            canonical: String::new(),
            label: String::new(),
            base_url: String::new(),
            headers: HashMap::new(),
            env: Vec::new(),
            models: HashMap::new(),
        }
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
    /// User-defined providers: alias a built-in provider onto a custom
    /// base URL, or add a bare OpenAI-compatible endpoint. Keyed by
    /// provider id.
    pub custom_providers: HashMap<String, ConfigProvider>,
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
            custom_providers: HashMap::new(),
        }
    }
}

impl Settings {
    /// Key for the given provider (per-provider map; legacy `api_key`
    /// applies when the map has no entry — e.g. just after migration).
    /// Falls back to the provider's environment variables when the user
    /// has not stored a key. Works for built-in AND custom providers
    /// (custom `env` list consulted through the resolver).
    pub fn key_for(&self, provider: &str) -> String {
        let stored = self
            .provider_keys
            .get(provider)
            .cloned()
            .unwrap_or_else(|| self.api_key.clone());
        if let Some(custom) = self.custom_providers.get(provider) {
            // Custom: stored key wins, then custom env vars in declared
            // order, then the canonical provider's env vars.
            let stored = stored.trim().to_string();
            if !stored.is_empty() {
                return stored;
            }
            for name in &custom.env {
                if let Ok(v) = std::env::var(name) {
                    let v = v.trim();
                    if !v.is_empty() {
                        return v.to_string();
                    }
                }
            }
            if !custom.canonical.is_empty() {
                if let Some(def) = crate::providers::find(&custom.canonical) {
                    return crate::providers::env_key(def).unwrap_or_default();
                }
            }
            return String::new();
        }
        match crate::providers::find(provider) {
            Some(def) => crate::providers::resolve_key(&stored, def),
            None => stored,
        }
    }

    /// The portable sync view of these settings (see `crate::sync`).
    pub fn to_sync(&self) -> crate::sync::SyncSettings {
        crate::sync::SyncSettings {
            connection: Some(match self.connection {
                Connection::Direct => "direct".into(),
                Connection::PrismApi => "api".into(),
            }),
            provider: Some(self.provider.clone()),
            default_provider: None,
            model: Some(self.model.clone()),
            system_prompt: Some(self.system_prompt.clone()),
            temperature: Some(self.temperature),
            max_tokens: self.max_tokens,
            top_p: self.top_p,
            thinking_enabled: Some(self.thinking_enabled),
            prism_api_url: Some(self.prism_api_url.clone()),
            prism_api_token: Some(self.prism_api_token.clone()),
            base_url: Some(self.local_base_url.clone()),
        }
    }

    /// Resolve any provider id into a concrete connection spec:
    /// built-in table entry, custom alias (canonical defaults + own
    /// base URL/headers), or bare custom endpoint. `None` = unknown id.
    pub fn resolve_provider(&self, id: &str) -> Option<ResolvedProvider> {
        if let Some(custom) = self.custom_providers.get(id) {
            let (label, default_model, needs_key, env_key) = match
                crate::providers::find(&custom.canonical)
            {
                Some(def) => (
                    if custom.label.is_empty() {
                        format!("{} (custom)", def.label)
                    } else {
                        custom.label.clone()
                    },
                    def.default_model.to_string(),
                    def.needs_key,
                    def.env.to_vec(),
                ),
                None => (
                    if custom.label.is_empty() { id.to_string() } else { custom.label.clone() },
                    String::new(),
                    true,
                    Vec::new(),
                ),
            };
            return Some(ResolvedProvider {
                id: id.to_string(),
                label,
                base_url: custom.base_url.trim_end_matches('/').to_string(),
                default_model,
                needs_key,
                env: env_key.into_iter().map(String::from).collect(),
                headers: custom.headers.clone(),
            });
        }
        crate::providers::find(id).map(|def| ResolvedProvider {
            id: def.id.to_string(),
            label: def.label.to_string(),
            base_url: def.base_url.to_string(),
            default_model: def.default_model.to_string(),
            needs_key: def.needs_key,
            env: def.env.iter().map(|s| s.to_string()).collect(),
            headers: HashMap::new(),
        })
    }

    /// All selectable provider ids: built-ins first, then custom ids.
    pub fn all_provider_ids(&self) -> Vec<String> {
        let mut v: Vec<String> = crate::providers::PROVIDERS
            .iter()
            .map(|p| p.id.to_string())
            .collect();
        v.extend(self.custom_providers.keys().cloned());
        v
    }
}

/// Fully-resolved provider: what a request needs, regardless of whether
/// the id came from the static table or `settings.custom_providers`.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedProvider {
    pub id: String,
    pub label: String,
    /// OpenAI-compatible base URL, no trailing slash.
    pub base_url: String,
    /// Default model id (empty = server decides, e.g. llama.cpp).
    pub default_model: String,
    pub needs_key: bool,
    /// Env-var names that may carry the key, in preference order.
    pub env: Vec<String>,
    /// Static headers merged into every request.
    pub headers: HashMap<String, String>,
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
    #[test]
    fn custom_alias_clones_canonical_defaults() {
        let mut s = Settings::default();
        s.custom_providers.insert(
            "my-proxy".into(),
            ConfigProvider {
                canonical: "openrouter".into(),
                base_url: "https://myproxy.example/v1".into(),
                ..Default::default()
            },
        );
        let r = s.resolve_provider("my-proxy").unwrap();
        assert_eq!(r.id, "my-proxy");
        assert_eq!(r.base_url, "https://myproxy.example/v1");
        assert_eq!(r.default_model, "openai/gpt-4o-mini");
        assert!(r.needs_key);
        assert_eq!(r.label, "OpenRouter (custom)");
        assert!(r.headers.is_empty());
    }

    #[test]
    fn custom_bare_endpoint_is_openai_generic() {
        let mut s = Settings::default();
        s.custom_providers.insert(
            "lmstudio".into(),
            ConfigProvider {
                label: "LM Studio".into(),
                base_url: "http://localhost:1234/v1/".into(),
                ..Default::default()
            },
        );
        let r = s.resolve_provider("lmstudio").unwrap();
        assert_eq!(r.base_url, "http://localhost:1234/v1");
        assert_eq!(r.default_model, "");
        assert_eq!(r.label, "LM Studio");
    }

    #[test]
    fn custom_env_and_stored_key_precedence() {
        let mut s = Settings::default();
        s.custom_providers.insert(
            "gw".into(),
            ConfigProvider {
                base_url: "https://gw.test/v1".into(),
                env: vec!["PRISM_TEST_GW_KEY".into()],
                canonical: "openai".into(),
                ..Default::default()
            },
        );
        std::env::set_var("PRISM_TEST_GW_KEY", "gw-env");
        assert_eq!(s.key_for("gw"), "gw-env");
        s.provider_keys.insert("gw".into(), "stored".into());
        assert_eq!(s.key_for("gw"), "stored");
        std::env::remove_var("PRISM_TEST_GW_KEY");
        assert_eq!(s.key_for("gw"), "stored");
    }

    #[test]
    fn builtin_resolution_unchanged() {
        let s = Settings::default();
        let r = s.resolve_provider("openai").unwrap();
        assert_eq!(r.base_url, "https://api.openai.com/v1");
        assert!(r.headers.is_empty());
        assert!(s.resolve_provider("nope").is_none());
    }

    #[test]
    fn custom_providers_roundtrip_settings_json() {
        let mut s = Settings::default();
        s.custom_providers.insert(
            "vllm".into(),
            ConfigProvider {
                label: "vLLM".into(),
                base_url: "http://10.0.0.5:8000/v1".into(),
                headers: [("X-Tenant".to_string(), "a".to_string())]
                    .into_iter()
                    .collect(),
                env: vec!["VLLM_KEY".into()],
                ..Default::default()
            },
        );
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.custom_providers["vllm"].base_url, "http://10.0.0.5:8000/v1");
        assert_eq!(back.custom_providers["vllm"].headers["X-Tenant"], "a");
    }

    #[test]
    fn all_provider_ids_includes_custom() {
        let mut s = Settings::default();
        s.custom_providers.insert(
            "gw2".into(),
            ConfigProvider { base_url: "https://x/v1".into(), ..Default::default() },
        );
        let ids = s.all_provider_ids();
        assert!(ids.contains(&"openai".to_string()));
        assert!(ids.contains(&"gw2".to_string()));
        assert_eq!(ids.last().unwrap(), "gw2");
    }

}
