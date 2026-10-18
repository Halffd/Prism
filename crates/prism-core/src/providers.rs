//! Provider definitions for direct (OpenAI-compatible) connections.
//!
//! All direct providers are reached through an OpenAI-compatible
//! `/chat/completions` endpoint so one streaming client covers them:
//! OpenAI natively, Gemini via its OpenAI-compat layer, Qwen via
//! DashScope compatible-mode, local llama.cpp/KoboldCpp/SGLang/Ollama
//! servers, and DeepSeek/Groq/OpenRouter/Mistral cloud APIs.
//!
//! Claude is intentionally absent: its native API is not
//! OpenAI-compatible and would need a separate client.
//!
//! Hardware overrides (GPU layers, context tokens) are NOT sent on this
//! path: llama.cpp/KoboldCpp take those as server launch flags, and
//! Ollama only accepts them on its native `/api/chat` endpoint, which
//! `client.rs` uses for Ollama when overrides are set.

/// One direct-connection provider.
pub struct ProviderDef {
    /// Stable id stored in settings.
    pub id: &'static str,
    /// Human-readable label shown in the UI.
    pub label: &'static str,
    /// Base URL for the OpenAI-compatible API (no trailing slash,
    /// includes the version segment such as `/v1`).
    pub base_url: &'static str,
    /// Default model id used when the model field is empty.
    pub default_model: &'static str,
    /// Whether a Bearer API key is required.
    pub needs_key: bool,
}

pub const PROVIDERS: &[ProviderDef] = &[
    ProviderDef {
        id: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-4o",
        needs_key: true,
    },
    ProviderDef {
        id: "gemini",
        label: "Gemini (OpenAI-compat)",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        default_model: "gemini-2.5-flash",
        needs_key: true,
    },
    ProviderDef {
        id: "qwen",
        label: "Qwen (DashScope compat)",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model: "qwen-plus",
        needs_key: true,
    },
    ProviderDef {
        id: "deepseek",
        label: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        default_model: "deepseek-chat",
        needs_key: true,
    },
    ProviderDef {
        id: "groq",
        label: "Groq",
        base_url: "https://api.groq.com/openai/v1",
        default_model: "llama-3.3-70b-versatile",
        needs_key: true,
    },
    ProviderDef {
        id: "openrouter",
        label: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        default_model: "openai/gpt-4o-mini",
        needs_key: true,
    },
    ProviderDef {
        id: "mistral",
        label: "Mistral",
        base_url: "https://api.mistral.ai/v1",
        default_model: "mistral-large-latest",
        needs_key: true,
    },
    ProviderDef {
        id: "ollama",
        label: "Ollama (local)",
        base_url: "http://localhost:11434/v1",
        default_model: "llama3.2",
        needs_key: false,
    },
    ProviderDef {
        id: "llamacpp",
        label: "llama.cpp (local)",
        base_url: "http://localhost:8080/v1",
        // llama-server serves whatever model was loaded at launch.
        default_model: "",
        needs_key: false,
    },
    ProviderDef {
        id: "koboldcpp",
        label: "KoboldCpp (local)",
        base_url: "http://localhost:5001/v1",
        default_model: "",
        needs_key: false,
    },
    ProviderDef {
        id: "sglang",
        label: "SGLang (local)",
        base_url: "http://localhost:30000/v1",
        default_model: "",
        needs_key: false,
    },
];

/// Look up a provider by id.
pub fn find(id: &str) -> Option<&'static ProviderDef> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// Chat endpoint for an OpenAI-compatible base URL.
pub fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

/// Models-list endpoint for an OpenAI-compatible base URL.
pub fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

/// Ollama native API root from a possibly `/v1`-suffixed base URL.
pub fn ollama_root_url(base_url: &str) -> String {
    let root = base_url.trim().trim_end_matches('/');
    root.strip_suffix("/v1").unwrap_or(root).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_provider_by_id() {
        let p = find("ollama").expect("ollama exists");
        assert_eq!(p.needs_key, false);
        assert_eq!(p.default_model, "llama3.2");
        assert!(find("nope").is_none());
    }

    #[test]
    fn builds_chat_url_without_double_slash() {
        assert_eq!(
            chat_completions_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn builds_models_url_without_double_slash() {
        assert_eq!(
            models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn strips_v1_suffix_for_ollama_root() {
        assert_eq!(
            ollama_root_url("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            ollama_root_url("http://localhost:11434"),
            "http://localhost:11434"
        );
        assert_eq!(
            ollama_root_url(" http://localhost:11434/v1/ "),
            "http://localhost:11434"
        );
    }

    #[test]
    fn all_provider_urls_are_absolute() {
        for p in PROVIDERS {
            assert!(p.base_url.starts_with("http"), "{}", p.id);
            assert!(!p.base_url.ends_with('/'), "{}", p.id);
        }
    }

    #[test]
    fn local_providers_do_not_need_keys() {
        for p in PROVIDERS {
            if p.base_url.contains("localhost") {
                assert!(!p.needs_key, "{} is local and must not need a key", p.id);
            } else {
                assert!(p.needs_key, "{} is remote and must need a key", p.id);
            }
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = PROVIDERS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        let len = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), len, "duplicate provider id");
    }
}
