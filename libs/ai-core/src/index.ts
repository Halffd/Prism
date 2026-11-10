// TS binding over prism-core wasm: body construction, decoders, provider
// table. This is the ONLY TS package that talks to the core — hosts drive
// their own HTTP and feed bytes to the decoders (decoder-first contract).
//
// This replaces the old libs/llm-service + libs/ai-adapters pair: their
// per-provider TS switch is gone because the core owns body construction
// for every OpenAI-compatible provider. Non-compat providers (claude,
// transformers, poe, cloudflare-workers, zai) were dropped with them —
// the plan's rule is that anything the core cannot compile for BOTH
// targets does not ship in the core, and those adapters were the
// divergence being killed.

/* eslint-disable @typescript-eslint/no-var-requires */

export interface CoreDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

export interface WasmCoreModule {
  SseDecoder: new () => CoreDecoder;
  NdjsonDecoder: new () => CoreDecoder;
  build_stream_body(reqJson: string): string;
  build_ollama_body(reqJson: string): string;
  build_api_chat_body(reqJson: string): string;
  parse_api_response(body: string): string;
  parse_models_response(body: string): string;
  strip_thinking(content: string): string;
  apply_thinking(messagesJson: string): string;
  providers_json(): string;
  ollama_root_url(baseUrl: string): string;
  // Character cards / personas / lore / prompt assembly
  parse_character_card(json: string): string;
  expand_macros(template: string, contextJson: string): string;
  scan_lore(chatText: string, historyJson: string, bookJson: string): string;
  empty_lore_scan(): string;
  lore_position_labels(): string;
  validate_lore_entry(entryJson: string): string;
  build_prompt(requestJson: string): string;
  agent_sandbox_policy_check(policyJson: string): string;
  agent_tool_repair(rawInput: string): string;
  agent_tool_classify(observation: string): string;
  agent_tool_clamp(reqJson: string): string;
  agent_subagents_list(): string;
  agent_subagent_resolve_model(
    name: string,
    sessionModel: string,
    providerDefault?: string | null,
  ): string;
  agent_subagent_clamp_tools(name: string, advertised: string[]): string;
}

export type WasmCore = WasmCoreModule & Record<string, unknown>;

let corePromise: Promise<WasmCore> | null = null;

/** Node hosts get the nodejs pkg (sync require); browsers get the web
 *  pkg, whose wasm is instantiated on first use. */
function isNodeHost(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!(process as { versions?: { node?: string } }).versions?.node
  );
}

/** Load the core wasm once per host. Node hosts resolve immediately;
 *  browser hosts await the web pkg's wasm instantiation. */
export function loadCore(): Promise<WasmCore> {
  if (!corePromise) {
    corePromise = isNodeHost()
      ? Promise.resolve().then(loadCoreNode)
      : loadCoreWeb();
  }
  return corePromise;
}

/** The nodejs pkg for node hosts / tests. */
export function loadCoreNode(): WasmCore {
  // process.getBuiltinModule bypasses jest's module interception
  // (Node 22.3+); createRequire then loads the nodejs pkg from real
  // disk, outside jest's moduleNameMapper.
  const proc = process as unknown as {
    getBuiltinModule?: (id: string) => {
      createRequire: (
        filename: string,
      ) => ((id: string) => unknown) & { resolve: (id: string) => string };
    };
  };
  const nodeModule = proc.getBuiltinModule?.('module');
  if (!nodeModule) {
    throw new Error('wasm loader: node builtin module unavailable');
  }
  // Node branch only: __filename exists under CJS (jest, tsc builds).
  // No import.meta token here — it would force the jest transform to
  // emit ESM and break the require chain. Browser builds take the
  // dynamic-import branch and never need an anchor.
  const anchor =
    typeof __filename !== 'undefined'
      ? __filename
      : process.cwd() + '/index.js';
  const req = nodeModule.createRequire(anchor);
  // Resolve from candidate locations: this module's directory (src
  // layout, jest), a copied pkg beside the build output, or the
  // monorepo working directory.
  const candidates = [
    './wasm-pkg-node/prism_wasm.js',
    '../../src/wasm-pkg-node/prism_wasm.js',
    'libs/ai-core/src/wasm-pkg-node/prism_wasm.js',
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return req(candidate) as WasmCore;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `wasm loader: prism_wasm pkg not found (tried ${candidates.length} locations): ${String(lastError)}`,
  );
}

/** The web pkg for browser hosts. The wasm is fetched relative to the
 *  pkg's own URL, so the pkg directory must sit next to the chunk that
 *  imports it (the extension build copies it into the bundle). */
async function loadCoreWeb(): Promise<WasmCore> {
  // @ts-ignore — wasm-pack web glue (node16 resolution limitation)
  // Variable path: bundlers (esbuild/vite) must not try to resolve the
  // browser pkg inside node builds.
  const webPkg = './wasm-pkg-web/prism_wasm.js';
  const web = (await import(
    /* webpackIgnore: true */ /* @vite-ignore */ webPkg
  )) as unknown as { default: () => Promise<unknown> };
  await web.default();
  return web as unknown as WasmCore;
}

// ---- provider table ------------------------------------------------------

export interface CoreProvider {
  id: string;
  label: string;
  base_url: string;
  default_model: string;
  needs_key: boolean;
  env: string[];
}

export function providerTable(core: WasmCore): CoreProvider[] {
  return JSON.parse(core.providers_json()) as CoreProvider[];
}

export function findProvider(core: WasmCore, id: string): CoreProvider | undefined {
  return providerTable(core).find((p) => p.id === id);
}

// ---- request body builders ------------------------------------------------

/** A JSON request body produced by the core (validated shape at the
 *  HTTP boundary; opaque here because it is provider-specific). */
export type JsonBody = Record<string, unknown>;

export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface StreamRequestInput {
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  messages: WireMessage[];
  max_tokens?: number | null;
  top_p?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
}

export interface OllamaRequestInput {
  base_url: string;
  model: string;
  temperature?: number;
  messages: WireMessage[];
  num_ctx?: number | null;
  num_gpu?: number | null;
  max_tokens?: number | null;
}

export interface ApiRequestInput {
  server_url: string;
  token: string;
  content: string;
}

/** The core reports its result as `{"Ok": value}` / `{"Err": message}`.
 *  Unwrap it; a rejected request throws with the core's message. */
function unwrapCoreResult<T>(raw: string): T {
  const parsed = JSON.parse(raw) as { Ok?: T; Err?: string };
  if (parsed.Err !== undefined || parsed.Ok === undefined) {
    throw new Error(`core rejected request: ${parsed.Err ?? 'unknown'}`);
  }
  return parsed.Ok;
}

/** Core-owned OpenAI-compatible body. Returns the parsed JSON body. */
export function buildStreamBody(core: WasmCore, req: StreamRequestInput): JsonBody {
  return unwrapCoreResult<JsonBody>(
    core.build_stream_body(JSON.stringify(req)),
  );
}

export function buildOllamaBody(core: WasmCore, req: OllamaRequestInput): JsonBody {
  return unwrapCoreResult<JsonBody>(
    core.build_ollama_body(JSON.stringify(req)),
  );
}

export function buildApiChatBody(core: WasmCore, req: ApiRequestInput): JsonBody {
  return unwrapCoreResult<JsonBody>(
    core.build_api_chat_body(JSON.stringify(req)),
  );
}

// ---- decoders -------------------------------------------------------------

/** Decoded stream event, externally tagged like the fixture format. */
export type CoreStreamEvent =
  | { Chunk: string }
  | 'Done'
  | { Error: string };

/** Feed a response body stream through the core SSE decoder and yield
 *  text deltas. The host owns fetch; the core owns parsing. */
export async function* streamSseText(
  core: WasmCore,
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<{ delta: string; done: boolean }> {
  const decoder = new core.SseDecoder();
  for await (const chunk of bodyChunks(body)) {
    const events = JSON.parse(decoder.feed(chunk)) as CoreStreamEvent[];
    for (const ev of events) {
      if (ev === 'Done') {
        yield { delta: '', done: true };
        return;
      }
      if (typeof ev === 'object' && ev !== null && 'Error' in ev) {
        throw new Error((ev as { Error: string }).Error);
      }
      if (typeof ev === 'object' && ev !== null && 'Chunk' in ev) {
        yield { delta: (ev as { Chunk: string }).Chunk, done: false };
      }
    }
  }
  for (const ev of JSON.parse(decoder.finish()) as CoreStreamEvent[]) {
    if (typeof ev === 'object' && ev !== null && 'Chunk' in ev) {
      yield { delta: (ev as { Chunk: string }).Chunk, done: false };
    }
  }
  yield { delta: '', done: true };
}

/** Byte chunks of a fetch body. A ReadableStream is drained through its
 *  reader; a plain async iterable (node adapters, test doubles) is
 *  iterated as-is. */
async function* bodyChunks(
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const stream = body as ReadableStream<Uint8Array>;
  if (typeof stream.getReader !== 'function') {
    yield* body as AsyncIterable<Uint8Array>;
    return;
  }
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}

// ---- thinking -------------------------------------------------------------

/** Wrap messages with the core's scratchpad instruction (FIRST user
 *  message — core semantics). */
export function applyThinking(core: WasmCore, messages: WireMessage[]): WireMessage[] {
  return JSON.parse(core.apply_thinking(JSON.stringify(messages)));
}

/** Split <thinking> out of assistant content. Returns [clean, reasoning|null]. */
export function stripThinking(core: WasmCore, content: string): [string, string | null] {
  return JSON.parse(core.strip_thinking(content));
}

// ---- model listing --------------------------------------------------------

/** Parse a /models response into model ids (OpenAI-shape getters). */
export function parseModels(core: WasmCore, body: string): string[] {
  return unwrapCoreResult<string[]>(core.parse_models_response(body));
}

// ---- custom providers -----------------------------------------------------

// A custom provider is a base URL that
// aliases a built-in: same body shape, different endpoint + key. The
// core already builds the body; the host only needs the resolution:
export const CORE_PROVIDER_IDS: string[] = [
  'openai',
  'gemini',
  'qwen',
  'deepseek',
  'groq',
  'openrouter',
  'mistral',
  'grok',
  'nvidia-nim',
  'cerebras',
  'together',
  'fireworks',
  'perplexity',
  'ollama',
  'llamacpp',
  'koboldcpp',
  'sglang',
];

/** Stable id for a custom endpoint (aliasing a canonical provider). */
export function customProviderId(canonical: string, baseUrl: string): string {
  return `custom:${canonical}:${baseUrl}`;
}

/** Build the request input for a provider id, applying a custom
 *  provider's base URL / key when the id is a custom alias. */
export function resolveRequestTarget(
  core: WasmCore,
  providerId: string,
  settings: {
    customProviders?: Record<
      string,
      { canonical: string; base_url: string }
    >;
    providerKeys?: Record<string, string>;
    envKey?: (provider: string) => string | undefined;
  },
): { base_url: string; api_key: string; needs_key: boolean } {
  const custom = settings.customProviders?.[providerId];
  if (custom) {
    const def = findProvider(core, custom.canonical);
    const stored = settings.providerKeys?.[providerId]?.trim() ?? '';
    const env = settings.envKey?.(providerId);
    return {
      base_url: custom.base_url,
      api_key: stored || env || '',
      needs_key: def?.needs_key ?? true,
    };
  }
  const def = findProvider(core, providerId);
  const stored = settings.providerKeys?.[providerId]?.trim() ?? '';
  const env = settings.envKey?.(providerId);
  return {
    base_url: def?.base_url ?? '',
    api_key: stored || env || '',
    needs_key: def?.needs_key ?? false,
  };
}

export * from './auto-model';

// ---- agent surface --------------------------------------------------------

/** The sandbox policy shape the core accepts (the helper's `--policy`
 *  file contents). */
export interface SandboxPolicy {
  mode?: 'off' | 'auto' | 'strict';
  network?: { mode?: 'allow_all' | 'blocked'; allowlist?: string[] };
  admin_command_denylist?: string[];
  admin_denylist_replaces?: boolean;
  workspace_roots?: string[];
  read_allowlist_paths?: string[];
}

/** How a spawn would be sandboxed on this host. */
export type SandboxPlan =
  | { ok: true; sandbox_used: string }
  | { ok: false; error: string; detail?: string };

/** Plan a sandbox policy without spawning anything. On a browser host
 *  the core reports `sandbox_unsupported` — the plan IS the answer, the
 *  caller decides what to do with it. */
export function sandboxPlan(
  core: WasmCore,
  policy: SandboxPolicy,
): SandboxPlan {
  const raw = JSON.parse(
    core.agent_sandbox_policy_check(JSON.stringify(policy)),
  ) as {
    ok: boolean;
    sandbox_used?: string;
    error?: string | Record<string, unknown>;
  };
  if (raw.ok) {
    return { ok: true, sandbox_used: raw.sandbox_used ?? 'off' };
  }
  const error = raw.error;
  if (typeof error === 'string') {
    return { ok: false, error };
  }
  const variant = Object.keys(error ?? {})[0] ?? 'sandbox_unsupported';
  return { ok: false, error: variant, detail: JSON.stringify(error) };
}

/** Normalise a model-produced tool argument into the plain string the
 *  core tools take; `notes` names every change applied. */
export function repairToolInput(
  core: WasmCore,
  rawInput: string,
): { input: string; notes: string[] } {
  return JSON.parse(core.agent_tool_repair(rawInput)) as {
    input: string;
    notes: string[];
  };
}

/** The closed tool-error taxonomy the core classifies observations into. */
export type ToolErrorKindName =
  | 'not_recognized'
  | 'permission_denied'
  | 'invalid_input'
  | 'not_found'
  | 'environment'
  | 'none';

/** Clamp a tool call to the advertised surface. A tool that is not
 *  advertised fails closed with the list of advertised tools, so the
 *  model can re-aim instead of hallucinating one. */
export function clampToolCall(
  core: WasmCore,
  advertised: string[],
  tool: string,
): { ok: boolean; error?: string } {
  return JSON.parse(
    core.agent_tool_clamp(JSON.stringify({ advertised, tool })),
  ) as { ok: boolean; error?: string };
}

/** Classify a tool observation; `detail` is the actionable advice the
 *  core appends to the observation text. */
export function classifyToolObservation(
  core: WasmCore,
  observation: string,
): { kind: ToolErrorKindName; detail: string | null } {
  return JSON.parse(core.agent_tool_classify(observation)) as {
    kind: ToolErrorKindName;
    detail: string | null;
  };
}

/** One shipped subagent profile. */
export interface SubagentSpec {
  name: string;
  description: string;
  forced_model?: string | null;
  tool_allowlist: string[];
}

/** The shipped subagent registry. */
export function subagents(core: WasmCore): SubagentSpec[] {
  return JSON.parse(core.agent_subagents_list()) as SubagentSpec[];
}

/** Effective tool surface for one subagent — the core's clamp: the
 *  allowlist intersected with the advertised surface. An empty
 *  allowlist yields the full surface; a total miss throws. */
export function clampSubagentTools(
  core: WasmCore,
  name: string,
  advertised: string[],
): string[] {
  const raw = JSON.parse(
    core.agent_subagent_clamp_tools(name, advertised),
  ) as string[] | { error?: string };
  if (Array.isArray(raw)) {
    return raw;
  }
  throw new Error(raw.error ?? 'subagent tool clamp failed');
}

/** Which model a subagent run must use, and which tier decided it. */
export interface SubagentModelResolution {
  model: string;
  tier: 'subagent_forced' | 'session' | 'provider_default';
}

/** Resolve a subagent's model in the core's forced order. Throws when
 *  nothing resolves (no forced model, no session model, no default). */
export function resolveSubagentModel(
  core: WasmCore,
  name: string,
  sessionModel: string,
  providerDefault?: string | null,
): SubagentModelResolution {
  const raw = JSON.parse(
    core.agent_subagent_resolve_model(name, sessionModel, providerDefault ?? null),
  ) as SubagentModelResolution & { error?: string };
  if (raw.error) {
    throw new Error(raw.error);
  }
  return raw;
}

// ---- chat completion contract -------------------------------------------

/** The request shape hosts build; same fields the core's StreamRequest
 *  consumes (messages, config). */
export interface ChatCompletionRequest {
  messages: WireMessage[];
  config: ChatConfig;
  /** Host-side context (page/selection/screen); not part of the wire body. */
  context?: unknown;
}

export interface ChatConfig {
  provider: string;
  /** Empty = provider default (resolved by the host before calling). */
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  thinkingMode?: { enabled: boolean } | null;
  /** Local (Ollama) base URL override. */
  localBaseUrl?: string;
}

export interface ChatCompletionResponse {
  content: string;
  thinking?: string;
  tokensUsed?: number;
}

// ---- character cards / personas / lore / prompt assembly ------------------

/** SillyTavern-style character card. Field names mirror
 *  crates/prism-core/src/cards.rs (snake_case on the wire). */
export interface CoreCharacterCard {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  tags?: string[];
  creator?: string;
  character_version?: string;
  character_book?: CoreCharacterBook | null;
}

export interface CoreCharacterBook {
  name?: string;
  description?: string;
  entries?: CoreLoreEntry[];
  scan_depth?: number;
  token_budget?: number;
}

export interface CoreLoreEntry {
  keys?: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  enabled?: boolean;
  constant?: boolean;
  /** 'before_char' | 'after_char' */
  position?: string;
  insertion_order?: number;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  use_group_scoring?: boolean;
}

export interface CoreLoreScan {
  before_char: CoreLoreEntry[];
  after_char: CoreLoreEntry[];
  dropped_for_budget: number;
}

export interface CorePersona {
  name: string;
  description?: string;
}

/** Macro values for expansion. */
export interface CoreMacroContext {
  char: string;
  user: string;
  description: string;
  personality: string;
  scenario: string;
  persona: string;
  first_mes: string;
  mes_example: string;
}

/** Parse a card: V2 file (`{spec,data}`), direct V2, or V1. Throws on
 *  non-Prism documents. */
export function parseCharacterCard(core: WasmCore, json: string): CoreCharacterCard {
  const raw = core.parse_character_card(json);
  const parsed = JSON.parse(raw) as { Ok?: CoreCharacterCard; Err?: string };
  if (parsed.Err) throw new Error(parsed.Err);
  if (!parsed.Ok) throw new Error('card parse failed');
  return parsed.Ok;
}

/** Expand {{char}} {{user}} {{description}} {{personality}} {{scenario}}
 *  {{persona}} {{first_mes}} {{mes_example}}. Unknown macros stay. */
export function expandMacros(
  core: WasmCore,
  template: string,
  ctx: CoreMacroContext,
): string {
  return core.expand_macros(template, JSON.stringify(ctx));
}

/** Scan a lore book against the newest turns. */
export function scanLore(
  core: WasmCore,
  chatText: string,
  history: string[],
  book: CoreCharacterBook,
): CoreLoreScan {
  return JSON.parse(core.scan_lore(chatText, JSON.stringify(history), JSON.stringify(book)));
}

export function emptyLoreScan(core: WasmCore): CoreLoreScan {
  return JSON.parse(core.empty_lore_scan());
}

/** Lore position labels for UI dropdowns. */
export function lorePositionLabels(
  core: WasmCore,
): Array<{ position: string; label: string }> {
  return JSON.parse(core.lore_position_labels());
}

/** Validate a lore entry; returns null when valid, else the reason. */
export function validateLoreEntry(core: WasmCore, entry: CoreLoreEntry): string | null {
  const raw = JSON.parse(core.validate_lore_entry(JSON.stringify(entry))) as {
    Ok?: boolean;
    Err?: string;
  };
  return raw.Err ?? null;
}

export interface BuildPromptRequest {
  card: CoreCharacterCard;
  persona: CorePersona;
  history: WireMessage[];
  lore: CoreLoreScan | null;
  user_input: string;
  system_override?: string | null;
}

/** Assemble the SillyTavern-style prompt into chat messages. */
export function buildPrompt(core: WasmCore, req: BuildPromptRequest): WireMessage[] {
  const raw = core.build_prompt(JSON.stringify(req));
  // Errors come back as {"Err": "..."}
  const probe = (() => {
    try {
      return JSON.parse(raw) as { Err?: string };
    } catch {
      return null;
    }
  })();
  if (probe && probe.Err) throw new Error(probe.Err);
  const msgs = JSON.parse(raw) as WireMessage[];
  if (!Array.isArray(msgs)) throw new Error('build_prompt did not return messages');
  return msgs;
}

/** Macro context for a card + persona (the usual assembly). */
export function macroContext(
  card: CoreCharacterCard,
  persona: CorePersona,
): CoreMacroContext {
  const personaExpanded =
    persona.description && persona.description.trim()
      ? `${persona.name}: ${persona.description.trim()}`
      : persona.name;
  return {
    char: card.name,
    user: persona.name,
    description: card.description ?? '',
    personality: card.personality ?? '',
    scenario: card.scenario ?? '',
    persona: personaExpanded,
    first_mes: card.first_mes ?? '',
    mes_example: card.mes_example ?? '',
  };
}
