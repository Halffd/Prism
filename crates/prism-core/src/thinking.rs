//! Extended thinking via `<thinking>` scratchpad tags.
//!
//! Rust port of `libs/ai-adapters/src/thinking.ts` — same instruction,
//! same injection point (first user message), same strip semantics.

use crate::client::ChatMessage;

pub const SCRATCH_INSTRUCTION: &str = "Before answering, reason through the problem step by step inside <thinking></thinking> tags, then give the final answer after the closing tag.";

const OPEN_TAG: &str = "<thinking>";
const CLOSE_TAG: &str = "</thinking>";

/// Prepend the scratchpad instruction to the first user message.
/// Returns a new vector; does not mutate the input.
/// Mirrors `applyThinkingToMessages` (the TS caller gates on `enabled`).
pub fn apply_thinking_to_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut result = messages.to_vec();
    if let Some(first_user) = result.iter_mut().find(|m| m.role == "user") {
        first_user.content = format!("{}\n\n{}", SCRATCH_INSTRUCTION, first_user.content);
    }
    result
}

/// Extract `<thinking>…</thinking>` from a response and return the cleaned
/// final content plus the reasoning text (first block only, blocks removed
/// everywhere). Mirrors `stripThinkingFromContent`: an unclosed tag means
/// no extraction and the content passes through untouched.
pub fn strip_thinking(content: &str) -> (String, Option<String>) {
    if !content.contains(OPEN_TAG) {
        return (content.to_string(), None);
    }
    let Some(open) = content.find(OPEN_TAG) else {
        return (content.to_string(), None);
    };
    let inner_start = open + OPEN_TAG.len();
    let Some(close_rel) = content[inner_start..].find(CLOSE_TAG) else {
        // Unclosed tag: the TS regex cannot match either.
        return (content.to_string(), None);
    };
    let thinking = content[inner_start..inner_start + close_rel]
        .trim()
        .to_string();

    // Remove every `<thinking>…</thinking>` block plus the whitespace that
    // immediately follows the closing tag, then trim (matches the TS
    // global replace of `/<thinking>[\s\S]*?<\/thinking>\s*/`).
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(pos) = rest.find(OPEN_TAG) {
        out.push_str(&rest[..pos]);
        let after_open = &rest[pos + OPEN_TAG.len()..];
        match after_open.find(CLOSE_TAG) {
            Some(close) => {
                rest = &after_open[close + CLOSE_TAG.len()..];
                rest = rest.trim_start();
            }
            None => {
                // Unterminated trailing tag: keep the remainder verbatim.
                out.push_str(&rest[pos..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    (out.trim().to_string(), Some(thinking))
}

/// Display-time split for streaming UI: if the content starts with a
/// thinking block, return `(Some(thinking_text), answer_so_far)`.
/// An unclosed block means everything after the open tag is still
/// reasoning, so the answer is empty. Unlike `strip_thinking`, this
/// only looks at a leading block — enough for rendering, cheap per frame.
pub fn split_display(content: &str) -> (Option<&str>, &str) {
    let Some(after_open) = content.strip_prefix(OPEN_TAG) else {
        return (None, content);
    };
    match after_open.find(CLOSE_TAG) {
        Some(close) => {
            let thinking = after_open[..close].trim();
            let answer = after_open[close + CLOSE_TAG.len()..].trim_start();
            (Some(thinking), answer)
        }
        None => (Some(after_open.trim()), ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
        }
    }

    #[test]
    fn apply_prepends_to_first_user_message_only() {
        let messages = vec![
            msg("system", "be brief"),
            msg("assistant", "hi"),
            msg("user", "what is 2+2"),
        ];
        let applied = apply_thinking_to_messages(&messages);
        assert_eq!(applied[0].content, "be brief");
        assert_eq!(applied[1].content, "hi");
        assert_eq!(
            applied[2].content,
            format!("{}\n\nwhat is 2+2", SCRATCH_INSTRUCTION)
        );
        // Input untouched.
        assert_eq!(messages[2].content, "what is 2+2");
    }

    #[test]
    fn apply_without_user_message_is_noop() {
        let messages = vec![msg("system", "be brief")];
        let applied = apply_thinking_to_messages(&messages);
        assert_eq!(applied[0].content, "be brief");
    }

    #[test]
    fn strip_single_block() {
        let (content, thinking) =
            strip_thinking("<thinking> 2+2 is 4. </thinking>The answer is 4.");
        assert_eq!(content, "The answer is 4.");
        assert_eq!(thinking.as_deref(), Some("2+2 is 4."));
    }

    #[test]
    fn strip_multiple_blocks_keeps_first_reasoning() {
        let (content, thinking) = strip_thinking(
            "<thinking>first</thinking>\nanswer one <thinking>second</thinking> answer two",
        );
        assert_eq!(content, "answer one answer two");
        assert_eq!(thinking.as_deref(), Some("first"));
    }

    #[test]
    fn strip_unclosed_tag_passes_through() {
        let raw = "<thinking>still reasoning and streaming";
        let (content, thinking) = strip_thinking(raw);
        assert_eq!(content, raw);
        assert_eq!(thinking, None);
    }

    #[test]
    fn strip_without_tag_passthrough() {
        let (content, thinking) = strip_thinking("plain answer");
        assert_eq!(content, "plain answer");
        assert_eq!(thinking, None);
    }

    #[test]
    fn display_split_closed_block() {
        let (thinking, answer) = split_display("<thinking>why</thinking>because");
        assert_eq!(thinking, Some("why"));
        assert_eq!(answer, "because");
    }

    #[test]
    fn display_split_unclosed_block_shows_all_as_thinking() {
        let (thinking, answer) = split_display("<thinking>partial reasoning");
        assert_eq!(thinking, Some("partial reasoning"));
        assert_eq!(answer, "");
    }

    #[test]
    fn display_split_plain_content() {
        let (thinking, answer) = split_display("just an answer");
        assert_eq!(thinking, None);
        assert_eq!(answer, "just an answer");
    }
}
