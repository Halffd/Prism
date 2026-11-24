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
  // Media / Image Studio: same JSON-string contract as chat.
  media_defaults(): string;
  media_a1111_body(reqJson: string): string;
  media_a1111_img2img_body(reqJson: string): string;
  media_comfyui_workflow(reqJson: string, checkpoint: string): string;
  media_native_png_data_url(reqJson: string): string;
  media_parse_a1111_image(body: string): string;
  media_parse_a1111_images(body: string): string;
  media_parse_media_url(body: string): string;
  media_parse_task_id(body: string): string;
  media_comfyui_output_from_history(body: string): string;
  media_comfyui_image_from_history(body: string): string;
  media_default_base_url(provider: string): string;
  media_is_async_provider(provider: string): boolean;
  // The shared canvas graph: the same document every Prism surface edits.
  graph_node_defs(): string;
  graph_starter(): string;
  graph_to_request(docJson: string): string;
  graph_problems(docJson: string): string;
  graph_merge(localJson: string, incomingJson: string): string;
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
  // Session ops: fork, overwrite, edit
  session_fork_branch(reqJson: string): string;
  session_overwrite_at(reqJson: string): string;
  session_edit_message(reqJson: string): string;
  session_set_message_read(reqJson: string): string;
  session_set_message_tag(reqJson: string): string;
  // Search
  search_messages(reqJson: string): string;
  // Context budget
  context_apply_budget(reqJson: string): string;
  estimate_tokens(text: string): number;
  // Backup
  backup_export(reqJson: string): string;
  backup_parse(raw: string): string;
  backup_import(reqJson: string): string;
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
  //
  // The specifier is assembled at runtime on purpose. A literal
  // `require('./wasm-pkg-node/prism_wasm.js')` is statically resolvable,
  // so a browser bundler pulls the Node wasm build (megabytes of
  // generated glue) into the bundle even though the Node branch never
  // runs there. The `/* @vite-ignore */` comment stops Vite from
  // resolving the dynamic import, mirroring `loadCoreWeb` below.
  const pkgPath = 'wasm-pkg-node/prism_wasm.js';
  const candidates = [
    './' + pkgPath,
    '../../src/' + pkgPath,
    'libs/ai-core/src/' + pkgPath,
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return req(/* @vite-ignore */ candidate) as WasmCore;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `wasm loader: prism_wasm pkg not found (tried ${candidates.length} locations): ${String(lastError)}`,
  );
}

/** Location of the browser wasm glue. Hosts that serve the pkg from a
 *  static-asset path (e.g. Next.js `/wasm-pkg-web/`) call
 *  {@link configureCoreWeb} before the first {@link loadCore}. */
let webPkgUrl = './wasm-pkg-web/prism_wasm.js';

/** Point browser hosts at a different web pkg location and reset the
 *  cached core, so the next {@link loadCore} uses the new URL. */
export function configureCoreWeb(url: string): void {
  webPkgUrl = url;
  corePromise = null;
}

/** The web pkg for browser hosts. The wasm is fetched relative to the
 *  pkg's own URL, so the pkg directory must sit next to the chunk that
 *  imports it (the extension build copies it into the bundle; the web
 *  app serves it from `public/wasm-pkg-web`). */
async function loadCoreWeb(): Promise<WasmCore> {
  // @ts-ignore — wasm-bindgen web glue (node16 resolution limitation)
  // Variable path: bundlers (esbuild/vite) must not try to resolve the
  // browser pkg inside node builds.
  const web = (await import(
    /* webpackIgnore: true */ /* @vite-ignore */ webPkgUrl
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

// ---- media (Image Studio) -------------------------------------------------

export interface LoraSpecInput {
  name: string;
  weight: number;
}

/** Mirrors `prism_core::media::MediaRequest`. Missing fields use the core's
 *  defaults, so hosts never have to duplicate SD constants or wire rules. */
export interface MediaRequestInput {
  provider: string;
  base_url?: string;
  api_key?: string;
  prompt: string;
  negative_prompt?: string | null;
  model?: string | null;
  image?: string | null;
  mask?: string | null;
  aspect_ratio?: string | null;
  duration?: number | null;
  seed?: number | null;
  format?: string | null;
  steps?: number | null;
  cfg?: number | null;
  sampler?: string | null;
  scheduler?: string | null;
  denoise?: number | null;
  batch?: number | null;
  width?: number | null;
  height?: number | null;
  vae?: string | null;
  clip_skip?: number | null;
  loras?: LoraSpecInput[];
}

export interface MediaDefaults {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  maxBatch: number;
  width: number;
  height: number;
  providers: Record<string, string>;
}

// What `graph_to_request` produces: the same field names as the panel
// form (`apps/web/src/studio/media.ts`), with "blank means none".
export interface GraphRequest {
  provider: string;
  checkpoint: string;
  vae: string;
  clip_skip: string;
  loras: { name: string; weight: string }[];
  prompt: string;
  negative_prompt: string;
  sampler: string;
  scheduler: string;
  steps: string;
  cfg: string;
  denoise: string;
  width: string;
  height: string;
  batch: string;
  seed: string;
}

export function mediaDefaults(core: WasmCore): MediaDefaults {
  return JSON.parse(core.media_defaults()) as MediaDefaults;
}

// ---- the shared canvas graph ----------------------------------------------

/** One port on a node: what it carries and which side it sits on. */
export interface GraphPort {
  id: string;
  label: string;
  kind: 'model' | 'conditioning' | 'sampler' | 'latent' | 'seed';
  output: boolean;
}

/** One Knob a node exposes. */
export interface GraphKnob {
  id: string;
  label: string;
  /** "text" | "number" | "enum" | "percent" */
  control: string;
}

/** A node definition: what the palette draws before any state. */
export interface GraphNodeDef {
  kind: string;
  title: string;
  family: 'model' | 'prompt' | 'sampler' | 'latent' | 'seed';
  inputs: GraphPort[];
  outputs: GraphPort[];
  knobs: GraphKnob[];
}

export interface GraphNodeDefs {
  nodes: GraphNodeDef[];
}

/** Nodes, ports and knobs, straight from the core. */
export function graphNodeDefs(core: WasmCore): GraphNodeDefs {
  return JSON.parse(core.graph_node_defs()) as GraphNodeDefs;
}

/** A fresh starting drawing, for a host with nothing stored yet. */
export function graphStarter(core: WasmCore): string {
  return core.graph_starter();
}

/** Flatten a graph document into the request a host would send. A graph
 *  that cannot be generated from fails with the core's reason. */
export function graphToRequest(core: WasmCore, docJson: string): GraphRequest {
  return unwrapCoreResult<GraphRequest>(core.graph_to_request(docJson));
}

/** Every reason a document cannot be rendered. Empty means valid. */
export function graphProblems(core: WasmCore, docJson: string): string[] {
  const parsed = JSON.parse(core.graph_problems(docJson)) as { problems: string[] };
  return parsed.problems;
}

/** Merge a document that arrived over the API into the local one. */
export function graphMerge(
  core: WasmCore,
  localJson: string,
  incomingJson: string,
): string {
  return unwrapCoreResult<string>(core.graph_merge(localJson, incomingJson));
}

export function buildA1111Body(core: WasmCore, req: MediaRequestInput): JsonBody {
  return unwrapCoreResult<JsonBody>(core.media_a1111_body(JSON.stringify(req)));
}

export function buildA1111Img2ImgBody(
  core: WasmCore,
  req: MediaRequestInput,
): JsonBody {
  return unwrapCoreResult<JsonBody>(
    core.media_a1111_img2img_body(JSON.stringify(req)),
  );
}

export function buildComfyUiWorkflow(
  core: WasmCore,
  req: MediaRequestInput,
  checkpoint: string,
): JsonBody {
  return unwrapCoreResult<JsonBody>(
    core.media_comfyui_workflow(JSON.stringify(req), checkpoint),
  );
}

/** Deterministic in-process preview render; returns a PNG data URL. */
export function renderNativeImage(core: WasmCore, req: MediaRequestInput): string {
  return unwrapCoreResult<string>(
    core.media_native_png_data_url(JSON.stringify(req)),
  );
}

export function parseA1111Image(core: WasmCore, body: string): string {
  return unwrapCoreResult<string>(core.media_parse_a1111_image(body));
}

export function parseA1111Images(core: WasmCore, body: string): string[] {
  return unwrapCoreResult<string[]>(core.media_parse_a1111_images(body));
}

export function parseMediaUrl(core: WasmCore, body: string): string {
  return unwrapCoreResult<string>(core.media_parse_media_url(body));
}

export function parseTaskId(core: WasmCore, body: string): string {
  return unwrapCoreResult<string>(core.media_parse_task_id(body));
}

export function comfyUiOutputFromHistory(
  core: WasmCore,
  body: string,
): [string, string, string] {
  return unwrapCoreResult<[string, string, string]>(
    core.media_comfyui_output_from_history(body),
  );
}

export function comfyUiImageFromHistory(
  core: WasmCore,
  body: string,
): [string, string, string] {
  return unwrapCoreResult<[string, string, string]>(
    core.media_comfyui_image_from_history(body),
  );
}

export function mediaDefaultBaseUrl(core: WasmCore, provider: string): string {
  return core.media_default_base_url(provider);
}

export function isAsyncProvider(core: WasmCore, provider: string): boolean {
  return core.media_is_async_provider(provider);
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
// core already builds the body; the host only needs the resolution.
//
// There is deliberately no copy of the provider-id list in this file.
// The table lives once, in Rust (`providers.rs` -> `PROVIDERS`), and
// every reader below goes through `providerTable()` -> `providers_json()`.
// A hand-maintained TypeScript copy drifts whenever the core gains a
// provider, and nothing catches it.
//
// Hosts that need the ids before the wasm loads (the extension's first
// paint) read the generated snapshot at
// `apps/extension/src/generated/core-providers.ts`, produced by
// `scripts/generate-core-providers.mjs` from this same export.

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
    description: persona.description ?? '',
    personality: persona.personality ?? '',
    scenario: persona.scenario ?? '',
    persona: personaExpanded,
    first_mes: card.first_mes ?? '',
    mes_example: card.mes_example ?? '',
  };
}

// ---- session ops ----------------------------------------------------------

/** A stored message, as the core shapes it. */
export interface CoreStoredMessage {
  role: string;
  content: string;
  thinking?: string | null;
  id?: string | null;
  tags?: string[];
  read?: boolean;
  edited_at?: number | null;
}

/** A conversation, as the core shapes it. */
export interface CoreConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: CoreStoredMessage[];
  tags?: string[];
  archived?: boolean;
  read?: boolean;
  forked_from?: string | null;
  forked_at_message?: number | null;
}

/** Unwrap a `{"Ok": ...}` / `{"Err": ...}` envelope. */
function unwrap<T>(raw: string, what: string): T {
  const parsed = JSON.parse(raw) as { Ok?: T; Err?: unknown };
  if (parsed.Err !== undefined) {
    const reason =
      typeof parsed.Err === 'string'
        ? parsed.Err
        : JSON.stringify(parsed.Err);
    throw new Error(`${what}: ${reason}`);
  }
  return parsed.Ok as T;
}

/**
 * Branch a copy of a conversation at `atIndex` into a new one.
 *
 * The source conversation is left untouched. The returned conversation
 * records where it came from (`forked_from` / `forked_at_message`).
 */
export function forkBranch(
  core: WasmCore,
  conversation: CoreConversation,
  atIndex: number,
  newId: string,
  nowMs?: number,
): CoreConversation {
  return unwrap<CoreConversation>(
    core.session_fork_branch(
      JSON.stringify({
        conversation,
        at_index: atIndex,
        new_id: newId,
        ...(nowMs === undefined ? {} : { now_ms: nowMs }),
      }),
    ),
    'fork branch',
  );
}

/**
 * Replace one message and drop the stale tail after it.
 *
 * The tail goes because it was an answer to the text that was replaced.
 */
export function overwriteAt(
  core: WasmCore,
  conversation: CoreConversation,
  atIndex: number,
  content: string,
  nowMs?: number,
): CoreConversation {
  return unwrap<CoreConversation>(
    core.session_overwrite_at(
      JSON.stringify({
        conversation,
        at_index: atIndex,
        content,
        ...(nowMs === undefined ? {} : { now_ms: nowMs }),
      }),
    ),
    'overwrite',
  );
}

/** Replace one message's content, keeping the rest of the transcript. */
export function editMessage(
  core: WasmCore,
  conversation: CoreConversation,
  atIndex: number,
  content: string,
  nowMs?: number,
): CoreConversation {
  return unwrap<CoreConversation>(
    core.session_edit_message(
      JSON.stringify({
        conversation,
        at_index: atIndex,
        content,
        ...(nowMs === undefined ? {} : { now_ms: nowMs }),
      }),
    ),
    'edit message',
  );
}

/** Set a message's read flag. */
export function setMessageRead(
  core: WasmCore,
  conversation: CoreConversation,
  atIndex: number,
  read: boolean,
): CoreConversation {
  return unwrap<CoreConversation>(
    core.session_set_message_read(
      JSON.stringify({ conversation, at_index: atIndex, read }),
    ),
    'set message read',
  );
}

/** Add or remove a tag on one message. */
export function setMessageTag(
  core: WasmCore,
  conversation: CoreConversation,
  atIndex: number,
  tag: string,
  remove = false,
): CoreConversation {
  return unwrap<CoreConversation>(
    core.session_set_message_tag(
      JSON.stringify({ conversation, at_index: atIndex, tag, remove }),
    ),
    'set message tag',
  );
}

// ---- search ---------------------------------------------------------------

/** How search results are ordered. */
export type CoreSearchSort = 'newest' | 'oldest' | 'title';

/** The filters a search can apply. */
export interface CoreSearchQuery {
  text: string;
  regex?: boolean;
  case_sensitive?: boolean;
  role?: string | null;
  tag?: string | null;
  unread_only?: boolean;
  include_archived?: boolean;
  file_filter?: string | null;
  limit?: number;
  sort?: CoreSearchSort;
}

/** One matching message. */
export interface CoreSearchHit {
  conversation_id: string;
  conversation_title: string;
  message_index: number;
  role: string;
  preview: string;
  text_matched: boolean;
}

/** Find messages across conversations. */
export function searchMessages(
  core: WasmCore,
  conversations: CoreConversation[],
  query: CoreSearchQuery,
): CoreSearchHit[] {
  return unwrap<CoreSearchHit[]>(
    core.search_messages(JSON.stringify({ conversations, query })),
    'search',
  );
}

// ---- context budget -------------------------------------------------------

/** One piece of context attached to a request. */
export interface CoreContextItem {
  id: string;
  kind: string;
  title: string;
  content: string;
  tokens: number;
  enabled: boolean;
  source: string;
  priority: number;
}

/**
 * Trim context items to fit a token budget.
 *
 * Items are admitted in priority order (lowest number first); an item
 * that does not fit on its own is skipped rather than blocking the
 * rest. The skipped items come back disabled.
 */
export function applyContextBudget(
  core: WasmCore,
  items: CoreContextItem[],
  maxTokens: number,
): CoreContextItem[] {
  return unwrap<CoreContextItem[]>(
    core.context_apply_budget(JSON.stringify({ items, max_tokens: maxTokens })),
    'context budget',
  );
}

/** Estimate the token cost of a string. */
export function estimateTokens(core: WasmCore, text: string): number {
  return core.estimate_tokens(text);
}

// ---- backup ---------------------------------------------------------------

/** One conversation inside a backup file. */
export interface CoreBackupConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: CoreStoredMessage[];
  tags?: string[];
  archived?: boolean;
  read?: boolean;
  forked_from?: string | null;
  forked_at_message?: number | null;
}

/** A complete backup file. */
export interface CoreBackupEnvelope {
  app: string;
  version: number;
  exported_at: number;
  conversations: CoreBackupConversation[];
}

/** Why an import failed. */
export type CoreImportOutcome =
  | { Imported: { count: number; migrated: boolean } }
  | { Corrupt: { reason: string } }
  | { Unsupported: { version: number } };

/** Build a backup envelope from conversations. */
export function exportBackup(
  core: WasmCore,
  conversations: CoreConversation[],
  nowMs?: number,
): CoreBackupEnvelope {
  return unwrap<CoreBackupEnvelope>(
    core.backup_export(
      JSON.stringify({
        conversations,
        ...(nowMs === undefined ? {} : { now_ms: nowMs }),
      }),
    ),
    'backup export',
  );
}

/**
 * Parse a backup file.
 *
 * Returns the conversations, or the outcome that says why the file was
 * refused.
 */
export function parseBackup(
  core: WasmCore,
  raw: string,
): CoreConversation[] | CoreImportOutcome {
  const parsed = JSON.parse(core.backup_parse(raw)) as {
    Ok?: CoreConversation[];
    Err?: CoreImportOutcome;
  };
  if (parsed.Err !== undefined) {
    return parsed.Err;
  }
  return parsed.Ok ?? [];
}

/** Import a backup file into an existing conversation list. */
export function importBackup(
  core: WasmCore,
  raw: string,
  existing: CoreConversation[],
  mode: 'replace' | 'merge' = 'merge',
): {
  outcome: CoreImportOutcome;
  conversations: CoreConversation[];
} {
  return unwrap<{
    outcome: CoreImportOutcome;
    conversations: CoreConversation[];
  }>(
    core.backup_import(
      JSON.stringify({ raw, existing, mode }),
    ),
    'backup import',
  );
}
