/* tslint:disable */
/* eslint-disable */

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
 * Parse an OpenAI-compatible `GET /models` body.
 * Returns `{"Ok": ["id", ...]}` or `{"Err": "..."}`.
 */
export function parse_models_response(body: string): string;

/**
 * The provider table: id, label, base_url, default_model, needs_key.
 */
export function providers_json(): string;

/**
 * Strip `<thinking>` blocks. Returns `[cleaned_content, reasoning_or_null]`.
 */
export function strip_thinking(content: string): string;
