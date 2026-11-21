//! The native, in-process chat engine.
//!
//! No model weights, no tokenizer downloads, no sockets: a deterministic,
//! seed-driven text engine that honours the knobs of the local chat
//! backends (temperature, top-p, max tokens, seed, stop sequences,
//! frequency/presence penalties). It is an offline preview engine, not a
//! neural inference runner, so chat works on any machine and the local
//! server can be tested end to end without external services.
//!
//! Everything here is a pure function over a [`GenerateRequest`]. The
//! same request (including the same seed) always produces the same text,
//! stream chunks, and finish reason.

use crate::client::{ChatMessage, StreamEvent};
use std::cmp::Ordering;
use std::collections::HashSet;

/// Model id advertised by the bundled local backend.
pub const MODEL_ID: &str = "prism-native";
/// Default generation cap when a host sends no `max_tokens`.
pub const DEFAULT_MAX_TOKENS: usize = 256;

/// A request to the in-process chat engine.
#[derive(Debug, Clone)]
pub struct GenerateRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: usize,
    pub seed: Option<u64>,
    pub stop: Vec<String>,
    pub frequency_penalty: f32,
    pub presence_penalty: f32,
}

impl Default for GenerateRequest {
    fn default() -> Self {
        Self {
            model: MODEL_ID.to_string(),
            messages: Vec::new(),
            temperature: 0.8,
            top_p: 1.0,
            max_tokens: DEFAULT_MAX_TOKENS,
            seed: None,
            stop: Vec::new(),
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
        }
    }
}

impl GenerateRequest {
    /// A request with the engine's defaults and an explicit model/message list.
    pub fn new(model: &str, messages: Vec<ChatMessage>) -> Self {
        Self {
            model: model.to_string(),
            messages,
            ..Self::default()
        }
    }

    /// A single-user-message request, useful for tests and previews.
    pub fn user(prompt: &str) -> Self {
        Self::new(MODEL_ID, vec![ChatMessage::text("user", prompt)])
    }
}

/// Completed text plus the metadata a chat API needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generated {
    pub text: String,
    /// Tokens in the returned text (`length` when the cap was reached).
    pub tokens: usize,
    /// `stop` or `length`.
    pub finish_reason: String,
    /// The request seed, or the generated one when none was supplied.
    pub seed: u64,
    pub model: String,
}

/// Generate text. Errors are validation failures (no messages, zero cap).
pub fn generate(req: &GenerateRequest) -> Result<Generated, String> {
    if req.messages.is_empty() {
        return Err("at least one message is required".to_string());
    }
    if req.max_tokens == 0 {
        return Err("max_tokens must be greater than zero".to_string());
    }

    let seed = resolve_seed(req);
    let mut rng = generation_seed(req);
    let plan = plan_for(req);
    let mut used: HashSet<String> = HashSet::new();
    let mut pieces = Vec::with_capacity(plan.segments.len());

    for alternatives in &plan.segments {
        let weighted = apply_penalties(
            alternatives,
            &used,
            req.frequency_penalty,
            req.presence_penalty,
        );
        let chosen = sample(&weighted, req.temperature, req.top_p, &mut rng);
        for word in words(&chosen) {
            used.insert(word);
        }
        pieces.push(chosen);
    }

    let tokens = tokenize(&pieces.join(plan.separator));
    let mut text = tokens.concat();
    let mut finish_reason = "stop".to_string();
    if tokens.len() > req.max_tokens {
        text = tokens[..req.max_tokens].concat();
        finish_reason = "length".to_string();
    }
    if let Some(cut) = earliest_stop(&text, &req.stop) {
        text.truncate(cut);
        finish_reason = "stop".to_string();
    }
    let text = text.trim_end().to_string();

    Ok(Generated {
        tokens: estimate_tokens(&text),
        text,
        finish_reason,
        seed,
        model: if req.model.trim().is_empty() {
            MODEL_ID.to_string()
        } else {
            req.model.trim().to_string()
        },
    })
}

/// Alias mirroring `native_sd::run` for callers that want one entry point.
pub fn run(req: &GenerateRequest) -> Result<Generated, String> {
    generate(req)
}

/// Split generated text into stream-safe chunks. Every chunk is a valid
/// `String`, so arbitrary chunk boundaries can never break UTF-8; joining
/// the chunks reproduces the generated text exactly.
pub fn stream_chunks(req: &GenerateRequest) -> Result<Vec<String>, String> {
    Ok(chunk_text(&generate(req)?.text))
}

/// Chunks plus the terminal [`StreamEvent::Done`].
pub fn stream_events(req: &GenerateRequest) -> Result<Vec<StreamEvent>, String> {
    let mut events: Vec<StreamEvent> = stream_chunks(req)?
        .into_iter()
        .map(StreamEvent::Chunk)
        .collect();
    events.push(StreamEvent::Done);
    Ok(events)
}

/// The request seed, or a time-derived one when the caller left it unset.
pub fn resolve_seed(req: &GenerateRequest) -> u64 {
    req.seed.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15)
    })
}

fn generation_seed(req: &GenerateRequest) -> u64 {
    let mut state = resolve_seed(req) ^ fnv1a(&req.model, 0x9E37_79B9_7F4A_7C15);
    for message in &req.messages {
        state ^= fnv1a(&message.role, 0xC2B2_AE3D_27D4_EB4F).rotate_left(7);
        state ^= fnv1a(&message.content, 0x517C_C1B7_2722_0A95).rotate_right(11);
    }
    state | 1
}

/// Whitespace-preserving tokens, used for caps and token counts.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut kind: Option<bool> = None; // true = whitespace
    for ch in text.chars() {
        let is_ws = ch.is_whitespace();
        if kind.is_some_and(|previous| previous != is_ws) {
            out.push(std::mem::take(&mut current));
        }
        kind = Some(is_ws);
        current.push(ch);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Approximate token count used by the preview engine and API `usage`.
pub fn estimate_tokens(text: &str) -> usize {
    tokenize(text).len()
}

/// Split already-generated text into stream-safe chunks.
pub fn chunk_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut in_word = false;
    for ch in text.chars() {
        current.push(ch);
        if ch.is_whitespace() {
            if in_word {
                chunks.push(std::mem::take(&mut current));
                in_word = false;
            }
            // Leading whitespace stays attached to the next word.
        } else {
            in_word = true;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn earliest_stop(text: &str, stops: &[String]) -> Option<usize> {
    stops
        .iter()
        .filter(|s| !s.is_empty())
        .filter_map(|s| text.find(s))
        .min()
}

fn apply_penalties(
    alternatives: &[(String, f64)],
    used: &HashSet<String>,
    frequency: f32,
    presence: f32,
) -> Vec<(String, f64)> {
    let frequency = frequency.max(0.0) as f64;
    let presence = presence.clamp(0.0, 0.95) as f64;
    alternatives
        .iter()
        .map(|(text, weight)| {
            let mut weight = weight.max(1e-4);
            for word in words(text) {
                if used.contains(&word) {
                    weight /= 1.0 + frequency;
                    weight *= 1.0 - presence;
                }
            }
            (text.clone(), weight)
        })
        .collect()
}

/// Temperature-scaled nucleus sampler. Deterministic for a given RNG state.
fn sample<T: Clone>(alternatives: &[(T, f64)], temperature: f32, top_p: f32, rng: &mut u64) -> T {
    debug_assert!(!alternatives.is_empty());
    if alternatives.len() == 1 {
        return alternatives[0].0.clone();
    }

    let temp = temperature.max(0.0) as f64;
    if temp < 0.01 {
        let mut best = 0usize;
        for index in 1..alternatives.len() {
            if alternatives[index].1 > alternatives[best].1 {
                best = index;
            }
        }
        return alternatives[best].0.clone();
    }

    let scaled: Vec<f64> = alternatives
        .iter()
        .map(|(_, weight)| weight.max(1e-6).ln() / temp)
        .collect();
    let max = scaled.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let weights: Vec<f64> = scaled.iter().map(|value| (value - max).exp()).collect();
    let total: f64 = weights.iter().sum();

    let mut order: Vec<usize> = (0..weights.len()).collect();
    order.sort_by(|&a, &b| weights[b].partial_cmp(&weights[a]).unwrap_or(Ordering::Equal));

    let threshold = top_p.clamp(0.0, 1.0) as f64 * total;
    let mut cumulative = 0.0;
    let mut kept = Vec::new();
    for index in order {
        kept.push(index);
        cumulative += weights[index];
        if cumulative >= threshold {
            break;
        }
    }
    let kept_total: f64 = kept.iter().map(|&index| weights[index]).sum();
    let mut ticket = (next_u64(rng) as f64 / u64::MAX as f64) * kept_total;
    for index in kept {
        if ticket < weights[index] {
            return alternatives[index].0.clone();
        }
        ticket -= weights[index];
    }
    alternatives[0].0.clone()
}

fn next_u64(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x | 1;
    x.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

fn fnv1a(text: &str, seed: u64) -> u64 {
    text.bytes()
        .fold(seed, |hash, byte| (hash ^ byte as u64).wrapping_mul(0x100_0000_01B3))
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_ascii_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

fn alternatives(items: &[&str]) -> Vec<(String, f64)> {
    weighted(items.iter().map(|item| (*item, 1.0)).collect::<Vec<_>>().as_slice())
}

fn weighted(items: &[(&str, f64)]) -> Vec<(String, f64)> {
    items
        .iter()
        .map(|(text, weight)| ((*text).to_string(), *weight))
        .collect()
}

struct Plan {
    segments: Vec<Vec<(String, f64)>>,
    separator: &'static str,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Style {
    Plain,
    Concise,
    List,
    Haiku,
    Json,
}

#[derive(Clone, Copy)]
enum Intent {
    Greeting,
    Code,
    Image,
    Local,
    Question,
    Default,
}

fn plan_for(req: &GenerateRequest) -> Plan {
    let system = req
        .messages
        .iter()
        .filter(|message| message.role.eq_ignore_ascii_case("system"))
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase();

    let style = if system.contains("haiku") {
        Style::Haiku
    } else if system.contains("json") {
        Style::Json
    } else if system.contains("bullet") || system.contains("list") {
        Style::List
    } else if system.contains("concise") || system.contains("brief") || system.contains("short") {
        Style::Concise
    } else {
        Style::Plain
    };
    if style != Style::Plain {
        return style_plan(style, req);
    }

    let user = req
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .or_else(|| req.messages.last())
        .map(|message| message.content.as_str())
        .unwrap_or("");
    let lower = user.to_ascii_lowercase();
    let topic = topic(user);
    let quoted = format!("\"{topic}\"");

    let intent = if ["hello", "hi ", "hey", "good morning"].iter().any(|w| lower.starts_with(w)) {
        Intent::Greeting
    } else if ["rust", "code", "function", "compile", "cargo"].iter().any(|w| lower.contains(w)) {
        Intent::Code
    } else if ["image", "sd", "diffusion", "lora", "sampler"].iter().any(|w| lower.contains(w)) {
        Intent::Image
    } else if ["local", "offline", "backend", "server", "model"].iter().any(|w| lower.contains(w)) {
        Intent::Local
    } else if lower.contains('?') {
        Intent::Question
    } else {
        Intent::Default
    };

    let segments = match intent {
        Intent::Greeting => vec![
            weighted(&[("Hi", 4.0), ("Hello", 2.0), ("Hey there", 1.0)]),
            alternatives(&[
                "I'm Prism's offline preview model.",
                "This is the local Rust backend speaking.",
            ]),
            alternatives(&[
                "Ask me about local chat, image generation, or streaming.",
                "No weights and no network: give me a seed and I will replay the answer.",
            ]),
        ],
        Intent::Code => vec![
            weighted(&[("Rust path:", 4.0), ("Locally:", 2.0)]),
            alternatives(&[
                "core types stay transport-free and the host injects the transport.",
                "the native server speaks the same OpenAI-compatible /v1 wire format.",
            ]),
            alternatives(&[
                "The renderer and this engine are pure functions covered by tests.",
                "No Python, no model download, no sockets in core.",
            ]),
        ],
        Intent::Image => vec![
            weighted(&[("Image preview:", 4.0), ("For images:", 2.0)]),
            alternatives(&[
                "point the media panel at the A1111-compatible endpoint on port 7861.",
                "use the in-process renderer for a deterministic PNG without weights.",
            ]),
            alternatives(&[
                "Steps, CFG, sampler, scheduler, denoise, batch, size, VAE, CLIP skip and LoRAs are honored.",
                "Batches become a contact sheet of independently seeded cells.",
            ]),
        ],
        Intent::Local => vec![
            weighted(&[("Local backend:", 4.0), ("Offline:", 2.0)]),
            alternatives(&[
                "chat and image generation both run entirely in Rust.",
                "the bundled server exposes /v1 for chat and /sdapi/v1 for images.",
            ]),
            alternatives(&[
                "Discovery, streaming and generation are testable without a model or a GPU.",
                "The same seed and knobs always produce the same result.",
            ]),
        ],
        Intent::Question => vec![
            weighted(&[("Short answer", 4.0), ("Briefly", 2.0)]),
            alternatives(&[quoted.as_str()]),
            alternatives(&[
                "this is a deterministic preview, not a trained model.",
                "the local backend can demonstrate the wire contract without weights.",
            ]),
        ],
        Intent::Default => vec![
            weighted(&[("Offline preview", 4.0), ("Local preview", 2.0)]),
            alternatives(&[quoted.as_str()]),
            alternatives(&[
                "this engine is pure Rust: no model download, no GPU, no network.",
                "pass a seed to reproduce the response exactly.",
            ]),
        ],
    };

    Plan {
        segments,
        separator: " ",
    }
}

fn style_plan(style: Style, req: &GenerateRequest) -> Plan {
    let user = req
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.as_str())
        .unwrap_or("your request");
    let topic = topic(user);
    let topic_line = format!("- Topic: {topic}");
    let answer = format!("{topic} is handled locally in Rust, with no weights or network.");

    match style {
        Style::Concise => Plan {
            segments: vec![
                weighted(&[("In short:", 4.0), ("Briefly:", 2.0)]),
                weighted(&[
                    (answer.as_str(), 3.0),
                    ("The same seed replays the answer.", 2.0),
                ]),
            ],
            separator: " ",
        },
        Style::List => Plan {
            segments: vec![
                alternatives(&["- Offline preview: no weights, no network."]),
                alternatives(&["- Deterministic: the same seed replays the answer."]),
                weighted(&[
                    (topic_line.as_str(), 3.0),
                    ("- Everything runs in the bundled Rust backend.", 2.0),
                ]),
            ],
            separator: "\n",
        },
        Style::Haiku => Plan {
            segments: vec![
                weighted(&[("Quiet seeds unfold", 3.0), ("Silent tokens gather", 2.0)]),
                weighted(&[("Words bloom without weights", 3.0), ("No network, only Rust", 2.0)]),
                weighted(&[("Local answers stay", 3.0), ("Prism replies at home", 2.0)]),
            ],
            separator: "\n",
        },
        Style::Json => {
            let body = serde_json::json!({
                "engine": MODEL_ID,
                "mode": "offline-preview",
                "prompt": topic,
                "answer": "Deterministic local Rust generation; no weights or network.",
            })
            .to_string();
            Plan {
                segments: vec![alternatives(&[body.as_str()])],
                separator: "",
            }
        }
        Style::Plain => unreachable!("plain style uses the intent plans"),
    }
}

fn topic(text: &str) -> String {
    let clean: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean = clean.trim();
    if clean.is_empty() {
        return "your request".to_string();
    }
    if clean.chars().count() <= 72 {
        return clean.to_string();
    }
    let short: String = clean.chars().take(71).collect();
    format!("{short}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_request_is_deterministic() {
        let mut req = GenerateRequest::user("explain the local backend");
        req.seed = Some(42);
        assert_eq!(generate(&req).unwrap(), generate(&req).unwrap());
    }

    #[test]
    fn different_seeds_can_choose_different_variants() {
        let mut outputs = HashSet::new();
        for seed in 1..32 {
            let mut req = GenerateRequest::user("hello");
            req.seed = Some(seed);
            req.temperature = 1.2;
            outputs.insert(generate(&req).unwrap().text);
        }
        assert!(outputs.len() > 1, "sampling never varied with the seed");
    }

    #[test]
    fn zero_temperature_chooses_the_highest_weighted_first_variant() {
        let mut req = GenerateRequest::user("hello");
        req.seed = Some(9);
        req.temperature = 0.0;
        let text = generate(&req).unwrap().text;
        assert!(text.starts_with("Hi I'm Prism's offline preview model."), "{text}");
    }

    #[test]
    fn top_p_can_be_narrowed_to_the_first_choice() {
        let options = vec![("first", 1.0), ("second", 1.0), ("third", 1.0)];
        for seed in 1..16 {
            let mut rng = seed | 1;
            assert_eq!(sample(&options, 1.0, 0.0, &mut rng), "first");
        }
    }

    #[test]
    fn system_prompts_change_the_response_shape() {
        let base = GenerateRequest::user("a local image");
        let mut concise = base.clone();
        concise.messages.insert(0, ChatMessage::text("system", "Be concise"));
        concise.temperature = 0.0;
        assert!(generate(&concise).unwrap().text.starts_with("In short:"));

        let mut list = base.clone();
        list.messages.insert(0, ChatMessage::text("system", "Use a bullet list"));
        assert!(generate(&list).unwrap().text.starts_with("- "));
        assert!(generate(&list).unwrap().text.contains('\n'));

        let mut haiku = base.clone();
        haiku.messages.insert(0, ChatMessage::text("system", "Answer as a haiku"));
        assert_eq!(generate(&haiku).unwrap().text.lines().count(), 3);

        let mut json = base;
        json.messages.insert(0, ChatMessage::text("system", "Return JSON"));
        let value: serde_json::Value =
            serde_json::from_str(&generate(&json).unwrap().text).unwrap();
        assert_eq!(value["engine"], MODEL_ID);
        assert_eq!(value["mode"], "offline-preview");
    }

    #[test]
    fn stop_sequences_truncate_and_win_over_length() {
        let mut req = GenerateRequest::user("hello");
        req.seed = Some(3);
        req.stop = vec!["offline preview".to_string()];
        let out = generate(&req).unwrap();
        assert!(!out.text.contains("offline preview"));
        assert_eq!(out.finish_reason, "stop");
    }

    #[test]
    fn max_tokens_truncates_and_marks_length() {
        let mut req = GenerateRequest::user("explain local chat streaming in detail");
        req.seed = Some(5);
        req.max_tokens = 6;
        let out = generate(&req).unwrap();
        assert!(out.tokens <= req.max_tokens, "{}", out.tokens);
        assert_eq!(out.finish_reason, "length");
    }

    #[test]
    fn stream_chunks_reassemble_exactly_and_stay_utf8() {
        let mut req = GenerateRequest::user("héllo 世界 – local image");
        req.seed = Some(11);
        let text = generate(&req).unwrap().text;
        let chunks = stream_chunks(&req).unwrap();
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| !chunk.is_empty()));
        assert_eq!(chunks.concat(), text);
        assert_eq!(
            stream_events(&req).unwrap().last(),
            Some(&StreamEvent::Done)
        );
    }

    #[test]
    fn tokenization_handles_unicode_and_whitespace_runs() {
        assert_eq!(tokenize("one  two\nthree"), vec!["one", "  ", "two", "\n", "three"]);
        assert_eq!(estimate_tokens("héllo 世界"), 3);
        assert_eq!(estimate_tokens("héllo世界"), 1);
    }

    #[test]
    fn invalid_requests_are_rejected() {
        assert!(generate(&GenerateRequest::default()).is_err());
        let mut req = GenerateRequest::user("ok");
        req.max_tokens = 0;
        assert!(generate(&req).is_err());
    }
}
