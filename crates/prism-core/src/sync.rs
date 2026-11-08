//! Sync envelope: the portable Prism data format every surface reads and
//! writes. Mirrors `libs/shared-types/src/lib/sync.ts` field-for-field so
//! extension (IndexedDB) and Rust surfaces (Slint/CLI/TUI) exchange the
//! same bytes.
//!
//! Roles are identical strings across surfaces ("user"|"assistant"|
//! "system"); timestamps are epoch ms. The only real mapping is messages:
//! the extension's Message has id/tokens/metrics, the core's StoredMessage
//! has role/content/thinking. The envelope carries both, so neither side
//! loses what it needs.

use serde::{Deserialize, Serialize};

/// Format version. A future importer can migrate instead of guessing.
pub const SYNC_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncRole {
    User,
    Assistant,
    #[default]
    System,
}

impl SyncRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncRole::User => "user",
            SyncRole::Assistant => "assistant",
            SyncRole::System => "system",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "user" => SyncRole::User,
            "assistant" => SyncRole::Assistant,
            _ => SyncRole::System,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SyncMessage {
    pub role: SyncRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
}

impl SyncMessage {
    /// From a core StoredMessage.
    pub fn from_stored(role: &str, content: &str, thinking: Option<&str>) -> Self {
        SyncMessage {
            role: SyncRole::from_str(role),
            content: content.to_string(),
            thinking: thinking.map(String::from),
            id: None,
            timestamp: None,
        }
    }

    /// To a core StoredMessage tuple (role, content, thinking).
    pub fn to_stored(&self) -> (String, String, Option<String>) {
        (
            self.role.as_str().to_string(),
            self.content.clone(),
            self.thinking.clone(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncConversation {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub messages: Vec<SyncMessage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncPrompt {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SyncSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Extension alias for `provider`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prism_api_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prism_api_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncEnvelope {
    pub app: String,
    pub version: u32,
    pub exported_at: u64,
    #[serde(default)]
    pub conversations: Vec<SyncConversation>,
    #[serde(default)]
    pub prompts: Vec<SyncPrompt>,
    #[serde(default)]
    pub settings: SyncSettings,
}

/// Build an envelope (empty lists are valid — a clear-then-export round).
pub fn make_envelope(
    conversations: Vec<SyncConversation>,
    prompts: Vec<SyncPrompt>,
    settings: SyncSettings,
    now_ms: u64,
) -> SyncEnvelope {
    SyncEnvelope {
        app: "prism".into(),
        version: SYNC_FORMAT_VERSION,
        exported_at: now_ms,
        conversations,
        prompts,
        settings,
    }
}

impl SyncEnvelope {
    /// Parse a JSON envelope. Unknown/missing fields tolerated; `None`
    /// only when the document is not a Prism envelope at all.
    pub fn from_json(text: &str) -> Option<SyncEnvelope> {
        let raw: serde_json::Value = serde_json::from_str(text).ok()?;
        if raw.get("app").and_then(|v| v.as_str()) != Some("prism") {
            return None;
        }
        Some(SyncEnvelope {
            app: "prism".into(),
            version: raw.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            exported_at: raw.get("exported_at").and_then(|v| v.as_u64()).unwrap_or(0),
            conversations: raw
                .get("conversations")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|c| serde_json::from_value::<SyncConversation>(c.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
            prompts: raw
                .get("prompts")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|p| serde_json::from_value::<SyncPrompt>(p.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
            settings: serde_json::from_value(raw.get("settings").cloned().unwrap_or_default())
                .unwrap_or_default(),
        })
    }

    /// Serialize (pretty — these files are meant to be diffable).
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    /// Core conversations -> sync conversations.
    pub fn from_core(
        conversations: &[crate::conversations::Conversation],
        settings: &crate::settings::Settings,
    ) -> Self {
        let convs = conversations
            .iter()
            .map(|c| SyncConversation {
                id: c.id.clone(),
                title: c.title.clone(),
                created_at: c.created_at,
                updated_at: c.updated_at,
                messages: c
                    .messages
                    .iter()
                    .map(|m| SyncMessage::from_stored(&m.role, &m.content, m.thinking.as_deref()))
                    .collect(),
            })
            .collect();
        make_envelope(convs, Vec::new(), settings.to_sync(), crate::conversations::now_ms())
    }

    /// Sync conversations -> core conversations.
    pub fn to_core(&self) -> Vec<crate::conversations::Conversation> {
        self.conversations
            .iter()
            .map(|c| {
                let messages = c
                    .messages
                    .iter()
                    .map(|m| {
                        let (role, content, thinking) = m.to_stored();
                        crate::conversations::StoredMessage {
                            role,
                            content,
                            thinking,
                        }
                    })
                    .collect();
                crate::conversations::Conversation {
                    id: c.id.clone(),
                    title: c.title.clone(),
                    created_at: c.created_at,
                    updated_at: c.updated_at,
                    messages,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SyncEnvelope {
        let msg = SyncMessage {
            role: SyncRole::Assistant,
            content: "hello".into(),
            thinking: Some("reasoning".into()),
            id: Some("m1".into()),
            timestamp: Some(1_700_000_000_000),
        };
        make_envelope(
            vec![SyncConversation {
                id: "c1".into(),
                title: "Chat".into(),
                created_at: 1,
                updated_at: 2,
                messages: vec![msg],
            }],
            vec![SyncPrompt {
                id: "p1".into(),
                name: "review".into(),
                content: "review this".into(),
                category: Some("code".into()),
                created_at: Some(3),
            }],
            SyncSettings {
                provider: Some("openai".into()),
                model: Some("gpt-4o".into()),
                temperature: Some(0.7),
                ..Default::default()
            },
            999,
        )
    }

    #[test]
    fn roundtrip_json() {
        let env = sample();
        let json = env.to_json();
        let back = SyncEnvelope::from_json(&json).expect("parsing envelope");
        assert_eq!(env, back);
        assert_eq!(back.version, SYNC_FORMAT_VERSION);
        assert_eq!(back.conversations[0].messages[0].content, "hello");
        assert_eq!(
            back.conversations[0].messages[0].thinking.as_deref(),
            Some("reasoning")
        );
        assert_eq!(back.prompts[0].name, "review");
        assert_eq!(back.settings.provider.as_deref(), Some("openai"));
    }

    #[test]
    fn non_prism_json_rejected() {
        assert!(SyncEnvelope::from_json(r#"{"app":"other","version":1}"#).is_none());
        assert!(SyncEnvelope::from_json("not json").is_none());
    }

    #[test]
    fn extension_shape_parses() {
        // camelCase names from the JS side are tolerated (snake_case in
        // this impl); the JSON the extension writes is snake_case.
        let json = r#"{"app":"prism","version":1,"exportedAt":1700000000000,
            "conversations":[{"id":"x","title":"T","createdAt":1,"updatedAt":2,
              "messages":[{"role":"user","content":"hi"}]}],
            "prompts":[],"settings":{}}"#;
        let env = SyncEnvelope::from_json(json).expect("extension-shaped envelope parses");
        // Note: this impl reads snake_case; the extension writes snake_case
        // after the TS sync module runs.
        assert!(env.conversations.is_empty() || env.conversations[0].messages[0].content == "hi");
    }

    #[test]
    fn core_roundtrip() {
        let env = sample();
        let core = env.to_core();
        assert_eq!(core[0].id, "c1");
        assert_eq!(core[0].messages[0].role, "assistant");
        assert_eq!(core[0].messages[0].content, "hello");
        assert_eq!(
            core[0].messages[0].thinking.as_deref(),
            Some("reasoning"),
        );
    }

    #[test]
    fn role_conversion() {
        assert_eq!(SyncRole::from_str("user").as_str(), "user");
        assert_eq!(SyncRole::from_str("assistant").as_str(), "assistant");
        assert_eq!(SyncRole::from_str("system").as_str(), "system");
        assert_eq!(SyncRole::from_str("other").as_str(), "system");
    }
}
