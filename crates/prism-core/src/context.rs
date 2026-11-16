//! Context management: what extra material rides along with a prompt.
//!
//! A request can carry more than the user's message: the page they are
//! looking at, a selected passage, a document they attached, a snippet
//! from another conversation. Those pieces have a cost — they eat the
//! model's context window — so the user needs to see them, switch them
//! off and trim them to fit.
//!
//! The budget rule is simple and predictable: items are admitted in
//! priority order until the budget is spent. Priority is explicit
//! (`priority`), so the caller decides what matters; ties keep their
//! original order, which is the order the user added them in.

/// One piece of context attached to a request.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ContextItem {
    /// Stable id (the extension uses the URL or a generated key).
    pub id: String,
    /// What it is: "page" | "selection" | "file" | "conversation" | ...
    pub kind: String,
    /// Short human label shown in the list.
    pub title: String,
    /// The text sent to the model.
    pub content: String,
    /// Estimated token cost of `content`.
    pub tokens: usize,
    /// Whether the item is included in the request.
    pub enabled: bool,
    /// Where it came from (URL, file path, conversation id).
    pub source: String,
    /// Lower numbers are admitted first when the budget is tight.
    /// 0 = highest priority.
    pub priority: i32,
}

impl ContextItem {
    /// A disabled item costs nothing.
    fn cost(&self) -> usize {
        if self.enabled {
            self.tokens
        } else {
            0
        }
    }
}

/// Rough token estimate.
///
/// 4 characters per token is the standard approximation for English
/// prose; CJK text is denser, so it is counted per character instead.
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let cjk = text.chars().filter(|c| is_cjk(*c)).count();
    let rest = text.chars().count() - cjk;
    // CJK: ~1 token per character. Latin: ~4 characters per token.
    cjk + rest.div_ceil(4)
}

/// Is this a CJK-ish character (Han, Hiragana, Katakana, Hangul)?
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x309F |   // Hiragana
        0x30A0..=0x30FF |   // Katakana
        0x3400..=0x4DBF |   // CJK extension A
        0x4E00..=0x9FFF |   // CJK unified
        0xAC00..=0xD7AF |   // Hangul syllables
        0xF900..=0xFAFF |   // CJK compatibility
        0x20000..=0x2FA1F  // CJK extensions B–F
    )
}

/// Trim `items` to fit `max_tokens`.
///
/// Only enabled items count against the budget. Items are admitted in
/// priority order (lowest number first); within one priority, the
/// original order is kept. An item that does not fit on its own is
/// skipped — a single oversized document must not block the rest.
///
/// The returned vector holds the items that fit, in their original
/// order, with the skipped ones disabled so the caller can show the
/// user what was dropped.
pub fn context_budget(items: &[ContextItem], max_tokens: usize) -> Vec<ContextItem> {
    let mut result: Vec<ContextItem> = items.to_vec();

    // Admit in priority order.
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by_key(|&i| (items[i].priority, i));

    let mut spent = 0usize;
    let mut admitted = vec![false; items.len()];

    for i in order {
        if !items[i].enabled {
            // Disabled items are carried through unchanged.
            admitted[i] = true;
            continue;
        }
        let cost = items[i].tokens;
        if spent + cost <= max_tokens {
            spent += cost;
            admitted[i] = true;
        }
    }

    for (i, kept) in admitted.iter().enumerate() {
        if !*kept {
            result[i].enabled = false;
        }
    }
    result
}

/// Total token cost of the enabled items.
pub fn enabled_tokens(items: &[ContextItem]) -> usize {
    items.iter().map(|i| i.cost()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, tokens: usize, priority: i32) -> ContextItem {
        ContextItem {
            id: id.into(),
            kind: "page".into(),
            title: id.into(),
            content: "x".repeat(tokens * 4),
            tokens,
            enabled: true,
            source: format!("https://example/{id}"),
            priority,
        }
    }

    #[test]
    fn empty_context_costs_nothing() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(context_budget(&[], 100).len(), 0);
    }

    #[test]
    fn token_estimate_is_about_four_characters_per_token() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens(&"a".repeat(400)), 100);
    }

    #[test]
    fn cjk_counts_one_token_per_character() {
        assert_eq!(estimate_tokens("日本語"), 3);
        assert_eq!(estimate_tokens("日a"), 2);
    }

    #[test]
    fn everything_fits_when_the_budget_is_large() {
        let items = vec![item("a", 10, 0), item("b", 20, 1)];
        let result = context_budget(&items, 1000);
        assert!(result.iter().all(|i| i.enabled));
    }

    #[test]
    fn the_budget_admits_items_in_priority_order() {
        let items = vec![item("low", 50, 5), item("high", 50, 0)];
        let result = context_budget(&items, 60);

        assert!(result[1].enabled, "high priority survives");
        assert!(!result[0].enabled, "low priority is dropped");
    }

    #[test]
    fn an_oversized_item_is_skipped_not_fatal() {
        let items = vec![item("huge", 1000, 0), item("small", 10, 1)];
        let result = context_budget(&items, 100);

        assert!(!result[0].enabled, "the huge item does not fit");
        assert!(result[1].enabled, "the small item still gets in");
    }

    #[test]
    fn disabled_items_are_kept_and_cost_nothing() {
        let mut items = vec![item("a", 10, 0), item("b", 10, 1)];
        items[1].enabled = false;

        let result = context_budget(&items, 20);
        assert!(result[0].enabled);
        assert!(!result[1].enabled, "still disabled");
        assert_eq!(enabled_tokens(&result), 10, "the disabled item costs nothing");
    }
    #[test]
    fn equal_priority_keeps_the_original_order() {
        let items = vec![item("a", 6, 0), item("b", 6, 0)];
        let result = context_budget(&items, 10);
        assert!(result[0].enabled);
        assert!(!result[1].enabled);
    }

    #[test]
    fn the_returned_order_matches_the_input_order() {
        let items = vec![item("a", 1, 9), item("b", 1, 0), item("c", 1, 5)];
        let result = context_budget(&items, 100);
        assert_eq!(
            result.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }
}
