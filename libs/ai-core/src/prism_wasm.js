/* @ts-self-types="./prism_wasm.d.ts" */

/**
 * A registry instance the JS host drives across steps.
 */
export class AgentRegistry {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AgentRegistryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_agentregistry_free(ptr, 0);
    }
    /**
     * Execute a tool directly (permission-gated). `ask_fn` is a JS
     * function `(toolName, input) => bool`.
     * @param {string} name
     * @param {string} input
     * @param {Function} ask_fn
     * @returns {string}
     */
    execute(name, input, ask_fn) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.agentregistry_execute(this.__wbg_ptr, ptr0, len0, ptr1, len1, ask_fn);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    constructor() {
        const ret = wasm.agentregistry_new();
        this.__wbg_ptr = ret;
        AgentRegistryFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Register (or replace) a tool. Extension point.
     * @param {JsTool} tool
     */
    register(tool) {
        _assertClass(tool, JsTool);
        var ptr0 = tool.__destroy_into_raw();
        wasm.agentregistry_register(this.__wbg_ptr, ptr0);
    }
    /**
     * Set a tool's permission: "allow" | "deny" | "ask".
     * @param {string} name
     * @param {string} level
     */
    set_permission(name, level) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.agentregistry_set_permission(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
}
if (Symbol.dispose) AgentRegistry.prototype[Symbol.dispose] = AgentRegistry.prototype.free;

/**
 * A JS-registered tool: the host supplies `execute(input) -> string`.
 * This is the extension point — surfaces register domain tools (page
 * context, snippets, editor state) and the core loop dispatches them.
 */
export class JsTool {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsToolFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jstool_free(ptr, 0);
    }
    /**
     * `execute` must be a JS function `(input: string) => string`.
     * @param {string} name
     * @param {string} description
     * @param {Function} execute
     */
    constructor(name, description, execute) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.jstool_new(ptr0, len0, ptr1, len1, execute);
        this.__wbg_ptr = ret;
        JsToolFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) JsTool.prototype[Symbol.dispose] = JsTool.prototype.free;

/**
 * Ollama native NDJSON decoder.
 */
export class NdjsonDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NdjsonDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ndjsondecoder_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} chunk
     * @returns {string}
     */
    feed(chunk) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.ndjsondecoder_feed(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    finish() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.ndjsondecoder_finish(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.ndjsondecoder_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.ndjsondecoder_new();
        this.__wbg_ptr = ret;
        NdjsonDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) NdjsonDecoder.prototype[Symbol.dispose] = NdjsonDecoder.prototype.free;

/**
 * OpenAI-compatible SSE decoder. Feed response-body bytes; collect the
 * returned event JSON arrays; call `finish` when the stream ends.
 */
export class SseDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SseDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ssedecoder_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} chunk
     * @returns {string}
     */
    feed(chunk) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.ssedecoder_feed(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    finish() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.ssedecoder_finish(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.ssedecoder_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.ssedecoder_new();
        this.__wbg_ptr = ret;
        SseDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) SseDecoder.prototype[Symbol.dispose] = SseDecoder.prototype.free;

/**
 * One complete agent run. `llm_step` is a JS function
 * `(system: string, historyJson: string) => string` returning the raw
 * model response (throw/reject to signal an error). Returns JSON
 * `AgentResult` (`{answer, steps, completed, error}`).
 * @param {string} task
 * @param {AgentRegistry} registry
 * @param {Function} llm_step
 * @param {number} max_steps
 * @returns {string}
 */
export function agent_run(task, registry, llm_step, max_steps) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(task, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(registry, AgentRegistry);
        const ret = wasm.agent_run(ptr0, len0, registry.__wbg_ptr, llm_step, max_steps);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Preflight + plan a sandbox policy without spawning anything. Input:
 * JSON `SandboxPolicy` (the helper's `--policy` shape). Returns JSON
 * `{ok, sandbox_used, error}` where `error` is the closed
 * `SpawnOutcome` (`sandbox_unsupported` on hosts without Landlock).
 * Identical to the CLI's `prism sandbox preflight --policy` gate.
 * @param {string} policy_json
 * @returns {string}
 */
export function agent_sandbox_policy_check(policy_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(policy_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.agent_sandbox_policy_check(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Forced-model resolution for one subagent — the daemon's documented
 * order: the spec's `forced_model`, then the session host model, then
 * the provider default. Returns `{model, tier: subagent_forced|session|
 * provider_default}` or JSON error when nothing resolves.
 * @param {string} name
 * @param {string} session_model
 * @param {string | null} [provider_default]
 * @returns {string}
 */
export function agent_subagent_resolve_model(name, session_model, provider_default) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(session_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(provider_default) ? 0 : passStringToWasm0(provider_default, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.agent_subagent_resolve_model(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * List the shipped subagent registry (names + tool allowlists). The
 * surfaces use it to advertise `task_*` tools.
 * @returns {string}
 */
export function agent_subagents_list() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.agent_subagents_list();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Clamp a tool call to the advertised surface. Input: JSON
 * `{"advertised": ["name", ...], "tool": "name"}`. Returns
 * `{"ok": true}` when the tool is advertised (or is `Final Answer`),
 * `{"ok": false, "error": "tool_clamped: ..."}` otherwise — the same
 * fail-closed answer the core's gated execution gives.
 * @param {string} req_json
 * @returns {string}
 */
export function agent_tool_clamp(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.agent_tool_clamp(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Classify a tool observation and get the actionable detail appended
 * the way `gated_execute` does. Returns `{kind, detail: string|null}`.
 * @param {string} observation
 * @returns {string}
 */
export function agent_tool_classify(observation) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(observation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.agent_tool_classify(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Repair a model-produced tool argument into the plain string input the
 * core tools take. Recommended to run before dispatching any tool call.
 * Returns JSON `{input, notes: [...]}` — notes name every normalisation
 * applied, so a surface can log the repair.
 * @param {string} raw_input
 * @returns {string}
 */
export function agent_tool_repair(raw_input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw_input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.agent_tool_repair(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Prepend the scratchpad instruction to the first user message.
 * Takes and returns a JSON array of `{"role": "...", "content": "..."}`.
 * @param {string} messages_json
 * @returns {string}
 */
export function apply_thinking(messages_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.apply_thinking(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Build the prism-api `/api/chat` POST body.
 * Input: JSON `ApiChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 * @param {string} req_json
 * @returns {string}
 */
export function build_api_chat_body(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.build_api_chat_body(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Build the Ollama native `/api/chat` POST body.
 * Input: JSON `OllamaChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 * @param {string} req_json
 * @returns {string}
 */
export function build_ollama_body(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.build_ollama_body(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Assemble the SillyTavern-style prompt.
 * Input: JSON `[CharacterCard, Persona, history: ChatMessage[],
 *              LoreScan|null, user_input, system_override|null]`.
 * Returns JSON `Vec<ChatMessage>`.
 * @param {string} request_json
 * @returns {string}
 */
export function build_prompt(request_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(request_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.build_prompt(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Build the provider POST body for a direct stream request.
 * Input: JSON `StreamRequest` (base_url, api_key, model, temperature,
 * messages, max_tokens?, top_p?, frequency_penalty?, presence_penalty?).
 * Returns `{"Ok": body}` / `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
export function build_stream_body(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.build_stream_body(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Default settings as JSON.
 * @returns {string}
 */
export function default_settings_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.default_settings_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Auto-title from the first user message (JSON array of messages in).
 * @param {string} messages_json
 * @returns {string}
 */
export function derive_title(messages_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.derive_title(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Serialize an empty LoreScan (for callers that have no book yet).
 * @returns {string}
 */
export function empty_lore_scan() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.empty_lore_scan();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Expand SillyTavern macros in a template.
 * Input: JSON `[template, MacroContext]`. Returns the expanded string.
 * @param {string} template
 * @param {string} context_json
 * @returns {string}
 */
export function expand_macros(template, context_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.expand_macros(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Position labels for UI dropdowns: JSON array of
 * `[{"position":"before_char","label":"Before character"}, …]`.
 * @returns {string}
 */
export function lore_position_labels() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.lore_position_labels();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Fresh conversation id (nanosecond hex).
 * @returns {string}
 */
export function new_conversation_id() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.new_conversation_id();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Normalize (parse + migrate) settings JSON. Absent fields fill from
 * defaults; the legacy single `api_key` moves into `provider_keys`.
 * Returns `{"Ok": settings}` or `{"Err": message}`.
 * @param {string} input
 * @returns {string}
 */
export function normalize_settings_json(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_settings_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Current unix epoch milliseconds (JS BigInt).
 * @returns {bigint}
 */
export function now_ms() {
    const ret = wasm.now_ms();
    return BigInt.asUintN(64, ret);
}

/**
 * Ollama native API root from a possibly `/v1`-suffixed base URL.
 * @param {string} base_url
 * @returns {string}
 */
export function ollama_root_url(base_url) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ollama_root_url(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Parse a prism-api `POST /api/chat` response body.
 * Returns `{"Ok": "..."}` or `{"Err": "..."}`.
 * @param {string} body
 * @returns {string}
 */
export function parse_api_response(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_api_response(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Parse a character card (V2 file, direct V2, or V1). Returns
 * `{"Ok": card}` / `{"Err": msg}`.
 * @param {string} json
 * @returns {string}
 */
export function parse_character_card(json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_character_card(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Parse an OpenAI-compatible `GET /models` body.
 * Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
 * @param {string} body
 * @returns {string}
 */
export function parse_models_response(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_models_response(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * The provider table: id, label, base_url, default_model, needs_key,
 * env (env-var names that may carry the key).
 * @returns {string}
 */
export function providers_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.providers_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Scan a lore book against chat text.
 * Input: JSON `[chat_text, history: string[], CharacterBook]`.
 * Returns JSON `LoreScan`.
 * @param {string} chat_text
 * @param {string} history_json
 * @param {string} book_json
 * @returns {string}
 */
export function scan_lore(chat_text, history_json, book_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(chat_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(history_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(book_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.scan_lore(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
 * @param {string} content
 * @returns {string}
 */
export function strip_thinking(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.strip_thinking(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Validate a lore entry's shapes (keys arrays, position string).
 * Returns `{"Ok": true}` / `{"Err": msg}`.
 * @param {string} entry_json
 * @returns {string}
 */
export function validate_lore_entry(entry_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(entry_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validate_lore_entry(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_falsy_16bd49b68658263e: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_1875a20c43a36133: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_call_187d372bd5fdd4aa: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./prism_wasm_bg.js": import0,
    };
}

const AgentRegistryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_agentregistry_free(ptr, 1));
const JsToolFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jstool_free(ptr, 1));
const NdjsonDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ndjsondecoder_free(ptr, 1));
const SseDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ssedecoder_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('prism_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
