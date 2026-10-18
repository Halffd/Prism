//! Conformance suite: `contracts/fixtures/` are the spec.
//!
//! Every stream fixture is replayed through the decoder two ways —
//! whole input and byte-by-byte — and both must produce exactly the
//! expected event sequence. This pins chunk-boundary behavior (the
//! transport may split anywhere, including inside multi-byte UTF-8).
//! Full-body fixtures (api, models, thinking, settings) assert parsed
//! output equality.

use prism_core::client::{
    parse_api_response, parse_models_response, NdjsonDecoder, SseDecoder, StreamEvent,
};
use prism_core::settings::{settings_from_json, Settings};
use prism_core::thinking::strip_thinking;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/fixtures")
}

fn case_dirs(category: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<_> = fs::read_dir(fixtures_dir().join(category))
        .unwrap_or_else(|e| panic!("fixtures/{category} missing: {e}"))
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    assert!(!dirs.is_empty(), "fixtures/{category} has no cases");
    dirs
}

fn read_case(dir: &Path) -> (String, String) {
    let input = fs::read_to_string(dir.join("input.txt"))
        .unwrap_or_else(|e| panic!("{}: missing input.txt: {e}", dir.display()));
    let expected = fs::read_to_string(dir.join("expected.json"))
        .unwrap_or_else(|e| panic!("{}: missing expected.json: {e}", dir.display()));
    (input, expected)
}

fn sse_events(input: &str, byte_split: bool) -> Vec<StreamEvent> {
    let mut d = SseDecoder::new();
    let mut events = Vec::new();
    if byte_split {
        for b in input.as_bytes() {
            events.extend(d.feed(std::slice::from_ref(b)));
        }
    } else {
        events.extend(d.feed(input.as_bytes()));
    }
    events.extend(d.finish());
    events
}

fn ndjson_events(input: &str, byte_split: bool) -> Vec<StreamEvent> {
    let mut d = NdjsonDecoder::new();
    let mut events = Vec::new();
    if byte_split {
        for b in input.as_bytes() {
            events.extend(d.feed(std::slice::from_ref(b)));
        }
    } else {
        events.extend(d.feed(input.as_bytes()));
    }
    events.extend(d.finish());
    events
}

fn assert_events(actual: &[StreamEvent], expected_json: &str, ctx: &str) {
    let expected: Value = serde_json::from_str(expected_json)
        .unwrap_or_else(|e| panic!("{ctx}: expected.json invalid: {e}"));
    let actual_value = serde_json::to_value(actual).unwrap();
    assert_eq!(
        actual_value, expected,
        "{ctx}: decoded events diverge from the fixture"
    );
}

#[test]
fn sse_fixtures_decode_identically_whole_and_bytewise() {
    for dir in case_dirs("sse") {
        let (input, expected) = read_case(&dir);
        assert_events(
            &sse_events(&input, false),
            &expected,
            &format!("{} whole", dir.display()),
        );
        assert_events(
            &sse_events(&input, true),
            &expected,
            &format!("{} byte-split", dir.display()),
        );
    }
}

#[test]
fn ollama_fixtures_decode_identically_whole_and_bytewise() {
    for dir in case_dirs("ollama") {
        let (input, expected) = read_case(&dir);
        assert_events(
            &ndjson_events(&input, false),
            &expected,
            &format!("{} whole", dir.display()),
        );
        assert_events(
            &ndjson_events(&input, true),
            &expected,
            &format!("{} byte-split", dir.display()),
        );
    }
}

#[test]
fn api_fixtures_parse_to_expected() {
    for dir in case_dirs("api") {
        let (input, expected) = read_case(&dir);
        let actual = serde_json::to_value(parse_api_response(&input).map_err(|e| e)).unwrap();
        let expected: Value = serde_json::from_str(&expected).unwrap();
        assert_eq!(actual, expected, "{}: parse diverges", dir.display());
    }
}

#[test]
fn models_fixtures_parse_to_expected() {
    for dir in case_dirs("models") {
        let (input, expected) = read_case(&dir);
        let actual = serde_json::to_value(parse_models_response(&input)).unwrap();
        let expected: Value = serde_json::from_str(&expected).unwrap();
        assert_eq!(actual, expected, "{}: parse diverges", dir.display());
    }
}

#[test]
fn thinking_fixtures_parse_to_expected() {
    for dir in case_dirs("thinking") {
        let (input, expected) = read_case(&dir);
        let (content, thinking) = strip_thinking(&input);
        let actual = serde_json::to_value((content, thinking)).unwrap();
        let expected: Value = serde_json::from_str(&expected).unwrap();
        assert_eq!(actual, expected, "{}: strip diverges", dir.display());
    }
}

#[test]
fn settings_fixtures_normalize_to_expected() {
    for dir in case_dirs("settings") {
        let (input, expected) = read_case(&dir);
        let actual = settings_from_json(&input)
            .unwrap_or_else(|e| panic!("{}: input rejected: {e}", dir.display()));
        // Compare as Settings (f32-exact) rather than JSON values, since
        // f32 -> f64 widening in serde_json would false-diff 0.7.
        let expected: Settings = serde_json::from_str(&expected)
            .unwrap_or_else(|e| panic!("{}: expected.json invalid: {e}", dir.display()));
        assert_eq!(
            actual,
            expected,
            "{}: normalization diverges",
            dir.display()
        );
    }
}

// ---------------------------------------------------------------------------
// Property: arbitrary chunk boundaries never change decoded output.
// ---------------------------------------------------------------------------

proptest::proptest! {
    #[test]
    fn sse_arbitrary_chunking_matches_whole(mask in proptest::collection::vec(proptest::prelude::any::<bool>(), 1..256)) {
        for dir in case_dirs("sse") {
            let (input, _) = read_case(&dir);
            let bytes = input.as_bytes();
            let mut whole = SseDecoder::new();
            let mut expected_events = whole.feed(bytes);
            expected_events.extend(whole.finish());

            let mut split = SseDecoder::new();
            let mut actual_events = Vec::new();
            let mut chunk: Vec<u8> = Vec::new();
            for (i, b) in bytes.iter().enumerate() {
                chunk.push(*b);
                if mask[i % mask.len()] {
                    actual_events.extend(split.feed(&chunk));
                    chunk.clear();
                }
            }
            if !chunk.is_empty() {
                actual_events.extend(split.feed(&chunk));
            }
            actual_events.extend(split.finish());

            proptest::prop_assert_eq!(actual_events, expected_events, "{}", dir.display());
        }
    }

    #[test]
    fn ollama_arbitrary_chunking_matches_whole(mask in proptest::collection::vec(proptest::prelude::any::<bool>(), 1..256)) {
        for dir in case_dirs("ollama") {
            let (input, _) = read_case(&dir);
            let bytes = input.as_bytes();
            let mut whole = NdjsonDecoder::new();
            let mut expected_events = whole.feed(bytes);
            expected_events.extend(whole.finish());

            let mut split = NdjsonDecoder::new();
            let mut actual_events = Vec::new();
            let mut chunk: Vec<u8> = Vec::new();
            for (i, b) in bytes.iter().enumerate() {
                chunk.push(*b);
                if mask[i % mask.len()] {
                    actual_events.extend(split.feed(&chunk));
                    chunk.clear();
                }
            }
            if !chunk.is_empty() {
                actual_events.extend(split.feed(&chunk));
            }
            actual_events.extend(split.finish());

            proptest::prop_assert_eq!(actual_events, expected_events, "{}", dir.display());
        }
    }
}
