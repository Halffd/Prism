/* @ts-self-types="./prism_wasm.d.ts" */

/**
 * A registry instance the JS host drives across steps.
 */
class AgentRegistry {
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
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
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
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        wasm.agentregistry_set_permission(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
}
if (Symbol.dispose) AgentRegistry.prototype[Symbol.dispose] = AgentRegistry.prototype.free;
exports.AgentRegistry = AgentRegistry;

/**
 * A JS-registered tool: the host supplies `execute(input) -> string`.
 * This is the extension point — surfaces register domain tools (page
 * context, snippets, editor state) and the core loop dispatches them.
 */
class JsTool {
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
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(description, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.jstool_new(ptr0, len0, ptr1, len1, execute);
        this.__wbg_ptr = ret;
        JsToolFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) JsTool.prototype[Symbol.dispose] = JsTool.prototype.free;
exports.JsTool = JsTool;

/**
 * Ollama native NDJSON decoder.
 */
class NdjsonDecoder {
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
     * @param {Uint8Array | number[]} chunk
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
exports.NdjsonDecoder = NdjsonDecoder;

/**
 * OpenAI-compatible SSE decoder. Feed response-body bytes; collect the
 * returned event JSON arrays; call `finish` when the stream ends.
 */
class SseDecoder {
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
     * @param {Uint8Array | number[]} chunk
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
exports.SseDecoder = SseDecoder;

/**
 * One complete agent run. `llm_step` is a JS function
 * `(system: string, historyJson: string) => string` returning the raw
 * model response (throw/reject to signal an error). `strategy` is
 * "react" (default) or "plan-and-execute". Returns JSON `AgentResult`
 * (`{answer, steps, completed, error}`).
 * @param {string} task
 * @param {AgentRegistry} registry
 * @param {Function} llm_step
 * @param {number} max_steps
 * @param {string} strategy
 * @returns {string}
 */
function agent_run(task, registry, llm_step, max_steps, strategy) {
    let deferred4_0;
    let deferred4_1;
    try {
        _assertClass(registry, AgentRegistry);
        const val3 = +max_steps;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(task, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(strategy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.agent_run(ptr0, len0, registry.__wbg_ptr, llm_step, val3, ptr1, len1);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.agent_run = agent_run;

/**
 * Preflight + plan a sandbox policy without spawning anything. Input:
 * JSON `SandboxPolicy` (the helper's `--policy` shape). Returns JSON
 * `{ok, sandbox_used, error}` where `error` is the closed
 * `SpawnOutcome` (`sandbox_unsupported` on hosts without Landlock).
 * Identical to the CLI's `prism sandbox preflight --policy` gate.
 * @param {string} policy_json
 * @returns {string}
 */
function agent_sandbox_policy_check(policy_json) {
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
exports.agent_sandbox_policy_check = agent_sandbox_policy_check;

/**
 * Effective tool surface for one subagent — the core's clamp: the
 * allowlist intersected with the advertised surface. An empty
 * allowlist means "the full surface"; a total miss is a JSON error.
 * @param {string} name
 * @param {string[]} advertised
 * @returns {string}
 */
function agent_subagent_clamp_tools(name, advertised) {
    let deferred3_0;
    let deferred3_1;
    try {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArrayJsValueToWasm0(advertised, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__externref_drop_slice(ptr1, len1); wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.agent_subagent_clamp_tools(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.agent_subagent_clamp_tools = agent_subagent_clamp_tools;

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
function agent_subagent_resolve_model(name, session_model, provider_default) {
    let deferred4_0;
    let deferred4_1;
    try {
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(session_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = isLikeNone(provider_default) ? 0 : passStringToWasm0(provider_default, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.agent_subagent_resolve_model(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.agent_subagent_resolve_model = agent_subagent_resolve_model;

/**
 * List the shipped subagent registry (names + tool allowlists). The
 * surfaces use it to advertise `task_*` tools.
 * @returns {string}
 */
function agent_subagents_list() {
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
exports.agent_subagents_list = agent_subagents_list;

/**
 * Clamp a tool call to the advertised surface. Input: JSON
 * `{"advertised": ["name", ...], "tool": "name"}`. Returns
 * `{"ok": true}` when the tool is advertised (or is `Final Answer`),
 * `{"ok": false, "error": "tool_clamped: ..."}` otherwise — the same
 * fail-closed answer the core's gated execution gives.
 * @param {string} req_json
 * @returns {string}
 */
function agent_tool_clamp(req_json) {
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
exports.agent_tool_clamp = agent_tool_clamp;

/**
 * Classify a tool observation and get the actionable detail appended
 * the way `gated_execute` does. Returns `{kind, detail: string|null}`.
 * @param {string} observation
 * @returns {string}
 */
function agent_tool_classify(observation) {
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
exports.agent_tool_classify = agent_tool_classify;

/**
 * Repair a model-produced tool argument into the plain string input the
 * core tools take. Recommended to run before dispatching any tool call.
 * Returns JSON `{input, notes: [...]}` — notes name every normalisation
 * applied, so a surface can log the repair.
 * @param {string} raw_input
 * @returns {string}
 */
function agent_tool_repair(raw_input) {
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
exports.agent_tool_repair = agent_tool_repair;

/**
 * Prepend the scratchpad instruction to the first user message.
 * Takes and returns a JSON array of `{"role": "...", "content": "..."}`.
 * @param {string} messages_json
 * @returns {string}
 */
function apply_thinking(messages_json) {
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
exports.apply_thinking = apply_thinking;

/**
 * Build a backup envelope from conversations.
 *
 * Input: JSON `{"conversations": [...], "now_ms": n?}`.
 * Returns JSON `{"Ok": <BackupEnvelope>}` / `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
function backup_export(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.backup_export(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.backup_export = backup_export;

/**
 * Import a backup file into an existing conversation list.
 *
 * Input: JSON `{"raw": "<file text>", "existing": [<Conversation>...],
 * "mode": "replace" | "merge"}`. Returns the merged list plus the
 * outcome.
 * @param {string} req_json
 * @returns {string}
 */
function backup_import(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.backup_import(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.backup_import = backup_import;

/**
 * Parse a backup file.
 *
 * Returns JSON `{"Ok": [<Conversation>...]}` on success, or
 * `{"Err": {"Corrupt": {"reason": "..."}}}` /
 * `{"Err": {"Unsupported": {"version": n}}}` on failure.
 * @param {string} raw
 * @returns {string}
 */
function backup_parse(raw) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.backup_parse(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.backup_parse = backup_parse;

/**
 * Build the prism-api `/api/chat` POST body.
 * Input: JSON `ApiChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 * @param {string} req_json
 * @returns {string}
 */
function build_api_chat_body(req_json) {
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
exports.build_api_chat_body = build_api_chat_body;

/**
 * Build the Ollama native `/api/chat` POST body.
 * Input: JSON `OllamaChatRequest`. Returns `{"Ok": body}` / `{"Err": ...}`.
 * @param {string} req_json
 * @returns {string}
 */
function build_ollama_body(req_json) {
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
exports.build_ollama_body = build_ollama_body;

/**
 * Assemble the SillyTavern-style prompt.
 * Input: JSON `[CharacterCard, Persona, history: ChatMessage[],
 *              LoreScan|null, user_input, system_override|null]`.
 * Returns JSON `Vec<ChatMessage>`.
 * @param {string} request_json
 * @returns {string}
 */
function build_prompt(request_json) {
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
exports.build_prompt = build_prompt;

/**
 * Build the provider POST body for a direct stream request.
 * Input: JSON `StreamRequest` (base_url, api_key, model, temperature,
 * messages, max_tokens?, top_p?, frequency_penalty?, presence_penalty?).
 * Returns `{"Ok": body}` / `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
function build_stream_body(req_json) {
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
exports.build_stream_body = build_stream_body;

/**
 * Trim context items to fit a token budget.
 *
 * Input: JSON `{"items": [<ContextItem>...], "max_tokens": n}`.
 * Returns JSON `{"Ok": [<ContextItem>...]}` / `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
function context_apply_budget(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.context_apply_budget(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.context_apply_budget = context_apply_budget;

/**
 * Default settings as JSON.
 * @returns {string}
 */
function default_settings_json() {
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
exports.default_settings_json = default_settings_json;

/**
 * Auto-title from the first user message (JSON array of messages in).
 * @param {string} messages_json
 * @returns {string}
 */
function derive_title(messages_json) {
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
exports.derive_title = derive_title;

/**
 * Serialize an empty LoreScan (for callers that have no book yet).
 * @returns {string}
 */
function empty_lore_scan() {
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
exports.empty_lore_scan = empty_lore_scan;

/**
 * Estimate the token cost of a string.
 * @param {string} text
 * @returns {number}
 */
function estimate_tokens(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.estimate_tokens(ptr0, len0);
    return ret >>> 0;
}
exports.estimate_tokens = estimate_tokens;

/**
 * Expand SillyTavern macros in a template.
 * Input: JSON `[template, MacroContext]`. Returns the expanded string.
 * @param {string} template
 * @param {string} context_json
 * @returns {string}
 */
function expand_macros(template, context_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(context_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.expand_macros(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.expand_macros = expand_macros;

/**
 * Merge a document that arrived over the API into the local one.
 * @param {string} local_json
 * @param {string} incoming_json
 * @returns {string}
 */
function graph_merge(local_json, incoming_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(local_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(incoming_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.graph_merge(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.graph_merge = graph_merge;

/**
 * The node graph's palette: kinds, ports and knobs, straight from the
 * core so a browser renders the same definitions the desktop does.
 * @returns {string}
 */
function graph_node_defs() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.graph_node_defs();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.graph_node_defs = graph_node_defs;

/**
 * Whether a document is renderable, and why not when it is not.
 * @param {string} doc_json
 * @returns {string}
 */
function graph_problems(doc_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(doc_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graph_problems(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.graph_problems = graph_problems;

/**
 * A starting drawing, for a host with nothing stored yet.
 * @returns {string}
 */
function graph_starter() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.graph_starter();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.graph_starter = graph_starter;

/**
 * Flatten a graph document into the request a host would send. Returns
 * the `{"Ok":...}` / `{"Err":...}` envelope the JS bridge unwraps, so a
 * host fails as a value rather than an exception.
 * @param {string} doc_json
 * @returns {string}
 */
function graph_to_request(doc_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(doc_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.graph_to_request(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.graph_to_request = graph_to_request;

/**
 * Position labels for UI dropdowns: JSON array of
 * `[{"position":"before_char","label":"Before character"}, …]`.
 * @returns {string}
 */
function lore_position_labels() {
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
exports.lore_position_labels = lore_position_labels;

/**
 * Build the A1111 `/sdapi/v1/txt2img` body from a JSON `MediaRequest`.
 * @param {string} req_json
 * @returns {string}
 */
function media_a1111_body(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_a1111_body(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_a1111_body = media_a1111_body;

/**
 * Build the A1111 `/sdapi/v1/img2img` body from a JSON `MediaRequest`.
 * @param {string} req_json
 * @returns {string}
 */
function media_a1111_img2img_body(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_a1111_img2img_body(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_a1111_img2img_body = media_a1111_img2img_body;

/**
 * @param {string} body
 * @returns {string}
 */
function media_comfyui_image_from_history(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_comfyui_image_from_history(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_comfyui_image_from_history = media_comfyui_image_from_history;

/**
 * ComfyUI history entry: `[filename, subfolder, type]`.
 * @param {string} body
 * @returns {string}
 */
function media_comfyui_output_from_history(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_comfyui_output_from_history(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_comfyui_output_from_history = media_comfyui_output_from_history;

/**
 * Build a ComfyUI API-format workflow graph. `checkpoint` is the filename
 * discovered from `/object_info`; the core fills in every other node.
 * @param {string} req_json
 * @param {string} checkpoint
 * @returns {string}
 */
function media_comfyui_workflow(req_json, checkpoint) {
    let deferred3_0;
    let deferred3_1;
    try {
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(checkpoint, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.media_comfyui_workflow(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.media_comfyui_workflow = media_comfyui_workflow;

/**
 * @param {string} provider
 * @returns {string}
 */
function media_default_base_url(provider) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(provider, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_default_base_url(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_default_base_url = media_default_base_url;

/**
 * Default local-SD knobs, so hosts do not duplicate core constants.
 * @returns {string}
 */
function media_defaults() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.media_defaults();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.media_defaults = media_defaults;

/**
 * @param {string} provider
 * @returns {boolean}
 */
function media_is_async_provider(provider) {
    const ptr0 = passStringToWasm0(provider, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.media_is_async_provider(ptr0, len0);
    return ret !== 0;
}
exports.media_is_async_provider = media_is_async_provider;

/**
 * Render an image through the deterministic in-process preview engine.
 * Returns a PNG `data:` URL so no host-side image encoding is needed.
 * @param {string} req_json
 * @returns {string}
 */
function media_native_png_data_url(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_native_png_data_url(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_native_png_data_url = media_native_png_data_url;

/**
 * Extract the first generated image from an A1111 JSON response.
 * @param {string} body
 * @returns {string}
 */
function media_parse_a1111_image(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_parse_a1111_image(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_parse_a1111_image = media_parse_a1111_image;

/**
 * Every image in an A1111 response, in batch order.
 * @param {string} body
 * @returns {string}
 */
function media_parse_a1111_images(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_parse_a1111_images(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_parse_a1111_images = media_parse_a1111_images;

/**
 * Extract a ready URL from a provider's JSON response.
 * @param {string} body
 * @returns {string}
 */
function media_parse_media_url(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_parse_media_url(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_parse_media_url = media_parse_media_url;

/**
 * Extract a polling task id from a provider's JSON response.
 * @param {string} body
 * @returns {string}
 */
function media_parse_task_id(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.media_parse_task_id(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.media_parse_task_id = media_parse_task_id;

/**
 * Fresh conversation id (nanosecond hex).
 * @returns {string}
 */
function new_conversation_id() {
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
exports.new_conversation_id = new_conversation_id;

/**
 * Normalize (parse + migrate) settings JSON. Absent fields fill from
 * defaults; the legacy single `api_key` moves into `provider_keys`.
 * Returns `{"Ok": settings}` or `{"Err": message}`.
 * @param {string} input
 * @returns {string}
 */
function normalize_settings_json(input) {
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
exports.normalize_settings_json = normalize_settings_json;

/**
 * Current unix epoch milliseconds (JS BigInt).
 * @returns {bigint}
 */
function now_ms() {
    const ret = wasm.now_ms();
    return BigInt.asUintN(64, ret);
}
exports.now_ms = now_ms;

/**
 * Ollama native API root from a possibly `/v1`-suffixed base URL.
 * @param {string} base_url
 * @returns {string}
 */
function ollama_root_url(base_url) {
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
exports.ollama_root_url = ollama_root_url;

/**
 * Parse a prism-api `POST /api/chat` response body.
 * Returns `{"Ok": "..."}` or `{"Err": "..."}`.
 * @param {string} body
 * @returns {string}
 */
function parse_api_response(body) {
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
exports.parse_api_response = parse_api_response;

/**
 * Parse a character card (V2 file, direct V2, or V1). Returns
 * `{"Ok": card}` / `{"Err": msg}`.
 * @param {string} json
 * @returns {string}
 */
function parse_character_card(json) {
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
exports.parse_character_card = parse_character_card;

/**
 * Parse an OpenAI-compatible `GET /models` body.
 * Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
 * @param {string} body
 * @returns {string}
 */
function parse_models_response(body) {
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
exports.parse_models_response = parse_models_response;

/**
 * The provider table: id, label, base_url, default_model, needs_key,
 * env (env-var names that may carry the key).
 * @returns {string}
 */
function providers_json() {
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
exports.providers_json = providers_json;

/**
 * Scan a lore book against chat text.
 * Input: JSON `[chat_text, history: string[], CharacterBook]`.
 * Returns JSON `LoreScan`.
 * @param {string} chat_text
 * @param {string} history_json
 * @param {string} book_json
 * @returns {string}
 */
function scan_lore(chat_text, history_json, book_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        let ptr0, len0, ptr1, len1, ptr2, len2;
        try {
            ptr0 = passStringToWasm0(chat_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(history_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(book_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len2 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.scan_lore(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.scan_lore = scan_lore;

/**
 * Search messages across conversations.
 *
 * Input: JSON `{"conversations": [<Conversation>...], "query": <SearchQuery>}`.
 * Returns JSON `{"Ok": [<SearchHit>...]}` / `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
function search_messages(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.search_messages(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.search_messages = search_messages;

/**
 * Replace one message's content, keeping the rest of the transcript.
 * @param {string} req_json
 * @returns {string}
 */
function session_edit_message(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_edit_message(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.session_edit_message = session_edit_message;

/**
 * Fork a conversation at `at_index` into a new branch.
 *
 * Input: JSON `{"conversation": <Conversation>, "at_index": n,
 * "new_id": "..."}`. The new id and the timestamp are supplied by the
 * host so the result is deterministic and testable.
 *
 * Returns JSON `{"Ok": <forked Conversation>}` /
 * `{"Err": message}`.
 * @param {string} req_json
 * @returns {string}
 */
function session_fork_branch(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_fork_branch(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.session_fork_branch = session_fork_branch;

/**
 * Overwrite one message and drop the stale tail after it.
 *
 * Input: JSON `{"conversation": <Conversation>, "at_index": n,
 * "content": "...", "now_ms": n?}`. The conversation is mutated and
 * returned in full.
 * @param {string} req_json
 * @returns {string}
 */
function session_overwrite_at(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_overwrite_at(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.session_overwrite_at = session_overwrite_at;

/**
 * Set a message's read flag. Returns the conversation.
 * @param {string} req_json
 * @returns {string}
 */
function session_set_message_read(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_set_message_read(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.session_set_message_read = session_set_message_read;

/**
 * Add or remove a tag on one message. Returns the conversation.
 *
 * `remove: true` removes the tag instead of adding it.
 * @param {string} req_json
 * @returns {string}
 */
function session_set_message_tag(req_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(req_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_set_message_tag(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.session_set_message_tag = session_set_message_tag;

/**
 * Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
 * @param {string} content
 * @returns {string}
 */
function strip_thinking(content) {
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
exports.strip_thinking = strip_thinking;

/**
 * Validate a lore entry's shapes (keys arrays, position string).
 * Returns `{"Ok": true}` / `{"Err": msg}`.
 * @param {string} entry_json
 * @returns {string}
 */
function validate_lore_entry(entry_json) {
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
exports.validate_lore_entry = validate_lore_entry;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_falsy_d864b623500ae65d: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
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
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
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

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
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

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
function decodeText(bytes) {
    return cachedTextDecoder.decode(bytes);
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

const wasmPath = `${__dirname}/prism_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
