//! Agent loop: tool registry, permissions, and the ReAct cycle.
//!
//! One loop, every surface. The core owns the step semantics (thought →
//! action → observation, max steps, Final Answer) so Slint, TUI, CLI and
//! the extension all run identical agent behavior. Surfaces provide an
//! LLM step function (see `StepFn`) and optionally register extra tools
//! (the extension system: `ToolRegistry::register`).
//!
//! Wire philosophy matches the rest of the core: the loop is
//! transport-free. LLM calls go through `StepFn` (a model prompt →
//! response mapping), so the loop is testable without any provider and
//! WASM hosts can drive it from JS.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Permission level for a tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Allow,
    Deny,
    Ask,
}

/// One executable tool.
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    /// One-line description injected into the agent prompt.
    fn description(&self) -> &str;
    fn execute(&self, input: &str) -> String;
}

/// Registry of tools. Extension point: surfaces call `register` to add
/// custom tools (the "extension system" for the agent loop).
#[derive(Default, Clone)]
pub struct ToolRegistry {
    tools: Arc<Mutex<HashMap<String, Arc<dyn Tool>>>>,
    /// Per-tool permission overrides (default Allow for registered tools).
    permissions: Arc<Mutex<HashMap<String, Permission>>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a custom tool (extension point).
    pub fn register(&self, tool: Arc<dyn Tool>) {
        let name = tool.name().to_string();
        self.tools.lock().unwrap().insert(name.clone(), tool);
        self.permissions
            .lock()
            .unwrap()
            .entry(name)
            .or_insert(Permission::Allow);
    }

    /// Set a tool's permission level.
    pub fn set_permission(&self, name: &str, level: Permission) {
        self.permissions
            .lock()
            .unwrap()
            .insert(name.to_string(), level);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.lock().unwrap().get(name).cloned()
    }

    pub fn permission(&self, name: &str) -> Permission {
        self.permissions
            .lock()
            .unwrap()
            .get(name)
            .copied()
            .unwrap_or(Permission::Allow)
    }

    /// Tool descriptions for the agent prompt, "- name: description".
    pub fn descriptions(&self) -> String {
        let tools = self.tools.lock().unwrap();
        if tools.is_empty() {
            return "- Final Answer: Provide the final answer to the task".into();
        }
        tools
            .values()
            .map(|t| format!("- {}: {}", t.name(), t.description()))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Execute with the permission policy. Denied/asked tools return a
    /// message the agent can read instead of executing.
    pub fn execute(&self, name: &str, input: &str, ask: &dyn Fn(&str, &str) -> bool) -> String {
        match self.permission(name) {
            Permission::Deny => {
                format!("[{name}] Permission denied: this tool is blocked. Continue without it.")
            }
            Permission::Ask => {
                if ask(name, input) {
                    self.run_tool(name, input)
                } else {
                    format!("[{name}] Permission denied by user. Continue without it.")
                }
            }
            Permission::Allow => self.run_tool(name, input),
        }
    }

    fn run_tool(&self, name: &str, input: &str) -> String {
        match self.get(name) {
            Some(t) => t.execute(input),
            None => format!("Tool \"{name}\" is not a recognized tool. Input: \"{input}\""),
        }
    }
}

/// The LLM side of one agent step: system prompt + conversation so far →
/// the model's raw response. Surfaces implement this over their own
/// transport; the core loop owns everything around it.
pub type StepFn<'a> = dyn FnMut(&str, &[StepMessage]) -> Result<String, String> + 'a;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepMessage {
    pub role: String,
    pub content: String,
}

/// One recorded step of a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub thought: String,
    pub action: String,
    pub action_input: String,
    pub observation: String,
}

/// Final result of an agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub answer: String,
    pub steps: Vec<AgentStep>,
    /// True when the loop hit Final Answer; false = stopped on max steps or error.
    pub completed: bool,
    pub error: Option<String>,
}

const REACT_SYSTEM: &str = r#"You are an autonomous agent. Given a task, think step by step.

For each step, respond with EXACTLY this JSON format:
{"thought":"<your reasoning>","action":"<tool_name>","action_input":"<input for tool>"}

When you have the final answer, respond with:
{"thought":"<reasoning>","action":"Final Answer","action_input":"<your answer>"}

Available tools:
{tools}

Begin!"#;

/// Parsed model response for one step.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StepDecision {
    thought: String,
    action: String,
    action_input: String,
}

fn parse_decision(raw: &str) -> Option<StepDecision> {
    let json = raw.match_indices('{').next().map(|(i, _)| &raw[i..])?;
    // Take the outermost brace span.
    let start = raw[json.len() - (json.len() - json.find('{')?)..].len();
    let _ = start;
    let end = raw.rfind('}')? + 1;
    let slice = &raw[json.find('{')?..end];
    serde_json::from_str(slice).ok()
}

/// Run the ReAct loop. `max_steps` bounds the cycle; `ask` gates
/// ask-permission tools (an interactive surface passes a prompt fn; a
/// headless one passes `|_, _| false` to deny).
pub fn run_agent(
    task: &str,
    step_fn: &mut StepFn,
    registry: &ToolRegistry,
    max_steps: usize,
    ask: &dyn Fn(&str, &str) -> bool,
) -> AgentResult {
    let system = REACT_SYSTEM.replace("{tools}", &registry.descriptions());
    let mut history: Vec<StepMessage> = vec![StepMessage {
        role: "user".into(),
        content: format!("Task: {task}"),
    }];
    let mut steps: Vec<AgentStep> = Vec::new();

    for _ in 0..max_steps {
        let raw = match step_fn(&system, &history) {
            Ok(r) => r,
            Err(e) => {
                return AgentResult {
                    answer: String::new(),
                    steps,
                    completed: false,
                    error: Some(e),
                }
            }
        };

        // Non-JSON response = the model answered directly.
        let Some(decision) = parse_decision(&raw) else {
            steps.push(AgentStep {
                thought: raw.clone(),
                action: "Final Answer".into(),
                action_input: raw.clone(),
                observation: String::new(),
            });
            return AgentResult {
                answer: raw,
                steps,
                completed: true,
                error: None,
            };
        };

        if decision.action == "Final Answer" {
            steps.push(AgentStep {
                thought: decision.thought.clone(),
                action: decision.action.clone(),
                action_input: decision.action_input.clone(),
                observation: String::new(),
            });
            return AgentResult {
                answer: decision.action_input,
                steps,
                completed: true,
                error: None,
            };
        }

        let observation = registry.execute(&decision.action, &decision.action_input, ask);
        steps.push(AgentStep {
            thought: decision.thought.clone(),
            action: decision.action.clone(),
            action_input: decision.action_input.clone(),
            observation: observation.clone(),
        });
        history.push(StepMessage {
            role: "assistant".into(),
            content: raw,
        });
        history.push(StepMessage {
            role: "user".into(),
            content: format!("Observation: {observation}"),
        });
    }

    AgentResult {
        answer: String::new(),
        steps,
        completed: false,
        error: Some("Agent exceeded maximum steps without reaching a final answer".into()),
    }
}

// ---- built-in tools -------------------------------------------------------

/// Deterministic arithmetic tool (no eval — a tiny recursive-descent
/// parser over + - * / ( ) and floats).
pub struct CalculatorTool;

impl Tool for CalculatorTool {
    fn name(&self) -> &str {
        "calculator"
    }
    fn description(&self) -> &str {
        "Evaluate an arithmetic expression like (2+3)*4. Input: the expression."
    }
    fn execute(&self, input: &str) -> String {
        match calc_eval(input.trim()) {
            Ok(v) => format!("[calculator] {input} = {v}"),
            Err(e) => format!("[calculator] Error: {e}"),
        }
    }
}

mod calc {
    use super::*;
    pub fn eval(expr: &str) -> Result<f64, String> {
        calc_eval(expr)
    }
}

fn calc_eval(expr: &str) -> Result<f64, String> {
    let tokens: Vec<char> = expr.chars().filter(|c| !c.is_whitespace()).collect();
    let mut pos = 0usize;
    let v = parse_add(&tokens, &mut pos)?;
    if pos != tokens.len() {
        return Err(format!("unexpected char at {pos}"));
    }
    Ok(v)
}

fn parse_add(t: &[char], pos: &mut usize) -> Result<f64, String> {
    let mut left = parse_mul(t, pos)?;
    while *pos < t.len() && (t[*pos] == '+' || t[*pos] == '-') {
        let op = t[*pos];
        *pos += 1;
        let right = parse_mul(t, pos)?;
        left = if op == '+' { left + right } else { left - right };
    }
    Ok(left)
}

fn parse_mul(t: &[char], pos: &mut usize) -> Result<f64, String> {
    let mut left = parse_atom(t, pos)?;
    while *pos < t.len() && (t[*pos] == '*' || t[*pos] == '/') {
        let op = t[*pos];
        *pos += 1;
        let right = parse_atom(t, pos)?;
        left = if op == '*' { left * right } else { left / right };
    }
    Ok(left)
}

fn parse_atom(t: &[char], pos: &mut usize) -> Result<f64, String> {
    if *pos < t.len() && t[*pos] == '(' {
        *pos += 1;
        let v = parse_add(t, pos)?;
        if *pos >= t.len() || t[*pos] != ')' {
            return Err("missing )".into());
        }
        *pos += 1;
        return Ok(v);
    }
    let start = *pos;
    while *pos < t.len() && (t[*pos].is_ascii_digit() || t[*pos] == '.') {
        *pos += 1;
    }
    let s: String = t[start..*pos].iter().collect();
    s.parse::<f64>()
        .map_err(|_| format!("invalid number '{s}'"))
}

pub use calc::eval;

/// Placeholder web search: surfaces inject a real implementation by
/// registering a tool with the same name; this one returns a pointer so
/// the loop never dead-ends when none is present.
pub struct WebSearchStubTool;

impl Tool for WebSearchStubTool {
    fn name(&self) -> &str {
        "web_search"
    }
    fn description(&self) -> &str {
        "Search the web. Input: the query."
    }
    fn execute(&self, _input: &str) -> String {
        "[web_search] No search backend registered on this surface.".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn script_step<'a>(
        responses: &'a [&'a str],
    ) -> impl FnMut(&str, &[StepMessage]) -> Result<String, String> + 'a {
        let i = std::cell::Cell::new(0usize);
        move |_sys, _hist| {
            let idx = i.get();
            i.set(idx + 1);
            Ok(responses.get(idx).map(|s| s.to_string()).unwrap_or_default())
        }
    }

    #[test]
    fn loop_reaches_final_answer() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let mut step = script_step(&[
            r#"{"thought":"call echo","action":"echo","action_input":"hi"}"#,
            r#"{"thought":"done","action":"Final Answer","action_input":"42"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| true);
        assert!(r.completed);
        assert_eq!(r.answer, "42");
        assert_eq!(r.steps.len(), 2);
        assert_eq!(r.steps[0].observation, "echo:hi");
    }

    #[test]
    fn max_steps_stops_with_error() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let responses: Vec<String> =
            std::iter::repeat(r#"{"thought":"again","action":"echo","action_input":"x"}"#.to_string())
                .take(5)
                .collect();
        let idx = std::cell::Cell::new(0usize);
        let mut step = |_sys: &str, _hist: &[StepMessage]| -> Result<String, String> {
            let i = idx.get();
            idx.set(i + 1);
            Ok(responses[i.min(responses.len() - 1)].clone())
        };
        let r = run_agent("task", &mut step, &reg, 3, &|_, _| true);
        assert!(!r.completed);
        assert!(r.error.as_deref().unwrap().contains("maximum steps"));
        assert_eq!(r.steps.len(), 3);
    }

    #[test]
    fn non_json_response_becomes_answer() {
        let reg = ToolRegistry::new();
        let mut step = script_step(&["The answer is simply five."]);
        let r = run_agent("task", &mut step, &reg, 3, &|_, _| true);
        assert!(r.completed);
        assert_eq!(r.answer, "The answer is simply five.");
    }

    #[test]
    fn deny_blocks_execution() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        reg.set_permission("echo", Permission::Deny);
        let mut step = script_step(&[
            r#"{"thought":"try","action":"echo","action_input":"secret"}"#,
            r#"{"thought":"ok","action":"Final Answer","action_input":"gave up"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| true);
        assert_eq!(r.steps[0].observation, "[echo] Permission denied: this tool is blocked. Continue without it.");
        assert_eq!(r.answer, "gave up");
    }

    #[test]
    fn ask_gate_decides() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        reg.set_permission("echo", Permission::Ask);

        let mut step = script_step(&[
            r#"{"thought":"try","action":"echo","action_input":"q"}"#,
            r#"{"thought":"done","action":"Final Answer","action_input":"end"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| true);
        assert_eq!(r.steps[0].observation, "echo:q");

        let mut step = script_step(&[
            r#"{"thought":"try","action":"echo","action_input":"q"}"#,
            r#"{"thought":"done","action":"Final Answer","action_input":"end"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| false);
        assert_eq!(
            r.steps[0].observation,
            "[echo] Permission denied by user. Continue without it."
        );
    }

    #[test]
    fn calculator_evaluates_and_rejects() {
        assert_eq!(CalculatorTool.execute("2+3*4"), "[calculator] 2+3*4 = 14");
        assert_eq!(CalculatorTool.execute("(2+3)*4"), "[calculator] (2+3)*4 = 20");
        assert!(CalculatorTool.execute("import os").starts_with("[calculator] Error"));
    }

    #[test]
    fn custom_tool_via_registry_extension_point() {
        struct UpperTool;
        impl Tool for UpperTool {
            fn name(&self) -> &str {
                "upper"
            }
            fn description(&self) -> &str {
                "Uppercase input."
            }
            fn execute(&self, input: &str) -> String {
                input.to_uppercase()
            }
        }
        let reg = ToolRegistry::new();
        reg.register(Arc::new(UpperTool));
        assert_eq!(reg.get("upper").unwrap().execute("abc"), "ABC");
        assert!(reg.descriptions().contains("upper"));
    }

    #[test]
    fn unknown_tool_message() {
        let reg = ToolRegistry::new();
        assert!(reg.execute("nope", "x", &|_, _| true).contains("not a recognized tool"));
    }
}
