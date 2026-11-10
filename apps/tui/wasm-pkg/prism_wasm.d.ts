/* tslint:disable */
/* eslint-disable */

/**
 * A registry instance the JS host drives across steps.
 */
export class AgentRegistry {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Execute a tool directly (permission-gated). `ask_fn` is a JS
     * function `(toolName, input) => bool`.
     */
    execute(name: string, input: string, ask_fn: Function): string;
    constructor();
    /**
     * Register (or replace) a tool. Extension point.
     */
    register(tool: JsTool): void;
    /**
     * Set a tool's permission: "allow" | "deny" | "ask".
     */
    set_permission(name: string, level: string): void;
}

/**
 * A JS-registered tool: the host supplies `execute(input) -> string`.
 * This is the extension point — surfaces register domain tools (page
 * context, snippets, editor state) and the core loop dispatches them.
 */
export class JsTool {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `execute` must be a JS function `(input: string) => string`.
     */
    constructor(name: string, description: string, execute: Function);
}

/**
 * Ollama native NDJSON decoder.
 */
export class NdjsonDecoder {
    free(): void;
    [Symbol.dispose](): void;
    feed(chunk: Uint8Array): string;
    finish(): string;
    is_done(): boolean;
    constructor();
}

/**
 * OpenAI-compatible SSE decoder. Feed response-body bytes; collect the
 * returned event JSON arrays; call `finish` when the stream ends.
 */
export class SseDecoder {
    free(): void;
    [Symbol.dispose](): void;
    feed(chunk: Uint8Array): string;
    finish(): string;
    is_done(): boolean;
    constructor();
}

/**
 * One complete agent run. `llm_step` is a JS function
 * `(system: string, historyJson: string) => string` returning the raw
 * model response (throw/reject to signal an error). `strategy` is
 * "react" (default) or "plan-and-execute". Returns JSON `AgentResult`
 * (`{answer, steps, completed, error}`).
 */
export function agent_run(task: string, registry: AgentRegistry, llm_step: Function, max_steps: number, strategy: string): string;

/**
 * Preflight + plan a sandbox policy without spawning anything. Input:
 * JSON `SandboxPolicy` (the helper's `--policy` shape). Returns JSON
 * `{ok, sandbox_used, error}` where `error` is the closed
 * `SpawnOutcome` (`sandbox_unsupported` on hosts without Landlock).
 * Identical to the CLI's `prism sandbox preflight --policy` gate.
 */
export function agent_sandbox_policy_check(policy_json: string): string;

/**
 * Forced-model resolution for one subagent — the daemon's documented
 * order: the spec's `forced_model`, then the session host model, then
 * the provider default. Returns `{model, tier: subagent_forced|session|
 * provider_default}` or JSON error when nothing resolves.
 */
export function agent_subagent_resolve_model(name: string, session_model: string, provider_default?: string | null): string;

/**
 * List the shipped subagent registry (names + tool allowlists). The
 * surfaces use it to advertise `task_*` tools.
 */
export function agent_subagents_list(): string;

/**
 * Clamp a tool call to the advertised surface. Input: JSON
 * `{"advertised": ["name", ...], "tool": "name"}`. Returns
 * `{"ok": true}` when the tool is advertised (or is `Final Answer`),
 * `{"ok": false, "error": "tool_clamped: ..."}` otherwise — the same
 * fail-closed answer the core's gated execution gives.
 */
export function agent_tool_clamp(req_json: string): string;

/**
 * Classify a tool observation and get the actionable detail appended
 * the way `gated_execute` does. Returns `{kind, detail: string|null}`.
 */
export function agent_tool_classify(observation: string): string;

/**
 * Repair a model-produced tool argument into the plain string input the
 * core tools take. Recommended to run before dispatching any tool call.
 * Returns JSON `{input, notes: [...]}` — notes name every normalisation
 * applied, so a surface can log the repair.
 */
export function agent_tool_repair(raw_input: string): string;

/**
 * Prepend the scratchpad instruction to the first user message.
 * Takes and returns a JSON array of `{"role": "...", "content": "..."}`.
 */
export function apply_thinking(messages_json: string): string;

/**
 * Build the prism-api `/api/chat` POST body.
 * Input: JSON `ApiChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 */
export function build_api_chat_body(req_json: string): string;

/**
 * Build the Ollama native `/api/chat` POST body.
 * Input: JSON `OllamaChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 */
export function build_ollama_body(req_json: string): string;

/**
 * Assemble the SillyTavern-style prompt.
 * Input: JSON `[CharacterCard, Persona, history: ChatMessage[],
 *              LoreScan|null, user_input, system_override|null]`.
 * Returns JSON `Vec<ChatMessage>`.
 */
export function build_prompt(request_json: string): string;

/**
 * Build the provider POST body for a direct stream request.
 * Input: JSON `StreamRequest` (base_url, api_key, model, temperature,
 * messages, max_tokens?, top_p?, frequency_penalty?, presence_penalty?).
 * Returns `{"Ok": body}` / `{"Err": message}`.
 */
export function build_stream_body(req_json: string): string;

/**
 * Default settings as JSON.
 */
export function default_settings_json(): string;

/**
 * Auto-title from the first user message (JSON array of messages in).
 */
export function derive_title(messages_json: string): string;

/**
 * Serialize an empty LoreScan (for callers that have no book yet).
 */
export function empty_lore_scan(): string;

/**
 * Expand SillyTavern macros in a template.
 * Input: JSON `[template, MacroContext]`. Returns the expanded string.
 */
export function expand_macros(template: string, context_json: string): string;

/**
 * Position labels for UI dropdowns: JSON array of
 * `[{"position":"before_char","label":"Before character"}, …]`.
 */
export function lore_position_labels(): string;

/**
 * Fresh conversation id (nanosecond hex).
 */
export function new_conversation_id(): string;

/**
 * Normalize (parse + migrate) settings JSON. Absent fields fill from
 * defaults; the legacy single `api_key` moves into `provider_keys`.
 * Returns `{"Ok": settings}` or `{"Err": message}`.
 */
export function normalize_settings_json(input: string): string;

/**
 * Current unix epoch milliseconds (JS BigInt).
 */
export function now_ms(): bigint;

/**
 * Ollama native API root from a possibly `/v1`-suffixed base URL.
 */
export function ollama_root_url(base_url: string): string;

/**
 * Parse a prism-api `POST /api/chat` response body.
 * Returns `{"Ok": "..."}` or `{"Err": "..."}`.
 */
export function parse_api_response(body: string): string;

/**
 * Parse a character card (V2 file, direct V2, or V1). Returns
 * `{"Ok": card}` / `{"Err": msg}`.
 */
export function parse_character_card(json: string): string;

/**
 * Parse an OpenAI-compatible `GET /models` body.
 * Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
 */
export function parse_models_response(body: string): string;

/**
 * The provider table: id, label, base_url, default_model, needs_key,
 * env (env-var names that may carry the key).
 */
export function providers_json(): string;

/**
 * Scan a lore book against chat text.
 * Input: JSON `[chat_text, history: string[], CharacterBook]`.
 * Returns JSON `LoreScan`.
 */
export function scan_lore(chat_text: string, history_json: string, book_json: string): string;

/**
 * Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
 */
export function strip_thinking(content: string): string;

/**
 * Validate a lore entry's shapes (keys arrays, position string).
 * Returns `{"Ok": true}` / `{"Err": msg}`.
 */
export function validate_lore_entry(entry_json: string): string;
