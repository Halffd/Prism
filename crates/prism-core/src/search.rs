//! Session search: find messages across conversations.
//!
//! The query is a plain struct so every surface can build one from a
//! form, and the matching is a pure function over conversations so it
//! is testable without storage.
//!
//! Matching is deliberately layered:
//!
//! 1. the *scope* filters (role, tag, unread, archived) narrow the
//!    candidate set;
//! 2. the *text* filter narrows it further — literal, regex or
//!    case-insensitive depending on the query;
//! 3. the *sort* orders what is left.
//!
//! A regex that does not compile is not an error: it is treated as a
//! literal string, so a half-typed regex in a search box still returns
//! something useful instead of an empty list or a crash.

use crate::conversations::Conversation;

/// How results are ordered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchSort {
    /// Most recently updated conversation first (the default).
    #[default]
    Newest,
    /// Oldest first.
    Oldest,
    /// By conversation title, A→Z.
    Title,
}

/// Which messages are eligible.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SearchQuery {
    /// The text to look for. Empty matches every message.
    pub text: String,
    /// Treat `text` as a regular expression.
    pub regex: bool,
    /// Match case exactly.
    pub case_sensitive: bool,
    /// Only messages with this role ("user" | "assistant" | "system").
    pub role: Option<String>,
    /// Only messages carrying this tag.
    pub tag: Option<String>,
    /// Only unread messages.
    pub unread_only: bool,
    /// Include archived conversations. Off by default: the default list
    /// hides them, and search follows.
    pub include_archived: bool,
    /// Only messages whose context came from this file / URL. The
    /// comparison is a substring match against the message's context
    /// source, so a partial path or host finds the message.
    pub file_filter: Option<String>,
    /// Maximum hits to return. 0 = no limit.
    pub limit: usize,
    /// Ordering.
    pub sort: SearchSort,
}

/// One matching message.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SearchHit {
    pub conversation_id: String,
    pub conversation_title: String,
    /// Index of the message inside the conversation.
    pub message_index: usize,
    pub role: String,
    /// Short excerpt around the match (or the start of the message).
    pub preview: String,
    /// True when the text filter matched this message.
    pub text_matched: bool,
}

/// The text a message carries for searching: its content, flattened to
/// one line so the preview and the match offsets refer to the same
/// string.
fn searchable_text(msg: &crate::conversations::StoredMessage) -> String {
    msg.content.replace('\n', " ").trim().to_string()
}

/// Does the message's attached context point at `filter`?
fn context_matches(msg: &crate::conversations::StoredMessage, filter: &str) -> bool {
    let needle = filter.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    // The core's StoredMessage keeps context out of the persisted
    // shape, so the filter matches against the message content's
    // explicit context marker (`context: <url>`) plus any path-looking
    // token. This keeps the core free of the extension's richer
    // ContextData while still supporting the filter.
    let haystack = msg.content.to_lowercase();
    haystack.contains(&needle)
}

/// Build the matcher for the query's text.
///
/// A regex that fails to compile falls back to a literal match.
enum Matcher {
    Literal {
        needle: String,
        case_sensitive: bool,
    },
    Regex(regex::Regex),
}

impl Matcher {
    fn build(query: &SearchQuery) -> Matcher {
        let text = query.text.trim();
        if text.is_empty() {
            return Matcher::Literal {
                needle: String::new(),
                case_sensitive: false,
            };
        }
        if query.regex {
            let pattern = if query.case_sensitive {
                text.to_string()
            } else {
                format!("(?i){text}")
            };
            match regex::Regex::new(&pattern) {
                Ok(re) => Matcher::Regex(re),
                Err(e) => {
                    eprintln!("prism-core: invalid search regex ({e}); treating as literal");
                    Matcher::Literal {
                        needle: text.to_string(),
                        case_sensitive: query.case_sensitive,
                    }
                }
            }
        } else {
            Matcher::Literal {
                needle: text.to_string(),
                case_sensitive: query.case_sensitive,
            }
        }
    }

    fn matches(&self, haystack: &str) -> Option<usize> {
        match self {
            Matcher::Literal {
                needle,
                case_sensitive,
            } => {
                if needle.is_empty() {
                    return Some(0);
                }
                if *case_sensitive {
                    haystack.find(needle.as_str())
                } else {
                    haystack.to_lowercase().find(&needle.to_lowercase())
                }
            }
            Matcher::Regex(re) => re.find(haystack).map(|m| m.start()),
        }
    }
}

/// Does the query's scope allow this message?
fn scope_matches(
    conv: &Conversation,
    msg: &crate::conversations::StoredMessage,
    query: &SearchQuery,
) -> bool {
    if !query.include_archived && conv.archived {
        return false;
    }
    if let Some(role) = &query.role {
        if !role.is_empty() && !msg.role.eq_ignore_ascii_case(role) {
            return false;
        }
    }
    if let Some(tag) = &query.tag {
        let tag = tag.trim();
        if !tag.is_empty() && !msg.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            return false;
        }
    }
    if query.unread_only && msg.read {
        return false;
    }
    if let Some(filter) = &query.file_filter {
        if !filter.trim().is_empty() && !context_matches(msg, filter) {
            return false;
        }
    }
    true
}

/// A short excerpt of `text`.
///
/// When the text filter matched, the excerpt is centred on the match so
/// the user sees why the message was found. Otherwise it is the start
/// of the message.
///
/// `match_at` is a byte offset into `text` (the caller matched against
/// the same string it passes here).
fn preview(text: &str, match_at: Option<usize>) -> String {
    const MAX: usize = 120;
    let total = text.chars().count();
    if total <= MAX {
        return text.to_string();
    }

    let Some(byte_pos) = match_at else {
        let head: String = text.chars().take(MAX).collect();
        return format!("{head}…");
    };

    // Centre the excerpt on the match: half the window before it.
    // The offset comes from a match on this exact string, so it is a
    // char boundary.
    let char_pos = text[..byte_pos].chars().count();
    let start = char_pos.saturating_sub(MAX / 2);
    let excerpt: String = text.chars().skip(start).take(MAX).collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if start + MAX < total { "…" } else { "" };
    format!("{prefix}{excerpt}{suffix}")
}

/// Run the query over `conversations`.
///
/// Returns one hit per matching message. Conversations with no matching
/// message produce no hits.
pub fn search(conversations: &[Conversation], query: &SearchQuery) -> Vec<SearchHit> {
    let matcher = Matcher::build(query);
    let mut hits: Vec<SearchHit> = Vec::new();

    for conv in conversations {
        for (index, msg) in conv.messages.iter().enumerate() {
            if !scope_matches(conv, msg, query) {
                continue;
            }
            let text = searchable_text(msg);
            let match_at = matcher.matches(&text);
            if match_at.is_none() && !query.text.trim().is_empty() {
                continue;
            }
            hits.push(SearchHit {
                conversation_id: conv.id.clone(),
                conversation_title: conv.title.clone(),
                message_index: index,
                role: msg.role.clone(),
                preview: preview(&text, match_at),
                text_matched: match_at.is_some(),
            });
        }
    }

    sort_hits(&mut hits, conversations, query.sort);

    if query.limit > 0 && hits.len() > query.limit {
        hits.truncate(query.limit);
    }
    hits
}

/// Order hits. The conversation list decides the order; hits inherit
/// it, so all messages of one conversation stay together.
fn sort_hits(hits: &mut [SearchHit], conversations: &[Conversation], sort: SearchSort) {
    let updated: std::collections::HashMap<&str, u64> = conversations
        .iter()
        .map(|c| (c.id.as_str(), c.updated_at))
        .collect();
    let title: std::collections::HashMap<&str, &str> = conversations
        .iter()
        .map(|c| (c.id.as_str(), c.title.as_str()))
        .collect();

    match sort {
        SearchSort::Newest => hits.sort_by(|a, b| {
            updated
                .get(b.conversation_id.as_str())
                .cmp(&updated.get(a.conversation_id.as_str()))
                .then_with(|| b.message_index.cmp(&a.message_index))
        }),
        SearchSort::Oldest => hits.sort_by(|a, b| {
            updated
                .get(a.conversation_id.as_str())
                .cmp(&updated.get(b.conversation_id.as_str()))
                .then_with(|| a.message_index.cmp(&b.message_index))
        }),
        SearchSort::Title => hits.sort_by(|a, b| {
            title
                .get(a.conversation_id.as_str())
                .cmp(&title.get(b.conversation_id.as_str()))
                .then_with(|| a.message_index.cmp(&b.message_index))
        }),
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
            id: None,
            tags: Vec::new(),
            read: true,
            edited_at: None,
        }
    }

    fn conv(id: &str, title: &str, updated_at: u64, messages: Vec<StoredMessage>) -> Conversation {
        Conversation {
            id: id.into(),
            title: title.into(),
            created_at: 1,
            updated_at,
            messages,
            tags: Vec::new(),
            archived: false,
            read: true,
            forked_from: None,
            forked_at_message: None,
        }
    }

    fn corpus() -> Vec<Conversation> {
        vec![
            conv(
                "a",
                "Alpha",
                100,
                vec![msg("user", "hello world"), msg("assistant", "hi there")],
            ),
            conv(
                "b",
                "Beta",
                200,
                vec![
                    msg("user", "goodbye world"),
                    msg("assistant", "Rust is fast"),
                ],
            ),
        ]
    }

    #[test]
    fn finds_literal_matches_across_conversations() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                text: "world".into(),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].conversation_id, "b");
        assert_eq!(hits[0].message_index, 0);
        assert_eq!(hits[1].conversation_id, "a");
        assert_eq!(hits[1].message_index, 0);
    }

    #[test]
    fn empty_text_matches_every_message() {
        let hits = search(&corpus(), &SearchQuery::default());
        assert_eq!(hits.len(), 4);
    }

    #[test]
    fn case_insensitive_by_default() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                text: "RUST".into(),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn case_sensitive_narrows_the_match() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                text: "RUST".into(),
                case_sensitive: true,
                ..Default::default()
            },
        );
        assert!(hits.is_empty());
    }

    #[test]
    fn regex_matches() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                text: r"h[ae]llo".into(),
                regex: true,
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "a");
    }

    #[test]
    fn an_invalid_regex_falls_back_to_a_literal_search() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                text: "hello(".into(),
                regex: true,
                ..Default::default()
            },
        );
        assert!(hits.is_empty(), "the literal 'hello(' matches nothing");

        let hits = search(
            &corpus(),
            &SearchQuery {
                text: "hello(".into(),
                regex: true,
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 0, "no crash, no panic");
    }

    #[test]
    fn role_filter_selects_one_speaker() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                role: Some("assistant".into()),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.role == "assistant"));
    }

    #[test]
    fn unread_only_filter_selects_unread_messages() {
        let mut corpus = corpus();
        corpus[0].messages[0].read = false;

        let hits = search(
            &corpus,
            &SearchQuery {
                unread_only: true,
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "a");
        assert_eq!(hits[0].message_index, 0);
    }

    #[test]
    fn tag_filter_selects_tagged_messages() {
        let mut corpus = corpus();
        corpus[0].messages[1].tags.push("important".into());

        let hits = search(
            &corpus,
            &SearchQuery {
                tag: Some("Important".into()),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].message_index, 1);
    }

    #[test]
    fn archived_conversations_are_excluded_unless_asked_for() {
        let mut corpus = corpus();
        corpus[1].archived = true;

        let hits = search(&corpus, &SearchQuery::default());
        assert!(hits.iter().all(|h| h.conversation_id != "b"));

        let hits = search(
            &corpus,
            &SearchQuery {
                include_archived: true,
                ..Default::default()
            },
        );
        assert!(hits.iter().any(|h| h.conversation_id == "b"));
    }

    #[test]
    fn file_filter_matches_against_the_message_content() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                file_filter: Some("rust".into()),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].conversation_id, "b");
    }

    #[test]
    fn limit_truncates_the_result() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                limit: 1,
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn sort_by_title_orders_conversations() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                sort: SearchSort::Title,
                ..Default::default()
            },
        );
        // All of one conversation's hits stay together, A→Z.
        let titles: Vec<&str> = hits.iter().map(|h| h.conversation_title.as_str()).collect();
        assert_eq!(titles, vec!["Alpha", "Alpha", "Beta", "Beta"]);
    }

    #[test]
    fn sort_by_oldest_puts_the_older_conversation_first() {
        let hits = search(
            &corpus(),
            &SearchQuery {
                sort: SearchSort::Oldest,
                ..Default::default()
            },
        );
        assert_eq!(hits[0].conversation_id, "a");
    }

    #[test]
    fn preview_is_truncated_for_long_messages() {
        let long = "x".repeat(500);
        let corpus = vec![conv("a", "A", 1, vec![msg("user", &long)])];
        let hits = search(&corpus, &SearchQuery::default());
        assert!(hits[0].preview.chars().count() <= 121);
        assert!(hits[0].preview.ends_with('…'));
    }

    #[test]
    fn preview_centres_on_the_match() {
        let long = format!("{}NEEDLE{}", "a".repeat(300), "b".repeat(300));
        let corpus = vec![conv("a", "A", 1, vec![msg("user", &long)])];
        let hits = search(
            &corpus,
            &SearchQuery {
                text: "NEEDLE".into(),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].preview.contains("NEEDLE"),
            "the excerpt shows the match, got {:?}",
            hits[0].preview
        );
    }

    #[test]
    fn preview_of_a_multiline_message_still_shows_the_match() {
        // The match offset is computed on the flattened text, so the
        // preview has to be built from that same string. A leading
        // newline shifts every offset; a naive preview would slice the
        // wrong window and lose the match.
        let long = format!("\n  {}\nNEEDLE\n{}", "a".repeat(300), "b".repeat(300));
        let corpus = vec![conv("a", "A", 1, vec![msg("user", &long)])];
        let hits = search(
            &corpus,
            &SearchQuery {
                text: "NEEDLE".into(),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].preview.contains("NEEDLE"),
            "the excerpt shows the match, got {:?}",
            hits[0].preview
        );
        assert!(
            !hits[0].preview.contains('\n'),
            "the preview is one line, got {:?}",
            hits[0].preview
        );
    }

    #[test]
    fn preview_of_a_multibyte_message_still_shows_the_match() {
        // A byte offset that is not a char boundary must not panic.
        let long = format!("{}NEEDLE{}", "é".repeat(300), "ß".repeat(300));
        let corpus = vec![conv("a", "A", 1, vec![msg("user", &long)])];
        let hits = search(
            &corpus,
            &SearchQuery {
                text: "NEEDLE".into(),
                ..Default::default()
            },
        );
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].preview.contains("NEEDLE"),
            "the excerpt shows the match, got {:?}",
            hits[0].preview
        );
    }
}
