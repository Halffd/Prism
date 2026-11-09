//! Tool-call gate: one reusable boundary in front of the agent loop's
//! registry.
//!
//! Three pieces:
//!
//! - **Clamp advertised tools** — a call for a tool that is not
//!   advertised never reaches a handler; the caller gets the closed
//!   list instead.
//! - **Dynamic tool argument repair** — models spill arguments as JSON
//!   envelopes, code fences, wrappers or trailing commas; the repair
//!   layer normalizes them to the plain string input the core tools
//!   take and reports what it changed.
//! - **Tool error classification** — the
//!   observation text is mapped onto a closed `ToolErrorKind` with a
//!   stable, actionable `detail()` the model can act on (retry with a
//!   different path vs. ask for permission vs. stop).

use crate::agent::ToolRegistry;

/// Catalog entry for one advertised tool.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AdvertisedTool {
    pub name: String,
    pub description: String,
}

/// The advertisement surface: exactly which tools the agent may call.
/// Call-site policy: anything else is clamped to `Err(replacement text)`.
pub struct AdvertisedTools {
    tools: Vec<AdvertisedTool>,
}

impl AdvertisedTools {
    /// Snapshot a registry's advertised surface (name + description).
    pub fn from_registry(registry: &ToolRegistry) -> Self {
        let text = registry.descriptions();
        // The descriptions are formatted as "- name: description" lines.
        let tools = text
            .lines()
            .filter_map(|line| {
                let line = line.trim().strip_prefix("- ")?;
                let (name, desc) = line.split_once(':')?;
                Some(AdvertisedTool {
                    name: name.trim().to_string(),
                    description: desc.trim().to_string(),
                })
            })
            .collect();
        Self { tools }
    }

    pub fn from_list(tools: Vec<AdvertisedTool>) -> Self {
        Self { tools }
    }

    pub fn names(&self) -> Vec<String> {
        self.tools.iter().map(|t| t.name.clone()).collect()
    }

    pub fn contains(&self, name: &str) -> bool {
        self.tools.iter().any(|t| t.name == name)
    }
}

/// Clamp a tool call to the advertised surface: known tools pass,
/// anything else fails closed with the advertisement list attached
/// (so the model can re-aim instead of hallucinating tools).
pub fn clamp_advertised_tools(advertised: &AdvertisedTools, tool: &str) -> Result<(), String> {
    if advertised.contains(tool) || tool == "Final Answer" {
        Ok(())
    } else {
        Err(format!(
            "tool_clamped: {tool:?} is not advertised this session; advertised tools: {}",
            advertised.names().join(", ")
        ))
    }
}

/// What the repair layer changed, for the observation text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepairReport {
    pub input: String,
    pub notes: Vec<String>,
}

/// Repair a model-produced tool argument into the plain string the core
/// tools take. Ordering matters and is deliberate:
///
/// 1. strip a fenced code block (```json … ```) that wraps the payload,
/// 2. unwrap a JSON envelope: `{"input": "……"}`, `{"text": ……}` or
///    `{"action_input": ……}` (single keys only — multi-key objects are
///    ambiguous and passed through),
/// 3. unwrap a JSON string literal (`"path/to/file"` → `path/to/file`),
/// 4. drop a trailing comma / stray control chars.
///
/// Anything not JSON-shaped passes through byte-identical, so correct
/// calls are never touched.
pub fn repair_tool_input(raw: &str) -> RepairReport {
    let mut notes: Vec<String> = Vec::new();
    let mut text = raw.to_string();

    // 1. fenced block
    let trimmed = text.trim();
    if trimmed.starts_with("```") {
        if let Some(first_line_end) = trimmed.find('\n') {
            let body = &trimmed[first_line_end + 1..];
            if let Some(close) = body.rfind("```") {
                text = body[..close].trim().to_string();
                notes.push("removed code fence".into());
            }
        }
    }

    // 2. JSON envelope with a single input-ish key
    let candidate = text.trim();
    if candidate.starts_with('{') && candidate.ends_with('}') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) {
            if let serde_json::Value::Object(map) = &value {
                if map.len() == 1 {
                    if let Some((key, inner)) = map.iter().next() {
                        if matches!(key.as_str(), "input" | "text" | "action_input" | "value") {
                            if let Some(s) = inner.as_str() {
                                text = s.to_string();
                                notes.push(format!("unwrapped json envelope key {key:?}"));
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. bare JSON string literal
    let candidate = text.trim();
    if candidate.len() >= 2 && candidate.starts_with('"') && candidate.ends_with('"') {
        if let Ok(s) = serde_json::from_str::<String>(candidate) {
            text = s;
            notes.push("unwrapped json string literal".into());
        }
    }

    // 4. trailing comma / stray control characters
    if text.ends_with(',') {
        text.pop();
        notes.push("dropped trailing comma".into());
    }
    if text.chars().any(|c| c != '\n' && c != '\t' && c.is_control()) {
        text = text
            .chars()
            .map(|c| if c != '\n' && c != '\t' && c.is_control() { ' ' } else { c })
            .collect();
        notes.push("dropped stray control characters".into());
    }

    RepairReport { input: text, notes }
}

/// Closed error taxonomy for tool observations (`mcp-error-classification`
/// + `mcp-tool-error-text-reason`). `NotFound` and `PermissionDenied` are
/// retryable with different arguments; `Environment` is not — the advice
/// differs and the model reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolErrorKind {
    NotRecognized,
    PermissionDenied,
    InvalidInput,
    NotFound,
    Environment,
    None,
}

impl ToolErrorKind {
    pub fn from_observation(observation: &str) -> Self {
        if observation.contains("is not a recognized tool") {
            ToolErrorKind::NotRecognized
        } else if observation.contains("Permission denied") || observation.contains("not allowed") {
            ToolErrorKind::PermissionDenied
        } else if observation.contains("Error:")
            && (observation.contains("No such file")
                || observation.contains("not found")
                || observation.contains("pattern not found"))
        {
            ToolErrorKind::NotFound
        } else if observation.contains("Error:") {
            if observation.contains("outside the workspace")
                || observation.contains("must be")
                || observation.contains("invalid")
            {
                ToolErrorKind::InvalidInput
            } else {
                ToolErrorKind::Environment
            }
        } else {
            ToolErrorKind::None
        }
    }

    /// The closed, actionable reason text appended to observations
    /// (`mcp-tool-error-text-reason`).
    pub fn detail(self) -> Option<&'static str> {
        match self {
            ToolErrorKind::NotRecognized => Some(
                "reason: unknown tool name — call one of the advertised tools exactly as listed",
            ),
            ToolErrorKind::PermissionDenied => Some(
                "reason: blocked by policy — if you believe this is required, finish with a final answer that says what needs approving",
            ),
            ToolErrorKind::InvalidInput => {
                Some("reason: argument rejected — fix the argument format and retry")
            }
            ToolErrorKind::NotFound => Some(
                "reason: target missing — verify the path/fact exists, do not invent one",
            ),
            ToolErrorKind::Environment => Some(
                "reason: environment failure — this will not succeed by retrying; adapt or finish",
            ),
            ToolErrorKind::None => None,
        }
    }
}

/// Free-standing mirror of `ToolErrorKind::detail` for cross-crate use
/// (wasm/classification bindings).
pub fn detail_of(kind: ToolErrorKind) -> Option<&'static str> {
    kind.detail()
}

/// The full gated execution path: repair → clamp → (caller-provided
/// execute) → classify + detail. Kept dependency-free so surfaces (CLI,
/// Slint, wasm, TS mirror) can adopt the same order.
pub fn gated_execute(
    registry: &ToolRegistry,
    advertised: &AdvertisedTools,
    tool: &str,
    raw_input: &str,
    ask: &dyn Fn(&str, &str) -> bool,
) -> String {
    if let Err(clamped) = clamp_advertised_tools(advertised, tool) {
        return clamped;
    }
    let repaired = repair_tool_input(raw_input);
    let mut observation = registry.execute(tool, &repaired.input, ask);
    let kind = ToolErrorKind::from_observation(&observation);
    if let Some(reason) = kind.detail() {
        observation.push_str(&format!("\n({reason}; repair notes: {})", 
            if repaired.notes.is_empty() { "none".into() } else { repaired.notes.join(", ") }));
    }
    observation
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{CalculatorTool, Permission, Tool, ToolRegistry};
    use std::sync::Arc;

    struct EchoTool;
    impl Tool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "Echo back the input."
        }
        fn execute(&self, input: &str) -> String {
            format!("echo:{input}")
        }
    }

    fn fixture_registry() -> ToolRegistry {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        reg.register(Arc::new(CalculatorTool));
        reg.set_permission("echo", Permission::Ask);
        reg
    }

    #[test]
    fn advertised_captures_registry_surface() {
        let reg = fixture_registry();
        let adv = AdvertisedTools::from_registry(&reg);
        let mut names = adv.names();
        names.sort();
        assert_eq!(names, vec!["calculator".to_string(), "echo".to_string()]);
        assert!(adv.contains("echo"));
        assert!(!adv.contains("shell"));
    }

    #[test]
    fn clamp_passes_known_and_final_answer() {
        let adv = AdvertisedTools::from_registry(&fixture_registry());
        assert!(clamp_advertised_tools(&adv, "echo").is_ok());
        assert!(clamp_advertised_tools(&adv, "Final Answer").is_ok());
        let err = clamp_advertised_tools(&adv, "shell_exec").unwrap_err();
        assert!(err.contains("tool_clamped"), "{err}");
        assert!(err.contains("echo"), "{err}");
    }

    #[test]
    fn repair_passthrough_for_plain_text() {
        let r = repair_tool_input("src/main.rs");
        assert_eq!(r.input, "src/main.rs");
        assert!(r.notes.is_empty());
    }

    #[test]
    fn repair_unwraps_envelope_and_fences() {
        let r = repair_tool_input(r#"{"input": "src/lib.rs"}"#);
        assert_eq!(r.input, "src/lib.rs");
        assert!(r.notes.iter().any(|n| n.contains("envelope")), "{r:?}");

        let r = repair_tool_input("```\n{\"action_input\": \"42+40\"}\n```");
        assert_eq!(r.input, "42+40");
        assert!(r.notes.iter().any(|n| n.contains("fence")), "{r:?}");
    }

    #[test]
    fn repair_json_string_literal() {
        let r = repair_tool_input("\"a.txt\"");
        assert_eq!(r.input, "a.txt");
    }

    #[test]
    fn repair_leaves_multi_key_json_alone() {
        let r = repair_tool_input(r#"{"a":1,"b":2}"#);
        assert_eq!(r.input, r#"{"a":1,"b":2}"#);
    }

    #[test]
    fn classification_maps_observation_text() {
        assert_eq!(
            ToolErrorKind::from_observation("Tool \"nope\" is not a recognized tool. Input: \"x\""),
            ToolErrorKind::NotRecognized
        );
        assert_eq!(
            ToolErrorKind::from_observation("[echo] Permission denied: this tool is blocked."),
            ToolErrorKind::PermissionDenied
        );
        assert_eq!(
            ToolErrorKind::from_observation("[read_file] Error: No such file or directory"),
            ToolErrorKind::NotFound
        );
        assert_eq!(
            ToolErrorKind::from_observation("echo:hi"),
            ToolErrorKind::None
        );
    }

    #[test]
    fn gated_execute_repairs_then_classifies() {
        let reg = fixture_registry();
        let adv = AdvertisedTools::from_registry(&reg);

        // Envelope input is repaired down to the plain string ("echo:hi",
        // not `echo:{"input":"hi"}`); a clean observation is left clean —
        // no suffix noise.
        let out = gated_execute(&reg, &adv, "echo", "{\"input\":\"hi\"}", &|_, _| true);
        assert_eq!(out, "echo:hi");

        // Denied by the Ask gate => classification appends the policy reason.
        let out = gated_execute(&reg, &adv, "echo", "hi", &|_, _| false);
        assert!(out.contains("Permission denied by user"), "{out}");
        assert!(out.contains("reason: blocked by policy"), "{out}");

        // Clamped tool never reaches the handler.
        let out = gated_execute(&reg, &adv, "ghost", "hi", &|_, _| true);
        assert!(out.starts_with("tool_clamped"), "{out}");
    }
}
