//! Transcript surgery: fork, overwrite, edit.
//!
//! All of these operate on a conversation's message vector and return
//! the new state. They are pure functions over data (no I/O, no clock
//! of their own) so every surface — Slint, the extension, the API —
//! gets identical behaviour, and so the rules are testable without a
//! browser or a filesystem.
//!
//! The three operations answer three different user intents:
//!
//! - **fork** — "try a different answer from here": branch a new
//!   conversation that keeps everything up to a point.
//! - **overwrite** — "that answer was wrong, replace it and continue":
//!   change one message and drop what came after it, because the rest
//!   of the transcript was a response to the old text.
//! - **edit** — "fix a typo": change one message and keep the rest.

use crate::conversations::{Conversation, StoredMessage};

/// What a fork does with the source conversation's tail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForkMode {
    /// Keep the source untouched; the fork is a new conversation.
    Branch,
    /// Rewrite the source in place: the tail after the branch point is
    /// replaced by the fork's messages. Used for "retry this message
    /// differently" inside one conversation.
    Overwrite,
}

/// The index a fork branches at, clamped into range.
fn clamp_index(index: usize, len: usize) -> usize {
    index.min(len.saturating_sub(1))
}

/// Branch a copy of `conv` that contains messages `0..=at_index`.
///
/// The new conversation gets a fresh id, records where it came from
/// (`forked_from` / `forked_at_message`), and starts unread so the user
/// sees it as new. `source` is left untouched.
pub fn fork_branch(
    conv: &Conversation,
    at_index: usize,
    new_id: String,
    now_ms: u64,
) -> Conversation {
    let cut = clamp_index(at_index, conv.messages.len());
    let messages: Vec<StoredMessage> = if conv.messages.is_empty() {
        Vec::new()
    } else {
        conv.messages[..=cut].to_vec()
    };
    Conversation {
        id: new_id,
        title: fork_title(&conv.title),
        created_at: now_ms,
        updated_at: now_ms,
        messages,
        tags: conv.tags.clone(),
        archived: false,
        read: false,
        forked_from: Some(conv.id.clone()),
        forked_at_message: Some(cut),
    }
}

/// Rewrite `conv` in place so that it holds `replacement` at
/// `at_index` and nothing after it.
///
/// This is "overwrite this message and everything downstream is stale".
/// The messages before the cut are kept as they are; the tail is
/// dropped because it was an answer to the text that was replaced.
pub fn overwrite_at(conv: &mut Conversation, at_index: usize, replacement: &str, now_ms: u64) {
    let Some(message) = conv.messages.get_mut(at_index) else {
        return;
    };
    message.content = replacement.to_string();
    message.edited_at = Some(now_ms);
    // The stale tail goes: it answered the old text.
    conv.messages.truncate(at_index + 1);
    conv.updated_at = now_ms;
}

/// Replace one message's content, keeping the rest of the transcript.
pub fn edit_message(conv: &mut Conversation, index: usize, new_content: &str, now_ms: u64) {
    let Some(message) = conv.messages.get_mut(index) else {
        return;
    };
    message.content = new_content.to_string();
    message.edited_at = Some(now_ms);
    conv.updated_at = now_ms;
}

/// Drop every message after `index` (keeping the message itself).
pub fn truncate_after(conv: &mut Conversation, index: usize, now_ms: u64) {
    if index + 1 >= conv.messages.len() {
        return;
    }
    conv.messages.truncate(index + 1);
    conv.updated_at = now_ms;
}

/// Toggle a message's read flag; returns the new value.
pub fn set_message_read(conv: &mut Conversation, index: usize, read: bool) -> bool {
    match conv.messages.get_mut(index) {
        Some(message) => {
            message.read = read;
            read
        }
        None => false,
    }
}

/// Add a tag to a message (no duplicates). Returns true when the tag
/// was added.
pub fn add_message_tag(conv: &mut Conversation, index: usize, tag: &str) -> bool {
    let tag = tag.trim();
    if tag.is_empty() {
        return false;
    }
    let Some(message) = conv.messages.get_mut(index) else {
        return false;
    };
    if message.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        return false;
    }
    message.tags.push(tag.to_string());
    true
}

/// Remove a tag from a message. Returns true when a tag was removed.
pub fn remove_message_tag(conv: &mut Conversation, index: usize, tag: &str) -> bool {
    let Some(message) = conv.messages.get_mut(index) else {
        return false;
    };
    let before = message.tags.len();
    message.tags.retain(|t| !t.eq_ignore_ascii_case(tag));
    before != message.tags.len()
}

/// Fork title: the source title plus a marker, so a list of forks is
/// still recognisable.
fn fork_title(source: &str) -> String {
    let base = source.trim();
    if base.is_empty() {
        "Fork".to_string()
    } else {
        format!("{base} (fork)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversations::StoredMessage;

    fn msg(role: &str, content: &str) -> StoredMessage {
        StoredMessage {
            role: role.into(),
            content: content.into(),
            thinking: None,
            id: Some(format!("m-{content}")),
            tags: Vec::new(),
            read: true,
            edited_at: None,
        }
    }

    fn conv() -> Conversation {
        Conversation {
            id: "src".into(),
            title: "Root".into(),
            created_at: 1,
            updated_at: 1,
            messages: vec![
                msg("user", "one"),
                msg("assistant", "two"),
                msg("user", "three"),
                msg("assistant", "four"),
            ],
            tags: vec!["keep".into()],
            archived: false,
            read: true,
            forked_from: None,
            forked_at_message: None,
        }
    }

    #[test]
    fn branch_keeps_the_prefix_and_links_back() {
        let source = conv();
        let fork = fork_branch(&source, 1, "fork-id".into(), 500);

        assert_eq!(fork.id, "fork-id");
        assert_eq!(fork.messages.len(), 2);
        assert_eq!(fork.messages[1].content, "two");
        assert_eq!(fork.forked_from.as_deref(), Some("src"));
        assert_eq!(fork.forked_at_message, Some(1));
        assert_eq!(fork.tags, vec!["keep".to_string()]);
        assert!(!fork.read, "a fresh fork is unread");
        assert!(!fork.archived);
        assert_eq!(fork.updated_at, 500);
        // The source is untouched.
        assert_eq!(source.messages.len(), 4);
    }

    #[test]
    fn branch_clamps_an_out_of_range_index() {
        let source = conv();
        let fork = fork_branch(&source, 99, "f".into(), 1);
        assert_eq!(fork.messages.len(), 4);
        assert_eq!(fork.forked_at_message, Some(3));
    }

    #[test]
    fn branch_on_an_empty_conversation_yields_an_empty_fork() {
        let mut source = conv();
        source.messages.clear();
        let fork = fork_branch(&source, 0, "f".into(), 1);
        assert!(fork.messages.is_empty());
    }

    #[test]
    fn overwrite_replaces_the_message_and_drops_the_tail() {
        let mut c = conv();
        overwrite_at(&mut c, 1, "replaced", 900);

        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[1].content, "replaced");
        assert_eq!(c.messages[1].edited_at, Some(900));
        assert_eq!(c.updated_at, 900);
    }

    #[test]
    fn overwrite_ignores_an_out_of_range_index() {
        let mut c = conv();
        overwrite_at(&mut c, 99, "nope", 900);
        assert_eq!(c.messages.len(), 4);
        assert_eq!(c.updated_at, 1);
    }

    #[test]
    fn edit_keeps_the_rest_of_the_transcript() {
        let mut c = conv();
        edit_message(&mut c, 2, "THREE", 800);

        assert_eq!(c.messages.len(), 4);
        assert_eq!(c.messages[2].content, "THREE");
        assert_eq!(c.messages[2].edited_at, Some(800));
        assert_eq!(c.messages[3].content, "four", "the tail survives an edit");
    }

    #[test]
    fn truncate_after_keeps_the_message_itself() {
        let mut c = conv();
        truncate_after(&mut c, 1, 700);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[1].content, "two");
    }

    #[test]
    fn truncate_after_on_the_last_message_is_a_no_op() {
        let mut c = conv();
        truncate_after(&mut c, 3, 700);
        assert_eq!(c.messages.len(), 4);
        assert_eq!(c.updated_at, 1);
    }

    #[test]
    fn message_tags_are_added_and_removed_case_insensitively() {
        let mut c = conv();
        assert!(add_message_tag(&mut c, 0, "Important"));
        assert!(!add_message_tag(&mut c, 0, "important"), "no duplicates");
        assert_eq!(c.messages[0].tags, vec!["Important".to_string()]);

        assert!(remove_message_tag(&mut c, 0, "IMPORTANT"));
        assert!(c.messages[0].tags.is_empty());
        assert!(!remove_message_tag(&mut c, 0, "important"));
    }

    #[test]
    fn empty_tags_are_rejected() {
        let mut c = conv();
        assert!(!add_message_tag(&mut c, 0, "   "));
        assert!(c.messages[0].tags.is_empty());
    }

    #[test]
    fn read_state_is_set_per_message() {
        let mut c = conv();
        assert!(!set_message_read(&mut c, 0, false));
        assert!(!c.messages[0].read);
        assert!(set_message_read(&mut c, 0, true));
        assert!(c.messages[0].read);
    }
}
