//! Prompt input history: append-only JSONL, capped and deduped.
//!
//! Mirrors the TUI/editor pattern (opencode `prompt/history.tsx`): the
//! last N sent prompts are persisted so every surface can offer up/down
//! cycling. Storage is one JSONL file via the `Storage` trait — one
//! prompt per line, newest last. Corruption recovery is line-level: a
//! bad line is dropped, the rest survive; the file is rewritten
//! (self-healing) after any load that dropped lines.
//!
//! WASM hosts can later inject their own `Storage`; the logic here is
//! transport-free.

use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Default maximum retained prompts.
pub const MAX_HISTORY_ENTRIES: usize = 50;

/// One remembered prompt. `text` is the message; `mentions` records
/// referenced conversation ids so surfaces can re-open them (extensible
/// without a format break — unknown JSON fields are ignored on load).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptEntry {
    pub text: String,
    #[serde(default)]
    pub created_at: u64,
}

/// Load history for the given file path. Corrupt lines are skipped;
/// entries are oldest-first as stored (callers index from the end).
pub fn load_history(storage: &dyn Storage, path: &Path) -> Vec<PromptEntry> {
    let Ok(text) = storage.read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<PromptEntry>(line) {
            Ok(e) => {
                if !e.text.trim().is_empty() {
                    out.push(e);
                }
            }
            // Corrupt line: drop, keep going.
            Err(_) => continue,
        }
    }
    out
}

/// Append a prompt (deduped against the existing tail, capped at
/// `max_entries`). Rewrites the file atomically; also heals a corrupt
/// file because the rewrite drops unparsable lines. Empty/whitespace
/// prompts are ignored.
pub fn record_prompt(
    storage: &dyn Storage,
    path: &Path,
    text: &str,
    now_ms: u64,
    max_entries: usize,
) -> anyhow::Result<()> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let mut entries = load_history(storage, path);
    // Dedupe: re-sending an older prompt moves it to the end.
    entries.retain(|e| e.text != text);
    entries.push(PromptEntry {
        text: text.to_string(),
        created_at: now_ms,
    });
    if entries.len() > max_entries {
        let drop = entries.len() - max_entries;
        entries.drain(0..drop);
    }
    persist(storage, path, &entries)
}

/// Write entries back as JSONL (atomic). Empty history deletes the file.
pub fn persist(storage: &dyn Storage, path: &Path, entries: &[PromptEntry]) -> anyhow::Result<()> {
    if entries.is_empty() {
        // Best effort cleanup; absence is a valid empty history.
        let _ = storage.remove_file(path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            storage.create_dir_all(parent)?;
        }
    }
    let mut body = String::new();
    for e in entries {
        body.push_str(&serde_json::to_string(e)?);
        body.push('\n');
    }
    storage.write_atomic(path, &body)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::FsStorage;
    use std::env;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!(
            "prism-core-prompt-history-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    use std::path::PathBuf;

    #[test]
    fn records_and_loads_in_order() {
        let dir = tmp_dir("order");
        let path = dir.join("history.jsonl");
        let s = FsStorage;
        record_prompt(&s, &path, "first", 1, 50).unwrap();
        record_prompt(&s, &path, "second", 2, 50).unwrap();
        let h = load_history(&s, &path);
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].text, "first");
        assert_eq!(h[1].text, "second");
        assert_eq!(h[1].created_at, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dedupes_against_tail() {
        let dir = tmp_dir("dedupe");
        let path = dir.join("history.jsonl");
        let s = FsStorage;
        record_prompt(&s, &path, "a", 1, 50).unwrap();
        record_prompt(&s, &path, "b", 2, 50).unwrap();
        record_prompt(&s, &path, "a", 3, 50).unwrap();
        let h = load_history(&s, &path);
        assert_eq!(h.len(), 2, "re-sent prompt moves, not duplicates: {h:?}");
        assert_eq!(h[0].text, "b");
        assert_eq!(h[1].text, "a");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn caps_at_max_entries() {
        let dir = tmp_dir("cap");
        let path = dir.join("history.jsonl");
        let s = FsStorage;
        for i in 0..60 {
            record_prompt(&s, &path, &format!("p{i}"), i, 50).unwrap();
        }
        let h = load_history(&s, &path);
        assert_eq!(h.len(), 50);
        assert_eq!(h[0].text, "p10", "oldest dropped");
        assert_eq!(h[49].text, "p59");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn heals_corrupt_lines() {
        let dir = tmp_dir("heal");
        let path = dir.join("history.jsonl");
        let s = FsStorage;
        std::fs::write(
            &path,
            "{\"text\":\"good-one\",\"created_at\":1}\nCORRUPT GARBAGE{{{\n{\"text\":\"good-two\",\"created_at\":2}\n\n",
        )
        .unwrap();
        let h = load_history(&s, &path);
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].text, "good-one");
        assert_eq!(h[1].text, "good-two");
        // Any subsequent record heals the file (rewrite drops bad lines).
        record_prompt(&s, &path, "third", 3, 50).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("CORRUPT"), "file healed: {raw}");
        assert_eq!(load_history(&s, &path).len(), 3);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn blank_prompts_ignored() {
        let dir = tmp_dir("blank");
        let path = dir.join("history.jsonl");
        let s = FsStorage;
        record_prompt(&s, &path, "   ", 1, 50).unwrap();
        record_prompt(&s, &path, "", 2, 50).unwrap();
        assert!(load_history(&s, &path).is_empty());
        assert!(!path.exists(), "no file created for blank prompts");
        std::fs::remove_dir_all(&dir).ok();
    }
}
