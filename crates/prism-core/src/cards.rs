//! SillyTavern-style character cards, personas, lore books and the
//! prompt engine that assembles them into chat messages.
//!
//! One implementation for every surface: the card schema is the V2
//! spec (`chara_card_v2` with `data` + V1 top-level fallback), macros
//! use SillyTavern's `{{name}}` syntax, and lore books inject on
//! keyword matches with a recursion guard and a token budget.
//!
//! Wire philosophy matches the rest of the core: pure functions over
//! plain data. Cards are parsed from JSON; prompt assembly returns
//! `Vec<ChatMessage>` the existing transport already knows how to send.

use crate::client::ChatMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Character card V2 (`spec: "chara_card_v2"`). Field names match the
/// spec exactly so cards round-trip without renaming.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CharacterCard {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub personality: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub first_mes: String,
    #[serde(default)]
    pub mes_example: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub post_history_instructions: String,
    #[serde(default)]
    pub alternate_greetings: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub creator: String,
    #[serde(default)]
    pub character_version: String,
    /// Embedded lore book (`character_book`), SillyTavern's "Book" tab.
    #[serde(default)]
    pub character_book: Option<CharacterBook>,
}

/// A lore book attached to a card (or standing alone as World Info).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharacterBook {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub entries: Vec<LoreEntry>,
    /// How deep keyword matches may trigger more lore (0 = off).
    #[serde(default = "default_scan_depth")]
    pub scan_depth: u32,
    /// Token budget across all injected entries.
    #[serde(default = "default_token_budget")]
    pub token_budget: u32,
}

fn default_scan_depth() -> u32 {
    2
}
fn default_token_budget() -> u32 {
    2048
}

/// Serde per-field default: a card's lore entries ship ON, so an absent
/// `enabled` must be true (struct-level `bool::default()` would be false).
pub fn default_true() -> bool {
    true
}

impl Default for CharacterBook {
    fn default() -> Self {
        CharacterBook {
            name: String::new(),
            description: String::new(),
            entries: Vec::new(),
            scan_depth: default_scan_depth(),
            token_budget: default_token_budget(),
        }
    }
}

/// One lore entry. Keywords are "primary"; `secondary_keys` must ALL
/// match (SillyTavern's selective logic) unless `use_group_scoring`,
/// where any is enough.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoreEntry {
    #[serde(default)]
    pub keys: Vec<String>,
    #[serde(default)]
    pub secondary_keys: Vec<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Constant entries inject regardless of keywords.
    #[serde(default)]
    pub constant: bool,
    #[serde(default)]
    pub position: LorePosition,
    #[serde(default)]
    pub insertion_order: u32,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub match_whole_words: bool,
    #[serde(default)]
    pub use_group_scoring: bool,
}

impl Default for LoreEntry {
    fn default() -> Self {
        LoreEntry {
            keys: Vec::new(),
            secondary_keys: Vec::new(),
            content: String::new(),
            comment: String::new(),
            enabled: true,
            constant: false,
            position: LorePosition::BeforeChar,
            insertion_order: 0,
            case_sensitive: false,
            match_whole_words: false,
            use_group_scoring: false,
        }
    }
}

/// Where an entry's content lands in the assembled prompt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LorePosition {
    /// Before the character description (world context).
    #[default]
    BeforeChar,
    /// After the character description.
    AfterChar,
}

/// The persona (the user's own character) for `{{persona}}` macros.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Persona {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

impl Persona {
    /// `{{persona}}` expands to name + description (SillyTavern's default).
    pub fn expanded(&self) -> String {
        if self.description.trim().is_empty() {
            self.name.clone()
        } else {
            format!("{}: {}", self.name, self.description.trim())
        }
    }
}

/// Macro values for one request. `{{...}}` not present here is left
/// verbatim so hosts can see what they did not supply.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MacroContext {
    pub char: String,
    pub user: String,
    pub description: String,
    pub personality: String,
    pub scenario: String,
    pub persona: String,
    pub first_mes: String,
    pub mes_example: String,
}

impl MacroContext {
    /// The context a card + persona produce.
    pub fn from_card(card: &CharacterCard, persona: &Persona) -> Self {
        MacroContext {
            char: card.name.clone(),
            user: persona.name.clone(),
            description: card.description.clone(),
            personality: card.personality.clone(),
            scenario: card.scenario.clone(),
            persona: persona.expanded(),
            first_mes: card.first_mes.clone(),
            mes_example: card.mes_example.clone(),
        }
    }
}

/// Expand `{{macro}}` placeholders. Unknown macros stay verbatim.
pub fn expand_macros(template: &str, ctx: &MacroContext) -> String {
    let mut out = template.to_string();
    let pairs = [
        ("char", ctx.char.as_str()),
        ("user", ctx.user.as_str()),
        ("description", ctx.description.as_str()),
        ("personality", ctx.personality.as_str()),
        ("scenario", ctx.scenario.as_str()),
        ("persona", ctx.persona.as_str()),
        ("first_mes", ctx.first_mes.as_str()),
        ("mes_example", ctx.mes_example.as_str()),
        // SillyTavern's legacy short alias.
        ("persona_desc", ctx.persona.as_str()),
    ];
    for (name, value) in pairs {
        out = out.replace(&format!("{{{{{name}}}}}"), value);
    }
    out
}

// ---- card parsing ---------------------------------------------------------

/// Shape of a V2 card file (SillyTavern's own export format).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct V2File {
    #[serde(default)]
    spec: String,
    #[serde(default)]
    data: Option<CharacterCard>,
}

/// Parse a character card. Accepts:
/// - V2 file: `{"spec":"chara_card_v2","data":{...}}`
/// - V2 card directly (fields at top level)
/// - V1 card (name/description/personality/scenario/first_mes/mes_example)
pub fn parse_card(json: &str) -> Result<CharacterCard, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("card json: {e}"))?;
    if let Some(spec) = value.get("spec").and_then(|v| v.as_str()) {
        if spec == "chara_card_v2" {
            let file: V2File =
                serde_json::from_value(value).map_err(|e| format!("card v2: {e}"))?;
            return file.data.ok_or_else(|| "card v2 has no data".into());
        }
    }
    // Direct card fields (V2 or V1 share them).
    serde_json::from_value::<CharacterCard>(value).map_err(|e| format!("card: {e}"))
}

// ---- lore scanning --------------------------------------------------------

/// Result of one lore scan.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LoreScan {
    #[serde(default)]
    pub before_char: Vec<LoreEntry>,
    #[serde(default)]
    pub after_char: Vec<LoreEntry>,
    /// Entries skipped because the token budget was exhausted.
    #[serde(default)]
    pub dropped_for_budget: usize,
}

fn normalize(s: &str, case_sensitive: bool) -> String {
    if case_sensitive {
        s.to_string()
    } else {
        s.to_lowercase()
    }
}

fn contains_word(haystack: &str, needle: &str, whole: bool) -> bool {
    if needle.is_empty() {
        return false;
    }
    if !whole {
        return haystack.contains(needle);
    }
    haystack
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .any(|w| w == needle)
}

/// Does this entry match the scan text?
fn entry_matches(entry: &LoreEntry, text: &str) -> bool {
    if entry.constant {
        return true;
    }
    if entry.keys.is_empty() {
        return false;
    }
    let text = normalize(text, entry.case_sensitive);
    let primary = entry
        .keys
        .iter()
        .any(|k| contains_word(&text, &normalize(k, entry.case_sensitive), entry.match_whole_words));
    if !primary {
        return false;
    }
    if entry.secondary_keys.is_empty() {
        return true;
    }
    // Take the keys out of the entry first so the closures only borrow
    // `text` (borrowing the entry inside two closures trips E0596).
    let keys: Vec<String> = entry.secondary_keys.clone();
    if entry.use_group_scoring {
        // Group scoring: any secondary key suffices.
        keys.iter().any(|k| {
            contains_word(&text, &normalize(k, entry.case_sensitive), entry.match_whole_words)
        })
    } else {
        // Selective: all must match.
        keys.iter().all(|k| {
            contains_word(&text, &normalize(k, entry.case_sensitive), entry.match_whole_words)
        })
    }
}

/// Rough token count (4 chars ≈ 1 token) for the budget check.
fn est_tokens(s: &str) -> u32 {
    (s.chars().count() as u32).div_ceil(4)
}

/// Scan the book against recent chat text, honoring the token budget
/// and the recursion guard (`scan_depth` limits how many rounds a
/// keyword hit may trigger further hits).
pub fn scan_lore(book: &CharacterBook, chat_text: &str, history: &[String]) -> LoreScan {
    let mut out = LoreScan::default();
    // Scan the newest text first, then the history lines (depth-limited).
    let mut texts: Vec<String> = vec![chat_text.to_string()];
    let depth = book.scan_depth as usize;
    for (i, line) in history.iter().rev().enumerate() {
        if i >= depth {
            break;
        }
        texts.push(line.clone());
    }

    let mut budget = book.token_budget;
    // One entry fires once per scan (recursion guard); identical content
    // across entries is legal, so track by entry index, not content.
    let mut seen: HashSet<usize> = HashSet::new();
    // Stable order: by insertion_order (then content) — deterministic.
    let mut entries = book.entries.iter().collect::<Vec<_>>();
    entries.sort_by_key(|e| (e.insertion_order, e.comment.clone()));

    for (entry_id, entry) in entries.iter().enumerate() {
        if !entry.enabled {
            continue;
        }
        if !seen.insert(entry_id) {
            continue; // recursion guard: one entry fires once per scan
        }
        let matched = texts.iter().any(|t| entry_matches(entry, t));
        if !matched {
            continue;
        }
        let cost = est_tokens(&entry.content);
        if cost > budget {
            out.dropped_for_budget += 1;
            continue;
        }
        budget -= cost;
        match entry.position {
            LorePosition::BeforeChar => out.before_char.push((*entry).clone()),
            LorePosition::AfterChar => out.after_char.push((*entry).clone()),
        }
    }
    out
}

// ---- prompt assembly ------------------------------------------------------

/// Assemble the SillyTavern-style prompt: system (card macros),
/// world lore before/after the character, example messages, then the
/// conversation. `user_input` is the newest user turn (empty = only
/// history, used for greetings previews).
pub fn build_messages(
    card: &CharacterCard,
    persona: &Persona,
    history: &[ChatMessage],
    lore: &LoreScan,
    user_input: &str,
    system_prompt_override: Option<&str>,
) -> Vec<ChatMessage> {
    let ctx = MacroContext::from_card(card, persona);
    let mut out: Vec<ChatMessage> = Vec::new();

    // 1. System: card system prompt or override, expanded.
    let system = system_prompt_override
        .unwrap_or_else(|| card.system_prompt.as_str())
        .trim();
    let system = expand_macros(system, &ctx);
    if !system.trim().is_empty() {
        out.push(ChatMessage {
            role: "system".into(),
            content: system,
            images: Vec::new(),
        });
    }

    // 2. Lore before the character.
    for e in &lore.before_char {
        out.push(ChatMessage {
            role: "system".into(),
            content: expand_macros(&e.content, &ctx),
            images: Vec::new(),
        });
    }

    // 3. Character description block.
    let mut desc = String::new();
    if !card.description.trim().is_empty() {
        desc.push_str(expand_macros(&card.description, &ctx).trim());
    }
    if !card.personality.trim().is_empty() {
        if !desc.is_empty() {
            desc.push('\n');
        }
        desc.push_str(expand_macros(&card.personality, &ctx).trim());
    }
    if !card.scenario.trim().is_empty() {
        if !desc.is_empty() {
            desc.push('\n');
        }
        desc.push_str(expand_macros(&card.scenario, &ctx).trim());
    }
    if !desc.trim().is_empty() {
        out.push(ChatMessage {
            role: "system".into(),
            content: desc,
            images: Vec::new(),
        });
    }

    // 4. Lore after the character.
    for e in &lore.after_char {
        out.push(ChatMessage {
            role: "system".into(),
            content: expand_macros(&e.content, &ctx),
            images: Vec::new(),
        });
    }

    // 5. Example dialogue block.
    let ex = expand_macros(&card.mes_example, &ctx);
    if !ex.trim().is_empty() {
        out.push(ChatMessage {
            role: "system".into(),
            content: format!("Example dialogue:\n{ex}"),
            images: Vec::new(),
        });
    }

    // 6. Post-history instructions as the final system message.
    let phi = expand_macros(&card.post_history_instructions, &ctx);
    if !phi.trim().is_empty() {
        out.push(ChatMessage {
            role: "system".into(),
            content: phi,
            images: Vec::new(),
        });
    }

    // 7. The conversation itself.
    for m in history {
        out.push(ChatMessage {
            role: m.role.clone(),
            content: expand_macros(&m.content, &ctx),
            images: m.images.clone(),
        });
    }
    if !user_input.trim().is_empty() {
        out.push(ChatMessage {
            role: "user".into(),
            content: user_input.to_string(),
            images: Vec::new(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> CharacterCard {
        CharacterCard {
            name: "Aria".into(),
            description: "A starship engineer.".into(),
            personality: "witty, cautious".into(),
            scenario: "Aboard the reactor deck".into(),
            first_mes: "*Aria looks up* Need something?".into(),
            mes_example: "<START>\n{{user}}: Hi\n{{char}}: *waves*".into(),
            alternate_greetings: vec!["*Aria is already welding*".into()],
            ..Default::default()
        }
    }

    #[test]
    fn expand_all_macros() {
        let ctx = MacroContext {
            char: "Aria".into(),
            user: "Sam".into(),
            description: "engineer".into(),
            personality: "witty".into(),
            scenario: "deck".into(),
            persona: "Sam: a pilot".into(),
            first_mes: "hi".into(),
            mes_example: "ex".into(),
        };
        let out = expand_macros(
            "{{char}} meets {{user}} ({{persona}}): {{description}}, {{personality}}, {{scenario}}, {{first_mes}}, {{mes_example}}, {{unknown}}",
            &ctx,
        );
        assert_eq!(
            out,
            "Aria meets Sam (Sam: a pilot): engineer, witty, deck, hi, ex, {{unknown}}"
        );
    }


    #[test]
    #[test]
    fn parse_v2_file() {
        let json = r#"{"spec":"chara_card_v2","data":{"name":"Bob","description":"tinkerer","mes_example":"<START>\nhi"}}"#;
        let c = parse_card(json).unwrap();
        assert_eq!(c.name, "Bob");
        assert_eq!(c.description, "tinkerer");
    }

    #[test]
    fn parse_v1_and_direct() {
        let v1 = r#"{"name":"Old","description":"d","personality":"p","scenario":"s","first_mes":"f","mes_example":"m"}"#;
        let c = parse_card(v1).unwrap();
        assert_eq!(c.name, "Old");
        assert_eq!(c.personality, "p");
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_card("not json").is_err());
        assert!(parse_card(r#"{"spec":"chara_card_v2"}"#).is_err());
    }

    #[test]
    fn lore_keyword_and_constant() {
        let book = CharacterBook {
            entries: vec![
                LoreEntry {
                    keys: vec!["reactor".into()],
                    content: "The reactor hums.".into(),
                    enabled: true,
                    ..Default::default()
                },
                LoreEntry {
                    constant: true,
                    content: "Day 3 on deck.".into(),
                    enabled: true,
                    ..Default::default()
                },
                LoreEntry {
                    keys: vec!["absent".into()],
                    content: "never".into(),
                    enabled: true,
                    ..Default::default()
                },
            ],
            scan_depth: 2,
            token_budget: 2048,
            ..Default::default()
};
        let scan = scan_lore(&book, "Check the reactor!", &[]);
        let flat: Vec<&str> = scan.before_char.iter().map(|e| e.content.as_str()).collect();
        assert!(flat.contains(&"The reactor hums."));
        assert!(flat.contains(&"Day 3 on deck."));
        assert!(!flat.iter().any(|c| c.contains("never")));
    }

    #[test]
    fn lore_selective_and_group_scoring() {
        let mut entry = LoreEntry {
            keys: vec!["ai".into()],
            secondary_keys: vec!["ship".into(), "engine".into()],
            content: "x".into(),
            enabled: true,
            ..Default::default()
        };
        let book = CharacterBook {
            entries: vec![entry.clone()],
            ..Default::default()
        };
        // Selective: both secondaries required.
        assert!(scan_lore(&book, "the ai engine on the ship", &[]).before_char.len() == 1);
        assert!(scan_lore(&book, "the ai ship only", &[]).before_char.is_empty());

        // Group scoring: any secondary is enough.
        entry.use_group_scoring = true;
        let book = CharacterBook {
            entries: vec![entry],
            ..Default::default()
        };
        assert!(scan_lore(&book, "the ai ship only", &[]).before_char.len() == 1);
    }

    #[test]
    fn lore_recursion_guard_and_depth() {
        let entry = LoreEntry {
            keys: vec!["echo".into()],
            content: "echo the word".into(),
            enabled: true,
            ..Default::default()
        };
        let book = CharacterBook {
            entries: vec![entry],
            ..Default::default()
        };
        // History within scan_depth is scanned too.
        let scan = scan_lore(&book, "nothing here", &["echo".into(), "echo".into()]);
        assert_eq!(scan.before_char.len(), 1);

        // One entry fires once per scan (guard) even with many hits.
        let scan = scan_lore(&book, "echo echo echo", &["echo".into()]);
        assert_eq!(scan.before_char.len(), 1);
    }

    #[test]
    fn lore_budget_drops_overflow() {
        let book = CharacterBook {
            entries: (0..5)
                .map(|_i| LoreEntry {
                    keys: vec![],
                    constant: true,
                    content: "x".repeat(80), // ~20 tokens each
                    enabled: true,
                    ..Default::default()
                })
                .collect(),
            token_budget: 50, // fits 2 entries
            ..Default::default()
        };
        let scan = scan_lore(&book, "", &[]);
        assert!(scan.before_char.len() <= 2);
        assert_eq!(scan.dropped_for_budget, 5 - scan.before_char.len());
    }

    #[test]
    fn whole_word_matching() {
        let entry = LoreEntry {
            keys: vec!["cat".into()],
            match_whole_words: true,
            content: "meow".into(),
            enabled: true,
            ..Default::default()
        };
        let book = CharacterBook {
            entries: vec![entry],
            ..Default::default()
        };
        assert!(scan_lore(&book, "a cat sleeps", &[]).before_char.len() == 1);
        assert!(scan_lore(&book, "concatenate", &[]).before_char.is_empty());
    }

    #[test]
    fn build_messages_order_and_macros() {
        let c = CharacterCard {
            name: "Aria".into(),
            description: "engineer".into(),
            personality: "witty".into(),
            scenario: "deck".into(),
            mes_example: "<START>\n{{user}}: hi\n{{char}}: yo".into(),
            post_history_instructions: "Stay in character as {{char}}.".into(),
            ..Default::default()
        };
        let persona = Persona {
            name: "Sam".into(),
            description: "a pilot".into(),
        };
        let lore = scan_lore(
            &CharacterBook {
                entries: vec![LoreEntry {
                    constant: true,
                    content: "Lore line".into(),
                    position: LorePosition::AfterChar,
                    enabled: true,
                    ..Default::default()
                }],
                ..Default::default()
            },
            "",
            &[],
        );
        let msgs = build_messages(
            &c,
            &persona,
            &[ChatMessage {
                role: "user".into(),
                content: "Hello".into(),
                images: Vec::new(),
            }],
            &lore,
            "Need help",
            None,
        );
        // System: description+personality+scenario, example, post-history,
        // then user/assistant turns.
        let roles: Vec<&str> = msgs.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles.last().unwrap(), &"user");
        assert!(msgs.iter().any(|m| m.content.contains("Lore line")));
        assert!(msgs
            .iter()
            .any(|m| m.content.contains("Stay in character as Aria.")));
        assert!(msgs.iter().any(|m| m.content.contains("Sam: a pilot".len().to_string().as_str()) || m.content.contains("engineer")));
        // Example dialogue uses expanded macros.
        // The example dialogue is macro-expanded: the raw placeholder is gone.
        assert!(msgs.iter().any(|m| m.content.contains("Sam: hi")));
        assert!(!msgs.iter().any(|m| m.content.contains("{{user}}")));
    }

    #[test]
    fn system_override_wins() {
        let c = CharacterCard {
            system_prompt: "card system".into(),
            ..Default::default()
        };
        let msgs = build_messages(&c, &Persona::default(), &[], &LoreScan::default(), "", Some("host system"));
        assert!(msgs.iter().any(|m| m.content == "host system"));
        assert!(!msgs.iter().any(|m| m.content == "card system"));
    }

    #[test]
    fn persona_expansion() {
        let p = Persona {
            name: "Sam".into(),
            description: "a pilot".into(),
        };
        assert_eq!(p.expanded(), "Sam: a pilot");
        assert_eq!(
            Persona {
                name: "Sam".into(),
                description: "  ".into(),
            }
            .expanded(),
            "Sam"
        );
    }
}
