//! Settings persistence.
//!
//! Settings are stored as JSON in the platform config directory
//! (e.g. `~/.config/prism-egui/settings.json` on Linux).
//!
//! Note: the API key and prism-api token are stored in plaintext,
//! matching how the Prism extension stores keys in chrome.storage.

use serde::{Deserialize, Serialize};

/// Connection mode selected in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Connection {
    /// Talk straight to the selected provider over HTTP.
    Direct,
    /// Talk to a running Prism API server (non-streaming).
    PrismApi,
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
    /// Bearer API key for the selected provider (direct mode).
    pub api_key: String,
    /// Sampling temperature.
    pub temperature: f32,
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
            temperature: 0.7,
            local_base_url: "http://localhost:11434/v1".into(),
            prism_api_url: "http://localhost:3000".into(),
            prism_api_token: String::new(),
        }
    }
}

/// Path of the settings file, if the platform config dir is known.
pub fn config_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("prism-egui").join("settings.json"))
}

/// Load settings; missing or unreadable file yields defaults.
pub fn load() -> Settings {
    load_from(config_path().as_deref())
}

fn load_from(path: Option<&std::path::Path>) -> Settings {
    let Some(path) = path else {
        return Settings::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Settings::default();
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "prism-egui: ignoring corrupt settings {}: {e}",
                path.display()
            );
            Settings::default()
        }
    }
}

impl Settings {
    /// Write settings to disk, creating parent dirs. Best-effort
    /// callers may ignore the returned error (UI shows a status line).
    pub fn save_to(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        // Write then rename so a crash mid-write cannot truncate the file.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_through_json() {
        let s = Settings {
            connection: Connection::PrismApi,
            provider: "gemini".into(),
            model: "gemini-2.5-flash".into(),
            api_key: "sk-test".into(),
            temperature: 1.25,
            local_base_url: "http://127.0.0.1:9999/v1".into(),
            prism_api_url: "http://10.0.0.5:3000".into(),
            prism_api_token: "jwt".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.connection, Connection::PrismApi);
        assert_eq!(back.api_key, "sk-test");
        assert!((back.temperature - 1.25).abs() < f32::EPSILON);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let back: Settings = serde_json::from_str(r#"{"provider":"qwen"}"#).unwrap();
        assert_eq!(back.provider, "qwen");
        assert_eq!(back.connection, Connection::Direct);
        assert_eq!(back.temperature, 0.7);
        assert_eq!(back.model, "");
    }

    #[test]
    fn corrupt_file_yields_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{not json").unwrap();
        let s = load_from(Some(&path));
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn missing_file_yields_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let s = load_from(Some(&path));
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn save_creates_dirs_and_reload_matches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("settings.json");
        let mut s = Settings::default();
        s.provider = "ollama".into();
        s.save_to(&path).unwrap();
        let back = load_from(Some(&path));
        assert_eq!(back, s);
        // No temp file left behind.
        assert!(!path.with_extension("json.tmp").exists());
    }
}
