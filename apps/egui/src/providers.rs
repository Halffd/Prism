//! Provider definitions for direct (OpenAI-compatible) connections.
//!
//! All direct providers are reached through an OpenAI-compatible
//! `/chat/completions` endpoint so one streaming client covers them:
//! OpenAI natively, Gemini via its OpenAI-compat layer, Qwen via
//! DashScope compatible-mode, and Ollama via its `/v1` API.

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
        id: "ollama",
        label: "Ollama (local)",
        base_url: "http://localhost:11434/v1",
        default_model: "llama3.2",
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
    fn all_provider_urls_are_absolute() {
        for p in PROVIDERS {
            assert!(p.base_url.starts_with("http"), "{}", p.id);
            assert!(!p.base_url.ends_with('/'), "{}", p.id);
        }
    }
}
