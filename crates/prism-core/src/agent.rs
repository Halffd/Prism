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

/// One recorded step of a run. `phase` says which strategy phase
/// produced it ("react" | "plan" | "execute") so surfaces can render
/// plan vs execution distinctly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub thought: String,
    pub action: String,
    pub action_input: String,
    pub observation: String,
    #[serde(default = "default_phase")]
    pub phase: String,
}

fn default_phase() -> String {
    "react".into()
}

/// Which loop the agent runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStrategy {
    /// ReAct: think → act → observe until Final Answer.
    React,
    /// Plan-and-execute: first produce a numbered plan, then execute
    /// each planned step, then synthesize.
    PlanAndExecute,
}

impl Default for AgentStrategy {
    fn default() -> Self {
        AgentStrategy::React
    }
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

const PLAN_SYSTEM: &str = r#"You are a planning agent. First produce a plan, then execute it.

Phase 1 — PLAN. Respond with a numbered list only:
Plan: 1. <step> 2. <step> …

Phase 2 — EXECUTE. Each turn, respond with EXACTLY:
{"thought":"<reasoning>","action":"<tool_name>","action_input":"<input>"}

Phase 3 — ANSWER. When all steps are done:
{"thought":"<reasoning>","action":"Final Answer","action_input":"<your answer>"}

Available tools:
{tools}

Begin!"#;

/// Parse a numbered plan ("1. foo / 2. bar", or "1) foo"). Tolerates a
/// header glued to the first item ("Plan: 1. foo"). Returns [] when no
/// numbered items exist — the caller decides the fallback.
pub fn parse_plan(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let mut t = line.trim();
        // Tolerate a header glued to the first item: "Plan: 1. foo".
        if let Some(colon) = t.find(':') {
            let (head, tail) = t.split_at(colon);
            if head.chars().all(|c| c.is_alphabetic() || c.is_whitespace())
                && !tail[1..].trim().is_empty()
            {
                t = tail[1..].trim();
            }
        }
        let stripped = t
            .strip_prefix(|_: char| t.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .map(|r| r.trim_start())
            .and_then(|r| r.strip_prefix('.').or_else(|| r.strip_prefix(')')))
            .map(str::trim)
            .unwrap_or("");
        if !stripped.is_empty() && stripped != t {
            out.push(stripped.to_string());
        }
    }
    out
}

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

/// Run the agent. `strategy` selects the loop (ReAct or
/// plan-and-execute); everything else is identical.
pub fn run_agent(
    task: &str,
    step_fn: &mut StepFn,
    registry: &ToolRegistry,
    max_steps: usize,
    ask: &dyn Fn(&str, &str) -> bool,
) -> AgentResult {
    run_with_strategy(
        task,
        step_fn,
        registry,
        max_steps,
        ask,
        AgentStrategy::default(),
    )
}

/// Run with an explicit strategy.
pub fn run_with_strategy(
    task: &str,
    step_fn: &mut StepFn,
    registry: &ToolRegistry,
    max_steps: usize,
    ask: &dyn Fn(&str, &str) -> bool,
    strategy: AgentStrategy,
) -> AgentResult {
    match strategy {
        AgentStrategy::React => run_react(task, step_fn, registry, max_steps, ask),
        AgentStrategy::PlanAndExecute => {
            run_plan_and_execute(task, step_fn, registry, max_steps, ask)
        }
    }
}

fn run_react(
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
    // The tool gate: the advertised surface, the argument repair and the
    // error classification, applied to every call before it reaches a
    // handler.
    let advertised = crate::toolgate::AdvertisedTools::from_registry(registry);

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
                phase: "react".into(),
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
                phase: "react".into(),
            });
            return AgentResult {
                answer: decision.action_input,
                steps,
                completed: true,
                error: None,
            };
        }

        let observation = crate::toolgate::gated_execute(
            registry,
            &advertised,
            &decision.action,
            &decision.action_input,
            ask,
        );
        steps.push(AgentStep {
            thought: decision.thought.clone(),
            action: decision.action.clone(),
            action_input: decision.action_input.clone(),
            observation: observation.clone(),
            phase: "react".into(),
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

/// Plan-and-execute loop: one model call for the plan, a bounded tool
/// loop per planned step, then one call to synthesize. Every phase
/// counts against `max_steps`. An unparseable plan degrades to a single
/// synthetic step (the task itself) rather than dead-ending.
fn run_plan_and_execute(
    task: &str,
    step_fn: &mut StepFn,
    registry: &ToolRegistry,
    max_steps: usize,
    ask: &dyn Fn(&str, &str) -> bool,
) -> AgentResult {
    let system = PLAN_SYSTEM.replace("{tools}", &registry.descriptions());
    let mut steps: Vec<AgentStep> = Vec::new();
    let mut used = 0usize;
    let mut spend = || -> bool {
        used += 1;
        used <= max_steps
    };

    // ---- Phase 1: the plan (one call) ----
    let plan_raw = match step_fn(
        &system,
        &[StepMessage {
            role: "user".into(),
            content: format!("Task: {task}\nPlan:"),
        }],
    ) {
        Ok(r) => r,
        Err(e) => {
            return AgentResult { answer: String::new(), steps, completed: false, error: Some(e) }
        }
    };
    let plan = parse_plan(&plan_raw);
    let plan: Vec<String> = if plan.is_empty() {
        vec![task.to_string()] // synthetic fallback
    } else {
        plan
    };
    steps.push(AgentStep {
        thought: "plan".into(),
        action: "Plan".into(),
        action_input: plan.join(" | "),
        observation: format!("{} steps", plan.len()),
        phase: "plan".into(),
    });

    // ---- Phase 2: execute each planned step ----
    let mut observations: Vec<String> = Vec::new();
    for (idx, step) in plan.iter().enumerate() {
        let prompt = format!(
            "Task: {task}\nPlan: {}\nExecute step {}/{}: {}\nPrior observations:\n{}",
            plan.join(" | "),
            idx + 1,
            plan.len(),
            step,
            observations.join("\n"),
        );
        let mut step_done = false;
        while !step_done {
            if !spend() {
                return AgentResult {
                    answer: String::new(),
                    steps,
                    completed: false,
                    error: Some("Agent exceeded maximum steps during execution".into()),
                };
            }
            let raw = match step_fn(
                &system,
                &[StepMessage { role: "user".into(), content: prompt.clone() }],
            ) {
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
            let Some(decision) = parse_decision(&raw) else {
                // Non-JSON: this step's whole reply is its result.
                steps.push(AgentStep {
                    thought: format!("step {}/{}", idx + 1, plan.len()),
                    action: "Step".into(),
                    action_input: step.clone(),
                    observation: raw.clone(),
                    phase: "execute".into(),
                });
                observations.push(raw);
                step_done = true;
                continue;
            };
            if decision.action == "Final Answer" {
                steps.push(AgentStep {
                    thought: decision.thought.clone(),
                    action: "Step".into(),
                    action_input: step.clone(),
                    observation: decision.action_input.clone(),
                    phase: "execute".into(),
                });
                observations.push(decision.action_input.clone());
                step_done = true;
                continue;
            }
            let observation = registry.execute(&decision.action, &decision.action_input, ask);
            steps.push(AgentStep {
                thought: decision.thought.clone(),
                action: decision.action.clone(),
                action_input: decision.action_input.clone(),
                observation: observation.clone(),
                phase: "execute".into(),
            });
            observations.push(observation);
        }
    }

    // ---- Phase 3: synthesize ----
    if !spend() {
        return AgentResult {
            answer: String::new(),
            steps,
            completed: false,
            error: Some("Agent exceeded maximum steps before synthesizing".into()),
        };
    }
    let prompt = format!(
        "Task: {task}\nPlan: {}\nObservations:\n{}\nGive the final answer.",
        plan.join(" | "),
        observations.join("\n"),
    );
    match step_fn(&system, &[StepMessage { role: "user".into(), content: prompt }]) {
        Ok(raw) => {
            let answer = parse_decision(&raw)
                .filter(|d| d.action == "Final Answer")
                .map(|d| d.action_input)
                .unwrap_or(raw);
            steps.push(AgentStep {
                thought: "synthesize".into(),
                action: "Final Answer".into(),
                action_input: answer.clone(),
                observation: String::new(),
                phase: "execute".into(),
            });
            AgentResult { answer, steps, completed: true, error: None }
        }
        Err(e) => AgentResult { answer: String::new(), steps, completed: false, error: Some(e) },
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
    fn parse_plan_strips_numbering() {
        assert_eq!(
            parse_plan("Plan: 1. read the file\n2. patch it\n3. verify"),
            vec!["read the file", "patch it", "verify"]
        );
        assert_eq!(parse_plan("1) alpha\n2) beta"), vec!["alpha", "beta"]);
    }

    #[test]
    fn parse_plan_empty_when_no_steps() {
        assert!(parse_plan("").is_empty());
        assert!(parse_plan("   \n  ").is_empty());
    }

    #[test]
    fn plan_and_execute_runs_plan_then_steps_then_answer() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let responses: Vec<String> = vec![
            // plan
            "Plan: 1. gather\n2. report".into(),
            // step 1 tool call
            r#"{"thought":"gather","action":"echo","action_input":"data"}"#.into(),
            // step 1 done
            r#"{"thought":"have it","action":"Final Answer","action_input":"gathered"}"#.into(),
            // step 2 tool call
            r#"{"thought":"report","action":"echo","action_input":"gathered"}"#.into(),
            // step 2 done
            r#"{"thought":"ok","action":"Final Answer","action_input":"reported"}"#.into(),
            // synthesize
            r#"{"thought":"done","action":"Final Answer","action_input":"final report"}"#.into(),
        ];
        let idx = std::cell::Cell::new(0usize);
        let mut step = |_sys: &str, _hist: &[StepMessage]| -> Result<String, String> {
            let i = idx.get();
            idx.set(i + 1);
            Ok(responses[i.min(responses.len() - 1)].clone())
        };
        let r = run_with_strategy(
            "summarize",
            &mut step,
            &reg,
            12,
            &|_, _| true,
            AgentStrategy::PlanAndExecute,
        );
        assert!(r.completed, "err={:?}", r.error);
        assert_eq!(r.answer, "final report");
        // Phase tags: one plan, two executes, one synthesis.
        assert_eq!(r.steps.iter().filter(|s| s.phase == "plan").count(), 1);
        assert!(r
            .steps
            .iter()
            .any(|s| s.phase == "execute" && s.observation == "echo:data"));
        let last = r.steps.last().unwrap();
        assert_eq!(last.action, "Final Answer");
        assert_eq!(last.action_input, "final report");
    }

    #[test]
    fn plan_and_execute_falls_back_when_plan_unparseable() {
        let reg = ToolRegistry::new();
        let responses: Vec<String> = vec![
            "I have no idea how to plan this.".into(),
            // Single synthetic step: the model answers directly.
            "The answer is four.".into(),
            // Synthesis.
            "four".into(),
        ];
        let idx = std::cell::Cell::new(0usize);
        let mut step = |_sys: &str, _hist: &[StepMessage]| -> Result<String, String> {
            let i = idx.get();
            idx.set(i + 1);
            Ok(responses[i.min(responses.len() - 1)].clone())
        };
        let r = run_with_strategy(
            "compute",
            &mut step,
            &reg,
            12,
            &|_, _| true,
            AgentStrategy::PlanAndExecute,
        );
        assert!(r.completed, "err={:?}", r.error);
        // The synthetic step is the task itself.
        assert!(r.steps.iter().any(|s| s.phase == "plan" && s.action_input == "compute"));
        assert_eq!(r.answer, "four");
    }

    #[test]
    fn plan_and_execute_respects_max_steps() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        let responses: Vec<String> = vec![
            "Plan: 1. loop forever".into(),
            r#"{"thought":"again","action":"echo","action_input":"x"}"#.into(),
        ];
        let idx = std::cell::Cell::new(0usize);
        let mut step = |_sys: &str, _hist: &[StepMessage]| -> Result<String, String> {
            let i = idx.get();
            idx.set(i + 1);
            Ok(responses[i.min(responses.len() - 1)].clone())
        };
        let r = run_with_strategy(
            "spin",
            &mut step,
            &reg,
            3,
            &|_, _| true,
            AgentStrategy::PlanAndExecute,
        );
        assert!(!r.completed);
        assert!(r.error.as_deref().unwrap().contains("maximum steps"));
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
        // The gate appends the actionable reason to a denied call.
        assert!(
            r.steps[0]
                .observation
                .starts_with("[echo] Permission denied: this tool is blocked."),
            "{}",
            r.steps[0].observation
        );
        assert!(r.steps[0].observation.contains("reason: blocked by policy"));
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
        assert!(
            r.steps[0]
                .observation
                .starts_with("[echo] Permission denied by user. Continue without it."),
            "{}",
            r.steps[0].observation
        );
        assert!(r.steps[0].observation.contains("reason: blocked by policy"));
    }

    #[test]
    fn gate_clamps_and_repairs_tool_calls() {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));

        // A spilled argument is repaired down to the plain string the
        // tool takes, and a clean observation stays clean.
        let mut step = script_step(&[
            r#"{"thought":"try","action":"echo","action_input":"{\"input\":\"hi\"}"}"#,
            r#"{"thought":"ok","action":"Final Answer","action_input":"done"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| true);
        assert_eq!(r.steps[0].observation, "echo:hi");

        // A tool that is not advertised never reaches a handler.
        let mut step = script_step(&[
            r#"{"thought":"try","action":"ghost","action_input":"x"}"#,
            r#"{"thought":"ok","action":"Final Answer","action_input":"done"}"#,
        ]);
        let r = run_agent("task", &mut step, &reg, 5, &|_, _| true);
        assert!(
            r.steps[0].observation.starts_with("tool_clamped"),
            "{}",
            r.steps[0].observation
        );
        assert!(r.steps[0].observation.contains("echo"));
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
