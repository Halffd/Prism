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
    /// Environment variables that may carry the API key, in preference
    /// order. Checked when the user has not stored a key for this
    /// provider in settings. Empty for local servers.
    pub env: &'static [&'static str],
}

pub const PROVIDERS: &[ProviderDef] = &[
    ProviderDef {
        id: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-4o",
        needs_key: true,
        env: &["OPENAI_API_KEY"],
    },
    ProviderDef {
        id: "gemini",
        label: "Gemini (OpenAI-compat)",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        default_model: "gemini-2.5-flash",
        needs_key: true,
        env: &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    },
    ProviderDef {
        id: "qwen",
        label: "Qwen (DashScope compat)",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model: "qwen-plus",
        needs_key: true,
        env: &["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    },
    ProviderDef {
        id: "deepseek",
        label: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        default_model: "deepseek-chat",
        needs_key: true,
        env: &["DEEPSEEK_API_KEY"],
    },
    ProviderDef {
        id: "groq",
        label: "Groq",
        base_url: "https://api.groq.com/openai/v1",
        default_model: "llama-3.3-70b-versatile",
        needs_key: true,
        env: &["GROQ_API_KEY"],
    },
    ProviderDef {
        id: "openrouter",
        label: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        default_model: "openai/gpt-4o-mini",
        needs_key: true,
        env: &["OPENROUTER_API_KEY"],
    },
    ProviderDef {
        id: "mistral",
        label: "Mistral",
        base_url: "https://api.mistral.ai/v1",
        default_model: "mistral-large-latest",
        needs_key: true,
        env: &["MISTRAL_API_KEY"],
    },
    ProviderDef {
        id: "grok",
        label: "Grok (xAI)",
        base_url: "https://api.x.ai/v1",
        default_model: "grok-3",
        needs_key: true,
        env: &["XAI_API_KEY", "GROK_API_KEY"],
    },
    ProviderDef {
        id: "nvidia-nim",
        label: "NVIDIA NIM",
        base_url: "https://integrate.api.nvidia.com/v1",
        default_model: "meta/llama-3.3-70b-instruct",
        needs_key: true,
        env: &["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
    },
    ProviderDef {
        id: "cerebras",
        label: "Cerebras",
        base_url: "https://api.cerebras.ai/v1",
        default_model: "llama3.3-70b",
        needs_key: true,
        env: &["CEREBRAS_API_KEY"],
    },
    ProviderDef {
        id: "together",
        label: "Together",
        base_url: "https://api.together.xyz/v1",
        default_model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        needs_key: true,
        env: &["TOGETHER_API_KEY"],
    },
    ProviderDef {
        id: "fireworks",
        label: "Fireworks",
        base_url: "https://api.fireworks.ai/inference/v1",
        default_model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
        needs_key: true,
        env: &["FIREWORKS_API_KEY"],
    },
    ProviderDef {
        id: "perplexity",
        label: "Perplexity",
        base_url: "https://api.perplexity.ai",
        default_model: "sonar",
        needs_key: true,
        env: &["PERPLEXITY_API_KEY"],
    },
    ProviderDef {
        id: "ollama",
        label: "Ollama (local)",
        base_url: "http://localhost:11434/v1",
        default_model: "llama3.2",
        needs_key: false,
        env: &[],
    },
    ProviderDef {
        id: "llamacpp",
        label: "llama.cpp (local)",
        base_url: "http://localhost:8080/v1",
        // llama-server serves whatever model was loaded at launch.
        default_model: "",
        needs_key: false,
        env: &[],
    },
    ProviderDef {
        id: "koboldcpp",
        label: "KoboldCpp (local)",
        base_url: "http://localhost:5001/v1",
        default_model: "",
        needs_key: false,
        env: &[],
    },
    ProviderDef {
        id: "sglang",
        label: "SGLang (local)",
        base_url: "http://localhost:30000/v1",
        default_model: "",
        needs_key: false,
        env: &[],
    },
];

/// Look up a provider by id.
pub fn find(id: &str) -> Option<&'static ProviderDef> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// API key from the provider's environment variables, if any is set.
/// Checked in `env` preference order; empty/whitespace values are
/// skipped (some launchers export placeholders).
pub fn env_key(provider: &ProviderDef) -> Option<String> {
    provider
        .env
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

/// Resolve the key used for a direct request: the key stored in
/// settings wins (explicit user choice), otherwise the provider's
/// environment variables. Empty when neither source has a key — callers
/// decide whether that is fatal (remote providers) or fine (local).
pub fn resolve_key(stored: &str, provider: &ProviderDef) -> String {
    let stored = stored.trim();
    if !stored.is_empty() {
        return stored.to_string();
    }
    env_key(provider).unwrap_or_default()
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
    fn stored_key_beats_env_key() {
        std::env::set_var("PRISM_TEST_OPENAI_KEY", "env-value");
        let fake = ProviderDef {
            id: "openai",
            label: "OpenAI",
            base_url: "",
            default_model: "",
            needs_key: true,
            env: &["PRISM_TEST_OPENAI_KEY"],
        };
        assert_eq!(resolve_key("  sk-stored  ", &fake), "sk-stored");
    }

    #[test]
    fn env_key_used_when_no_stored_key() {
        std::env::set_var("PRISM_TEST_GROQ_KEY", "gsk-env");
        let fake = ProviderDef {
            id: "groq",
            label: "Groq",
            base_url: "",
            default_model: "",
            needs_key: true,
            env: &["PRISM_TEST_GROQ_KEY"],
        };
        assert_eq!(resolve_key("", &fake), "gsk-env");
        assert_eq!(resolve_key("   ", &fake), "gsk-env");
    }

    #[test]
    fn env_fallback_skips_blank_and_uses_preference_order() {
        std::env::set_var("PRISM_TEST_FIRST_KEY", "  ");
        std::env::set_var("PRISM_TEST_SECOND_KEY", "second");
        let fake = ProviderDef {
            id: "x",
            label: "X",
            base_url: "",
            default_model: "",
            needs_key: true,
            env: &["PRISM_TEST_FIRST_KEY", "PRISM_TEST_SECOND_KEY"],
        };
        assert_eq!(resolve_key("", &fake), "second");
    }

    #[test]
    fn no_sources_yields_empty_key() {
        let fake = ProviderDef {
            id: "y",
            label: "Y",
            base_url: "",
            default_model: "",
            needs_key: true,
            env: &["PRISM_TEST_MISSING_KEY_DEFINITELY_NOT_SET"],
        };
        std::env::remove_var("PRISM_TEST_MISSING_KEY_DEFINITELY_NOT_SET");
        assert_eq!(resolve_key("", &fake), "");
    }

    #[test]
    fn local_providers_declare_no_env() {
        for p in PROVIDERS.iter().filter(|p| !p.needs_key) {
            assert!(
                p.env.is_empty(),
                "{} is local; env auth is for remote",
                p.id
            );
        }
    }

    #[test]
    fn remote_providers_declare_env() {
        for p in PROVIDERS.iter().filter(|p| p.needs_key) {
            assert!(!p.env.is_empty(), "{} is remote; must list env names", p.id);
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
