//! WASM bindings for `prism-core` — the contract JS hosts consume.
//!
//! Boundary design (locked in docs/plans/single-core-plan.md):
//! - Hosts drive their own HTTP (fetch/chrome APIs) and feed raw byte
//!   chunks into the decoders; the core owns all parsing and state.
//! - Structured data crosses as JSON strings; byte chunks as
//!   `Uint8Array`.
//! - Decoded events are JSON arrays of externally-tagged `StreamEvent`:
//!   `[{"Chunk":"..."}, "Done"]` / `[{"Error":"..."}]`.
//! - `Result`-shaped parsers return `{"Ok": ...}` / `{"Err": ...}`.
//!
//! A fetch-based Transport inside WASM is intentionally deferred until
//! a JS host needs it (web-app swap); the decoder-first contract is the
//! conformance surface on every target.

use prism_core::client::{NdjsonDecoder as CoreNdjson, SseDecoder as CoreSse, StreamEvent};
use prism_core::conversations;
use prism_core::providers::PROVIDERS;
use prism_core::settings::{self, Settings};
use prism_core::thinking;
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn events_json(events: Vec<StreamEvent>) -> String {
    serde_json::to_string(&events).unwrap_or_else(|e| format!("[{{\"Error\":\"{e}\"}}]"))
}

fn result_json<T: Serialize>(r: &Result<T, String>) -> String {
    match r {
        Ok(v) => serde_json::json!({ "Ok": v }).to_string(),
        Err(e) => serde_json::json!({ "Err": e }).to_string(),
    }
}

/// OpenAI-compatible SSE decoder. Feed response-body bytes; collect the
/// returned event JSON arrays; call `finish` when the stream ends.
#[wasm_bindgen]
pub struct SseDecoder {
    inner: CoreSse,
}

#[wasm_bindgen]
impl SseDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SseDecoder {
        SseDecoder {
            inner: CoreSse::new(),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> String {
        events_json(self.inner.feed(chunk))
    }

    pub fn finish(&mut self) -> String {
        events_json(self.inner.finish())
    }

    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }
}

/// Ollama native NDJSON decoder.
#[wasm_bindgen]
pub struct NdjsonDecoder {
    inner: CoreNdjson,
}

#[wasm_bindgen]
impl NdjsonDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> NdjsonDecoder {
        NdjsonDecoder {
            inner: CoreNdjson::new(),
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> String {
        events_json(self.inner.feed(chunk))
    }

    pub fn finish(&mut self) -> String {
        events_json(self.inner.finish())
    }

    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }
}

/// Parse a prism-api `POST /api/chat` response body.
/// Returns `{"Ok": "..."}` or `{"Err": "..."}`.
#[wasm_bindgen]
pub fn parse_api_response(body: &str) -> String {
    result_json(&prism_core::client::parse_api_response(body))
}

/// Parse an OpenAI-compatible `GET /models` body.
/// Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
#[wasm_bindgen]
pub fn parse_models_response(body: &str) -> String {
    result_json(&prism_core::client::parse_models_response(body))
}

/// Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
#[wasm_bindgen]
pub fn strip_thinking(content: &str) -> String {
    let (content, thinking) = thinking::strip_thinking(content);
    serde_json::to_string(&(content, thinking)).unwrap_or_else(|_| "[\"\",null]".into())
}

/// Prepend the scratchpad instruction to the first user message.
/// Takes and returns a JSON array of `{"role": "...", "content": "..."}`.
#[wasm_bindgen]
pub fn apply_thinking(messages_json: &str) -> String {
    match serde_json::from_str::<Vec<prism_core::client::ChatMessage>>(messages_json) {
        Ok(messages) => {
            let applied = thinking::apply_thinking_to_messages(&messages);
            serde_json::to_string(&applied).unwrap_or_else(|_| "[]".into())
        }
        Err(e) => serde_json::json!([{ "role": "system", "content": format!("apply_thinking: invalid input: {e}") }])
            .to_string(),
    }
}

/// The provider table: id, label, base_url, default_model, needs_key,
/// env (env-var names that may carry the key).
#[wasm_bindgen]
pub fn providers_json() -> String {
    serde_json::json!(PROVIDERS
        .iter()
        .map(|p| serde_json::json!({
            "id": p.id,
            "label": p.label,
            "base_url": p.base_url,
            "default_model": p.default_model,
            "needs_key": p.needs_key,
            "env": p.env,
        }))
        .collect::<Vec<_>>())
    .to_string()
}

/// Default settings as JSON.
#[wasm_bindgen]
pub fn default_settings_json() -> String {
    serde_json::to_string(&Settings::default()).unwrap_or_else(|_| "{}".into())
}

/// Normalize (parse + migrate) settings JSON. Absent fields fill from
/// defaults; the legacy single `api_key` moves into `provider_keys`.
/// Returns `{"Ok": settings}` or `{"Err": message}`.
#[wasm_bindgen]
pub fn normalize_settings_json(input: &str) -> String {
    result_json(&settings::settings_from_json(input).map_err(|e| e.to_string()))
}

/// Auto-title from the first user message (JSON array of messages in).
#[wasm_bindgen]
pub fn derive_title(messages_json: &str) -> String {
    match serde_json::from_str::<Vec<conversations::StoredMessage>>(messages_json) {
        Ok(messages) => conversations::derive_title(&messages).into(),
        Err(_) => "New chat".into(),
    }
}

/// Fresh conversation id (nanosecond hex).
#[wasm_bindgen]
pub fn new_conversation_id() -> String {
    conversations::new_id()
}

/// Ollama native API root from a possibly `/v1`-suffixed base URL.
#[wasm_bindgen]
pub fn ollama_root_url(base_url: &str) -> String {
    prism_core::providers::ollama_root_url(base_url)
}

/// Current unix epoch milliseconds (JS BigInt).
#[wasm_bindgen]
pub fn now_ms() -> u64 {
    conversations::now_ms()
}

// ---------------------------------------------------------------------------
// Request-body builders (the wire contract for hosts that drive HTTP)
// ---------------------------------------------------------------------------

fn parse_req<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid request JSON: {e}"))
}

/// Build the provider POST body for a direct stream request.
/// Input: JSON `StreamRequest` (base_url, api_key, model, temperature,
/// messages, max_tokens?, top_p?, frequency_penalty?, presence_penalty?).
/// Returns `{"Ok": body}` / `{"Err": message}`.
#[wasm_bindgen]
pub fn build_stream_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::StreamRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::stream_request_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}

/// Build the Ollama native `/api/chat` POST body.
/// Input: JSON `OllamaChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
#[wasm_bindgen]
pub fn build_ollama_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::OllamaChatRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::ollama_chat_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}

/// Build the prism-api `/api/chat` POST body.
/// Input: JSON `ApiChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
#[wasm_bindgen]
pub fn build_api_chat_body(req_json: &str) -> String {
    result_json(
        &parse_req::<prism_core::client::ApiChatRequest>(req_json).map(|ref r| {
            serde_json::to_value(prism_core::client::api_chat_body(r))
                .unwrap_or(serde_json::Value::Null)
        }),
    )
}

// ---- agent loop (extension system) ------------------------------------

use prism_core::agent::{run_with_strategy, AgentResult, AgentStrategy, Permission, StepMessage, ToolRegistry};
use std::cell::RefCell;
use std::rc::Rc;

/// A JS-registered tool: the host supplies `execute(input) -> string`.
/// This is the extension point — surfaces register domain tools (page
/// context, snippets, editor state) and the core loop dispatches them.
#[wasm_bindgen]
pub struct JsTool {
    name: String,
    description: String,
    execute: js_sys::Function,
}

#[wasm_bindgen]
impl JsTool {
    /// `execute` must be a JS function `(input: string) => string`.
    #[wasm_bindgen(constructor)]
    pub fn new(name: String, description: String, execute: js_sys::Function) -> JsTool {
        JsTool { name, description, execute }
    }
}

impl prism_core::agent::Tool for JsTool {
    fn name(&self) -> &str {
        &self.name
    }
    fn description(&self) -> &str {
        &self.description
    }
    fn execute(&self, input: &str) -> String {
        let this = wasm_bindgen::JsValue::NULL;
        let arg = wasm_bindgen::JsValue::from_str(input);
        match self.execute.call1(&this, &arg) {
            Ok(v) => v.as_string().unwrap_or_else(|| String::from("[tool] non-string result")),
            Err(e) => format!("[{}] Error: {}", self.name, e.as_string().unwrap_or_default()),
        }
    }
}

/// A registry instance the JS host drives across steps.
#[wasm_bindgen]
pub struct AgentRegistry {
    inner: Rc<RefCell<ToolRegistry>>,
}

#[wasm_bindgen]
impl AgentRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new() -> AgentRegistry {
        let reg = ToolRegistry::new();
        // Built-ins: deterministic calculator always useful; web search
        // stub replaced when the host registers a real one under the
        // same name (register overwrites).
        reg.register(std::sync::Arc::new(prism_core::agent::CalculatorTool));
        reg.register(std::sync::Arc::new(prism_core::agent::WebSearchStubTool));
        AgentRegistry { inner: Rc::new(RefCell::new(reg)) }
    }

    /// Register (or replace) a tool. Extension point.
    pub fn register(&self, tool: JsTool) {
        self.inner.borrow_mut().register(std::sync::Arc::new(tool));
    }

    /// Set a tool's permission: "allow" | "deny" | "ask".
    pub fn set_permission(&self, name: &str, level: &str) {
        let level = match level {
            "deny" => Permission::Deny,
            "ask" => Permission::Ask,
            _ => Permission::Allow,
        };
        self.inner.borrow_mut().set_permission(name, level);
    }

    /// Execute a tool directly (permission-gated). `ask_fn` is a JS
    /// function `(toolName, input) => bool`.
    pub fn execute(&self, name: &str, input: &str, ask_fn: js_sys::Function) -> String {
        let ask = |tool: &str, input: &str| -> bool {
            let this = wasm_bindgen::JsValue::NULL;
            let r = ask_fn.call2(
                &this,
                &wasm_bindgen::JsValue::from_str(tool),
                &wasm_bindgen::JsValue::from_str(input),
            );
            matches!(r, Ok(v) if v.is_truthy())
        };
        self.inner.borrow().execute(name, input, &ask)
    }
}

/// One complete agent run. `llm_step` is a JS function
/// `(system: string, historyJson: string) => string` returning the raw
/// model response (throw/reject to signal an error). `strategy` is
/// "react" (default) or "plan-and-execute". Returns JSON `AgentResult`
/// (`{answer, steps, completed, error}`).
#[wasm_bindgen]
pub fn agent_run(
    task: &str,
    registry: &AgentRegistry,
    llm_step: js_sys::Function,
    max_steps: usize,
    strategy: &str,
) -> String {
    let strategy = match strategy {
        "plan-and-execute" => AgentStrategy::PlanAndExecute,
        _ => AgentStrategy::React,
    };
    let result: std::result::Result<AgentResult, String> = (|| {
        let step_fn = |_system: &str, hist: &[StepMessage]| -> Result<String, String> {
            let hist_json = serde_json::to_string(hist).unwrap_or_else(|_| "[]".into());
            let this = wasm_bindgen::JsValue::NULL;
            let r = llm_step.call2(
                &this,
                &wasm_bindgen::JsValue::from_str(_system),
                &wasm_bindgen::JsValue::from_str(&hist_json),
            );
            match r {
                Ok(v) => v
                    .as_string()
                    .ok_or_else(|| String::from("llm_step returned non-string")),
                Err(e) => Err(e.as_string().unwrap_or_else(|| String::from("llm_step threw"))),
            }
        };
        let mut step_fn = step_fn;
        Ok(run_with_strategy(
            task,
            &mut step_fn,
            &registry.inner.borrow(),
            max_steps,
            &|_, _| false, // headless: ask-permission tools deny unless host flips to allow
            strategy,
        ))
    })();
    match result {
        Ok(r) => serde_json::to_string(&r).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}")),
        // serde_json escaping: the error text can contain quotes.
        Err(e) => serde_json::json!({
            "completed": false,
            "error": e,
            "answer": "",
            "steps": [],
        })
        .to_string(),
    }
}

/// Preflight + plan a sandbox policy without spawning anything. Input:
/// JSON `SandboxPolicy` (the helper's `--policy` shape). Returns JSON
/// `{ok, sandbox_used, error}` where `error` is the closed
/// `SpawnOutcome` (`sandbox_unsupported` on hosts without Landlock).
/// Identical to the CLI's `prism sandbox preflight --policy` gate.
#[wasm_bindgen]
pub fn agent_sandbox_policy_check(policy_json: &str) -> String {
    let check = (|| -> std::result::Result<serde_json::Value, String> {
        let policy = prism_core::sandbox::parse_policy(policy_json)?;
        let res = prism_core::sandbox::resolve_policy(&policy);
        match prism_core::sandbox::plan_spawn(&res) {
            Ok(used) => Ok(serde_json::json!({ "ok": true, "sandbox_used": used })),
            Err(outcome) => Ok(serde_json::json!({ "ok": false, "error": outcome })),
        }
    })();
    match check {
        Ok(v) => v.to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
    }
}

/// Repair a model-produced tool argument into the plain string input the
/// core tools take. Recommended to run before dispatching any tool call.
/// Returns JSON `{input, notes: [...]}` — notes name every normalisation
/// applied, so a surface can log the repair.
#[wasm_bindgen]
pub fn agent_tool_repair(raw_input: &str) -> String {
    let report = prism_core::toolgate::repair_tool_input(raw_input);
    serde_json::to_string(&serde_json::json!({
        "input": report.input,
        "notes": report.notes,
    }))
    .unwrap_or_else(|_| "{}".into())
}

/// Classify a tool observation and get the actionable detail appended
/// the way `gated_execute` does. Returns `{kind, detail: string|null}`.
#[wasm_bindgen]
pub fn agent_tool_classify(observation: &str) -> String {
    let kind = prism_core::toolgate::ToolErrorKind::from_observation(observation);
    serde_json::to_string(&serde_json::json!({
        "kind": kind_name(kind),
        "detail": prism_core::toolgate::detail_of(kind),
    }))
    .unwrap_or_else(|_| "{}".into())
}

/// Clamp a tool call to the advertised surface. Input: JSON
/// `{"advertised": ["name", ...], "tool": "name"}`. Returns
/// `{"ok": true}` when the tool is advertised (or is `Final Answer`),
/// `{"ok": false, "error": "tool_clamped: ..."}` otherwise — the same
/// fail-closed answer the core's gated execution gives.
#[wasm_bindgen]
pub fn agent_tool_clamp(req_json: &str) -> String {
    let clamped = (|| -> std::result::Result<serde_json::Value, String> {
        let req: serde_json::Value = serde_json::from_str(req_json)
            .map_err(|e| format!("invalid request JSON: {e}"))?;
        let advertised = req
            .get("advertised")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "missing field `advertised`".to_string())?
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>();
        let tool = req
            .get("tool")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing field `tool`".to_string())?;
        let surface = prism_core::toolgate::AdvertisedTools::from_list(
            advertised
                .into_iter()
                .map(|name| prism_core::toolgate::AdvertisedTool {
                    name,
                    description: String::new(),
                })
                .collect(),
        );
        match prism_core::toolgate::clamp_advertised_tools(&surface, tool) {
            Ok(()) => Ok(serde_json::json!({ "ok": true })),
            Err(e) => Ok(serde_json::json!({ "ok": false, "error": e })),
        }
    })();
    match clamped {
        Ok(v) => v.to_string(),
        Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
    }
}

fn kind_name(kind: prism_core::toolgate::ToolErrorKind) -> &'static str {
    match kind {
        prism_core::toolgate::ToolErrorKind::NotRecognized => "not_recognized",
        prism_core::toolgate::ToolErrorKind::PermissionDenied => "permission_denied",
        prism_core::toolgate::ToolErrorKind::InvalidInput => "invalid_input",
        prism_core::toolgate::ToolErrorKind::NotFound => "not_found",
        prism_core::toolgate::ToolErrorKind::Environment => "environment",
        prism_core::toolgate::ToolErrorKind::None => "none",
    }
}

/// List the shipped subagent registry (names + tool allowlists). The
/// surfaces use it to advertise `task_*` tools.
#[wasm_bindgen]
pub fn agent_subagents_list() -> String {
    let reg = prism_core::subagents::SubagentRegistry::default();
    serde_json::to_string(
        &reg.names()
            .iter()
            .filter_map(|n| reg.get(n).cloned())
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".into())
}

/// Forced-model resolution for one subagent — the daemon's documented
/// order: the spec's `forced_model`, then the session host model, then
/// the provider default. Returns `{model, tier: subagent_forced|session|
/// provider_default}` or JSON error when nothing resolves.#[wasm_bindgen]
pub fn agent_subagent_resolve_model(name: &str, session_model: &str, provider_default: Option<String>) -> String {
    let reg = prism_core::subagents::SubagentRegistry::default();
    match reg.resolve_model(name, session_model, provider_default) {
        Ok(r) => serde_json::to_string(&r).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}")),
        // serde_json escaping matters here: the message quotes the
        // subagent name, which would break a hand-built JSON string.
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

/// Effective tool surface for one subagent — the core's clamp: the
/// allowlist intersected with the advertised surface. An empty
/// allowlist means "the full surface"; a total miss is a JSON error.
#[wasm_bindgen]
pub fn agent_subagent_clamp_tools(name: &str, advertised: Vec<String>) -> String {
    let reg = prism_core::subagents::SubagentRegistry::default();
    match reg.clamp_tools(name, &advertised) {
        Ok(t) => serde_json::to_string(&t).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}")),
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    }
}

// ---- character cards / persona / lore / prompt assembly ------------------

use prism_core::cards::{
    self, parse_card, scan_lore as core_scan_lore, CharacterBook, CharacterCard, LoreEntry,
    LoreScan, MacroContext, Persona,
};

/// Parse a character card (V2 file, direct V2, or V1). Returns
/// `{"Ok": card}` / `{"Err": msg}`.
#[wasm_bindgen]
pub fn parse_character_card(json: &str) -> String {
    result_json(&parse_card(json).map_err(|e| e))
}

/// Expand SillyTavern macros in a template.
/// Input: JSON `[template, MacroContext]`. Returns the expanded string.
#[wasm_bindgen]
pub fn expand_macros(template: &str, context_json: &str) -> String {
    match serde_json::from_str::<MacroContext>(context_json) {
        Ok(ctx) => cards::expand_macros(template, &ctx),
        Err(e) => format!("{{\"Err\":\"macro context json: {e}\"}}"),
    }
}

/// Scan a lore book against chat text.
/// Input: JSON `[chat_text, history: string[], CharacterBook]`.
/// Returns JSON `LoreScan`.
#[wasm_bindgen]
pub fn scan_lore(chat_text: &str, history_json: &str, book_json: &str) -> String {
    let history: Vec<String> = serde_json::from_str(history_json).unwrap_or_default();
    let book: CharacterBook = match serde_json::from_str(book_json) {
        Ok(b) => b,
        Err(e) => return format!("{{\"Err\":\"book json: {e}\"}}"),
    };
    serde_json::to_string(&core_scan_lore(&book, chat_text, &history))
        .unwrap_or_else(|e| format!("{{\"Err\":\"{e}\"}}"))
}

/// Assemble the SillyTavern-style prompt.
/// Input: JSON `[CharacterCard, Persona, history: ChatMessage[],
///              LoreScan|null, user_input, system_override|null]`.
/// Returns JSON `Vec<ChatMessage>`.
#[wasm_bindgen]
pub fn build_prompt(request_json: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Req {
        card: CharacterCard,
        persona: Persona,
        history: Vec<prism_core::client::ChatMessage>,
        lore: Option<LoreScan>,
        user_input: String,
        system_override: Option<String>,
    }
    match serde_json::from_str::<Req>(request_json) {
        Ok(r) => {
            let lore = r.lore.unwrap_or_default();
            let msgs = cards::build_messages(
                &r.card,
                &r.persona,
                &r.history,
                &lore,
                &r.user_input,
                r.system_override.as_deref(),
            );
            serde_json::to_string(&msgs).unwrap_or_else(|e| format!("{{\"Err\":\"{e}\"}}"))
        }
        Err(e) => format!("{{\"Err\":\"build_prompt json: {e}\"}}"),
    }
}

/// Serialize an empty LoreScan (for callers that have no book yet).
#[wasm_bindgen]
pub fn empty_lore_scan() -> String {
    serde_json::to_string(&LoreScan::default()).unwrap_or_else(|_| "{}".into())
}

/// Validate a lore entry's shapes (keys arrays, position string).
/// Returns `{"Ok": true}` / `{"Err": msg}`.
#[wasm_bindgen]
pub fn validate_lore_entry(entry_json: &str) -> String {
    match serde_json::from_str::<LoreEntry>(entry_json) {
        Ok(e) => {
            if e.keys.is_empty() && !e.constant {
                r#"{"Err":"entry needs keys or constant=true"}"#.into()
            } else {
                r#"{"Ok":true}"#.into()
            }
        }
        Err(e) => format!("{{\"Err\":\"entry json: {e}\"}}"),
    }
}

/// Position labels for UI dropdowns: JSON array of
/// `[{"position":"before_char","label":"Before character"}, …]`.
#[wasm_bindgen]
pub fn lore_position_labels() -> String {
    serde_json::json!([
        { "position": "before_char", "label": "Before character" },
        { "position": "after_char", "label": "After character" },
    ])
    .to_string()
}
