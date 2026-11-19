//! Local backup: export conversations to a portable file and import
//! them back.
//!
//! The format is deliberately close to the cross-surface sync envelope
//! (`crate::sync`) so a backup file can also be read by other Prism
//! surfaces, but it is a separate type: a backup keeps the full
//! conversation shape (including tags, archive state and fork links)
//! and carries its own version, so it can evolve without touching the
//! sync format.
//!
//! Import is strict on purpose. A file that is not a Prism backup, or
//! one written by a newer Prism, is rejected with a reason the user can
//! read — a half-imported history is worse than a clear refusal.

use crate::conversations::{Conversation, StoredMessage};

/// Version of the backup format written by this build.
pub const BACKUP_FORMAT_VERSION: u32 = 1;

/// The marker every Prism file carries.
pub const BACKUP_APP: &str = "prism";

/// One conversation inside a backup file.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BackupConversation {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub messages: Vec<StoredMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default = "default_read")]
    pub read: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_at_message: Option<usize>,
}

fn default_read() -> bool {
    true
}

/// A complete backup file.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BackupEnvelope {
    /// Always `BACKUP_APP`.
    pub app: String,
    /// Format version. A newer version is refused on import.
    pub version: u32,
    /// Unix epoch millis of the export.
    pub exported_at: u64,
    pub conversations: Vec<BackupConversation>,
}

/// What happened to an import.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ImportOutcome {
    /// The file was read. `migrated` is true when the file used an
    /// older format version that was upgraded on the way in.
    Imported { count: usize, migrated: bool },
    /// The file is not a Prism backup, or is damaged.
    Corrupt { reason: String },
    /// The file was written by a newer Prism than this build.
    Unsupported { version: u32 },
}

impl ImportOutcome {
    /// Is this a successful import?
    pub fn is_ok(&self) -> bool {
        matches!(self, ImportOutcome::Imported { .. })
    }
}

impl From<BackupConversation> for Conversation {
    fn from(b: BackupConversation) -> Self {
        Conversation {
            id: b.id,
            title: b.title,
            created_at: b.created_at,
            updated_at: b.updated_at,
            messages: b.messages,
            tags: b.tags,
            archived: b.archived,
            read: b.read,
            forked_from: b.forked_from,
            forked_at_message: b.forked_at_message,
        }
    }
}

impl From<&Conversation> for BackupConversation {
    fn from(c: &Conversation) -> Self {
        BackupConversation {
            id: c.id.clone(),
            title: c.title.clone(),
            created_at: c.created_at,
            updated_at: c.updated_at,
            messages: c.messages.clone(),
            tags: c.tags.clone(),
            archived: c.archived,
            read: c.read,
            forked_from: c.forked_from.clone(),
            forked_at_message: c.forked_at_message,
        }
    }
}

/// Build a backup envelope from conversations.
pub fn export_backup(conversations: &[Conversation], now_ms: u64) -> BackupEnvelope {
    BackupEnvelope {
        app: BACKUP_APP.to_string(),
        version: BACKUP_FORMAT_VERSION,
        exported_at: now_ms,
        conversations: conversations.iter().map(BackupConversation::from).collect(),
    }
}

/// Serialise a backup to JSON text.
pub fn export_json(
    conversations: &[Conversation],
    now_ms: u64,
) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&export_backup(conversations, now_ms))
}

/// Parse and validate a backup file.
///
/// Returns the conversations in the file. On failure the reason is
/// carried in the outcome rather than in an error string, so callers
/// can show it directly.
pub fn parse_backup(raw: &str) -> Result<Vec<Conversation>, ImportOutcome> {
    parse_backup_versioned(raw).map(|(convs, _)| convs)
}

/// Parse a backup and report whether the file needed migrating.
///
/// The migration flag comes from the file's own version field, not
/// from sniffing the text.
fn parse_backup_versioned(raw: &str) -> Result<(Vec<Conversation>, bool), ImportOutcome> {
    let envelope: BackupEnvelope =
        serde_json::from_str(raw).map_err(|e| ImportOutcome::Corrupt {
            reason: format!("not a readable Prism backup: {e}"),
        })?;

    if envelope.app != BACKUP_APP {
        return Err(ImportOutcome::Corrupt {
            reason: format!("this file is not a Prism backup (app = {:?})", envelope.app),
        });
    }

    if envelope.version > BACKUP_FORMAT_VERSION {
        return Err(ImportOutcome::Unsupported {
            version: envelope.version,
        });
    }

    // Version 0 predates the versioned envelope; it was accepted by
    // early builds. Migrate it by filling in the missing fields.
    let migrated = envelope.version < BACKUP_FORMAT_VERSION;

    Ok((
        envelope
            .conversations
            .into_iter()
            .map(Conversation::from)
            .collect(),
        migrated,
    ))
}

/// Import a backup file, replacing or merging with existing
/// conversations.
///
/// Merge keeps the existing conversation when both sides have the same
/// id and the existing one is newer.
pub fn import_backup(
    raw: &str,
    existing: &mut Vec<Conversation>,
    mode: ImportMode,
) -> Result<ImportOutcome, ImportOutcome> {
    let (imported, migrated) = parse_backup_versioned(raw)?;
    let count = imported.len();

    match mode {
        ImportMode::Replace => {
            *existing = imported;
        }
        ImportMode::Merge => {
            for conv in imported {
                match existing.iter_mut().find(|c| c.id == conv.id) {
                    Some(current) if current.updated_at >= conv.updated_at => {
                        // Keep the newer one.
                    }
                    Some(current) => *current = conv,
                    None => existing.push(conv),
                }
            }
            existing.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        }
    }

    Ok(ImportOutcome::Imported { count, migrated })
}

/// How an import combines with what is already stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    /// Replace everything with the file's contents.
    Replace,
    /// Add new conversations; keep the newer of the two on an id clash.
    Merge,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(content: &str) -> StoredMessage {
        StoredMessage {
            role: "user".into(),
            content: content.into(),
            thinking: None,
            id: None,
            tags: Vec::new(),
            read: true,
            edited_at: None,
        }
    }

    fn conv(id: &str, updated_at: u64) -> Conversation {
        Conversation {
            id: id.into(),
            title: format!("Chat {id}"),
            created_at: 1,
            updated_at,
            messages: vec![msg("hello")],
            tags: vec!["tag".into()],
            archived: true,
            read: false,
            forked_from: Some("other".into()),
            forked_at_message: Some(3),
        }
    }

    #[test]
    fn export_then_import_roundtrips() {
        let conversations = vec![conv("a", 10), conv("b", 20)];
        let json = export_json(&conversations, 99).unwrap();

        let imported = parse_backup(&json).unwrap();
        assert_eq!(imported.len(), 2);
        assert_eq!(imported, conversations);
    }

    #[test]
    fn the_envelope_carries_the_app_and_version() {
        let envelope = export_backup(&[conv("a", 1)], 42);
        assert_eq!(envelope.app, "prism");
        assert_eq!(envelope.version, BACKUP_FORMAT_VERSION);
        assert_eq!(envelope.exported_at, 42);
    }

    #[test]
    fn a_non_prism_file_is_rejected() {
        let err = parse_backup(r#"{"hello":"world"}"#).unwrap_err();
        assert!(matches!(err, ImportOutcome::Corrupt { .. }));
    }

    #[test]
    fn a_newer_version_is_refused() {
        let json = format!(r#"{{"app":"prism","version":99,"exported_at":0,"conversations":[]}}"#);
        let err = parse_backup(&json).unwrap_err();
        assert_eq!(err, ImportOutcome::Unsupported { version: 99 });
    }

    #[test]
    fn a_damaged_file_is_rejected_with_a_reason() {
        let err = parse_backup("{not json").unwrap_err();
        match err {
            ImportOutcome::Corrupt { reason } => assert!(!reason.is_empty()),
            other => panic!("expected corrupt, got {other:?}"),
        }
    }

    #[test]
    fn replace_mode_swaps_everything_out() {
        let mut existing = vec![conv("old", 1)];
        let json = export_json(&[conv("new", 2)], 1).unwrap();

        let outcome = import_backup(&json, &mut existing, ImportMode::Replace).unwrap();
        assert!(outcome.is_ok());
        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].id, "new");
    }

    #[test]
    fn merge_mode_keeps_the_newer_copy_of_a_clashing_conversation() {
        let mut existing = vec![conv("a", 500)];
        let json = export_json(&[conv("a", 100), conv("b", 200)], 1).unwrap();

        import_backup(&json, &mut existing, ImportMode::Merge).unwrap();
        assert_eq!(existing.len(), 2);
        assert_eq!(
            existing.iter().find(|c| c.id == "a").unwrap().updated_at,
            500,
            "the newer stored copy wins"
        );
    }

    #[test]
    fn merge_mode_takes_the_file_copy_when_it_is_newer() {
        let mut existing = vec![conv("a", 100)];
        let json = export_json(&[conv("a", 500)], 1).unwrap();

        import_backup(&json, &mut existing, ImportMode::Merge).unwrap();
        assert_eq!(
            existing.iter().find(|c| c.id == "a").unwrap().updated_at,
            500
        );
    }
}
