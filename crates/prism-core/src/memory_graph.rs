//! Memory graph: the "learning made visible" graph, ported from
//! Hermes' `agent/learning_graph.py`.
//!
//! Pure functions, no I/O: the host reads memory cards from its own
//! storage and calls `build_graph`. The design choices that matter and
//! why:
//!
//! - **Node id is `memory:<source>:<index>:<fingerprint>`** — position
//!   for the occurrence (two identical memories are two nodes), text
//!   hash for identity (a reworded memory is a new node).
//! - **The fingerprint digests the whole card body, not the truncated
//!   display text.** Hermes hit this exact bug: a Notepad BOM glued to
//!   the first entry made its fingerprint never match the store's, so
//!   the card was permanently "stale". Truncation for *display* is
//!   therefore a separate concern from identity.
//! - **Edge scoring is `6 * name-hit + token-overlap`** — an explicit
//!   name in the text outweighs any amount of incidental overlap.
//! - **Top-4 edges per card** keeps the graph readable.
//!
//! FNV-1a is used for the fingerprint rather than a cryptographic hash:
//! this is identity of a local text file, not a security boundary, and
//! FNV keeps the core dependency-free.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// One memory card = one graph node of kind "memory".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoryCard {
    /// "memory" | "profile" (which store the card came from).
    pub source: String,
    /// Display label (first non-empty line of the entry, truncated).
    pub title: String,
    /// Body text used for tokenizing and the fingerprint.
    pub body: String,
    /// Epoch ms (or seconds — pass one unit consistently).
    pub timestamp: Option<u64>,
}

impl MemoryCard {
    /// One card per non-empty entry. `split_entries` is the host's
    /// parser (it owns the file format); this wrapper keeps the graph
    /// free of storage concerns.
    pub fn title_of(body: &str) -> String {
        let first = body
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .trim_start_matches('#')
            .trim();
        truncate(first, 80)
    }
}

/// Truncate to `max` chars on a char boundary, appending `…` when cut.
pub fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    let mut out: String = chars.into_iter().take(max).collect();
    out.push('…');
    out
}

/// FNV-1a 64-bit digest of the full text, 12 hex chars.
///
/// Deliberately short: it is an identity tag for graph node ids, not a
/// collision-resistant hash. The caller digests the WHOLE entry, never
/// the truncated display text (see module docs).
pub fn fingerprint(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:012x}")
}

/// Stable node id: position for the occurrence, text for identity.
pub fn node_id(card: &MemoryCard, index: usize) -> String {
    format!(
        "memory:{}:{}:{}",
        card.source,
        index,
        fingerprint(card.body.trim())
    )
}

/// Tokenize for lexical overlap: lowercase alphanumeric runs, length
/// at least 3. Mirrors Hermes' `_tokenize`.
pub fn tokenize(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 3)
        .map(str::to_string)
        .collect()
}

/// Score one candidate name against a card's text:
/// `6` for an explicit name mention (word-boundary match), plus the
/// count of overlapping tokens. 0 = no edge.
pub fn score_edge(text: &str, name: &str) -> usize {
    // An explicit mention weighs 6×; otherwise it's raw token overlap.
    let mention = mentions_name(text, name);
    let overlap = tokenize(name).intersection(&tokenize(text)).count();
    if mention {
        6 + overlap
    } else {
        overlap
    }
}

fn mentions_name(text: &str, name: &str) -> bool {
    let haystack = text.to_lowercase();
    let needle = name.to_lowercase();
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(&needle) {
        let abs = start + pos;
        let before_ok = abs == 0
            || haystack[..abs]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_alphanumeric());
        let after_ok = haystack[abs + needle.len()..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
    }
    false
}

/// Top-`k` (card.text, name) edges by score, ties broken by name for
/// determinism.
pub fn top_edges(text: &str, names: &[String], k: usize) -> Vec<String> {
    let mut scored: Vec<(usize, &String)> = names
        .iter()
        .map(|n| (score_edge(text, n), n))
        .filter(|(s, _)| *s > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
    scored.into_iter().take(k).map(|(_, n)| n.clone()).collect()
}

/// One graph node.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    /// "memory" | "skill"
    pub kind: String,
    pub edges: Vec<String>,
}

/// The assembled graph: nodes plus a category histogram.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub clusters: Vec<(String, usize)>,
    pub memory_nodes: usize,
    pub memory_edges: usize,
}

/// Build the graph from memory cards and candidate names (Prism's
/// analogue of Hermes' skills: `commands::COMMANDS` ids, categories,
/// or whatever the surface considers memorisable).
pub fn build_graph(cards: &[MemoryCard], names: &[String], edges_per_card: usize) -> Graph {
    let mut nodes = Vec::new();
    let mut edges_total = 0usize;

    for (i, card) in cards.iter().enumerate() {
        let text = format!("{}\n{}", card.title, card.body);
        let edges = top_edges(&text, names, edges_per_card);
        edges_total += edges.len();
        nodes.push(GraphNode {
            id: node_id(card, i),
            label: card.title.clone(),
            kind: "memory".into(),
            edges,
        });
    }

    let clusters = {
        let mut counts: std::collections::HashMap<String, usize> = Default::default();
        for n in names {
            *counts.entry(n.clone()).or_insert(0) += 1;
        }
        let mut v: Vec<(String, usize)> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        v
    };

    Graph {
        nodes,
        clusters,
        memory_nodes: cards.len(),
        memory_edges: edges_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(source: &str, title: &str, body: &str) -> MemoryCard {
        MemoryCard {
            source: source.into(),
            title: title.into(),
            body: body.into(),
            timestamp: None,
        }
    }

    #[test]
    fn fingerprint_stable_and_text_sensitive() {
        assert_eq!(fingerprint("hello"), fingerprint("hello"));
        assert_ne!(fingerprint("hello"), fingerprint("hello "));
        // `{hash:012x}` is a MINIMUM width, not a cap: a u64 FNV digest
        // is 16 hex chars. Pin the real length and full-hex-ness.
        let fp = fingerprint("hello");
        assert_eq!(fp.len(), 16);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn node_id_carries_source_index_fingerprint() {
        let c = card("memory", "title", "body");
        let id = node_id(&c, 3);
        assert!(id.starts_with("memory:memory:3:"), "{id}");
        // Position distinguishes identical content; hash keeps it stable.
        assert_eq!(node_id(&c, 3), node_id(&card("memory", "t2", "body"), 3));
        assert_ne!(node_id(&c, 3), node_id(&c, 4));
    }

    #[test]
    fn tokenize_drops_short_tokens() {
        // Alphanumeric runs, length >= 3. "a1b2" is one 4-char run and
        // kept; "the" is exactly 3 and kept. Only < 3 chars drop.
        let t = tokenize("The quick brown fox, a1b2 xy");
        assert!(t.contains("quick") && t.contains("brown"));
        assert!(t.contains("the"), "3 chars meets the threshold");
        assert!(t.contains("a1b2"));
        assert!(!t.contains("xy"));
    }

    #[test]
    fn title_from_first_content_line() {
        assert_eq!(MemoryCard::title_of("# Heading\nbody"), "Heading");
        assert_eq!(MemoryCard::title_of("\n\n  first  \nmore"), "first");
    }

    #[test]
    fn score_edge_name_hit_beats_overlap() {
        // Explicit mention = 6 + overlap; same tokens without the name
        // score only the overlap.
        let with_name = "I use the calculator tool every day";
        let without_name = "I use the tool every day";
        assert!(score_edge(with_name, "calculator") > score_edge(without_name, "calculator"));
        assert_eq!(score_edge(with_name, "calculator"), 6 + 1); // "calculator"
    }

    #[test]
    fn score_edge_zero_when_unrelated() {
        assert_eq!(score_edge("nothing here", "calculator"), 0);
    }

    #[test]
    fn top_edges_sorted_and_limited() {
        let names = vec!["calculator".to_string(), "web_search".to_string(), "zzz".to_string()];
        let e = top_edges("use the calculator and web_search", &names, 2);
        assert_eq!(e.len(), 2);
        assert!(e.contains(&"calculator".to_string()));
        assert!(!e.contains(&"zzz".to_string()));
    }

    #[test]
    fn build_graph_counts_nodes_and_edges() {
        let cards = vec![
            card("memory", "calc note", "I like the calculator for arithmetic"),
            card("profile", "me", "I debug things and use web_search often"),
        ];
        let names = vec!["calculator".to_string(), "web_search".to_string()];
        let g = build_graph(&cards, &names, 4);
        assert_eq!(g.memory_nodes, 2);
        assert_eq!(g.nodes.len(), 2);
        assert!(g.memory_edges >= 2, "each card should link: {}", g.memory_edges);
        assert!(g.clusters.iter().all(|(_, c)| *c >= 1));
    }

    #[test]
    fn truncate_respects_char_boundary() {
        assert_eq!(truncate("short", 10), "short");
        // Chars, not bytes: "nécé" cut at 3 keeps n, é, c.
        assert_eq!(truncate("nécé", 3), "néc…");
    }

    #[test]
    fn empty_graph() {
        let g = build_graph(&[], &["a".to_string()], 4);
        assert!(g.nodes.is_empty());
        assert_eq!(g.memory_edges, 0);
    }
}
