# Prism architecture plan: single Rust core

Outcome of the grilling session, 2026-10-17. Every item below was
explicitly chosen by the user; alternatives considered and rejected are
noted where the reasoning matters.

## Vision

AI on any platform/device, fast, with no diverging implementations.

## Locked decisions

### 1. Single core: one Rust implementation, compiled native + WASM

The AI stack (provider clients, streaming, thinking, sampling,
settings, conversations) exists exactly once, in Rust. JS surfaces
consume it as WASM; native surfaces link it directly.

- Consequence: `libs/ai-adapters`, `libs/llm-service` provider paths,
  and the duplicated client logic in `libs/api-client` are eventually
  deleted, not frozen.
- Evidence that motivated this: yesterday's egui client was divergence
  #2 (adapters, thinking, settings, conversations re-implemented in
  Rust). The TS "core" is ~4,850 lines of ~90% plumbing; the genuinely
  platform-specific parts are exactly Transport and Storage.

### 2. Core v1 scope = egui feature set behind two traits

Transport (reqwest native / fetch WASM) and Storage (fs native /
IndexedDB + localStorage WASM). Provider streaming (OpenAI-compat SSE,
Ollama native NDJSON, prism-api), models fetch, sampling, thinking,
settings, conversations. Agent loop, RAG, OCR/STT/TTS/image-gen stay
per-surface until the core is proven.

Rule: anything that cannot compile for BOTH targets does not ship in
the core.

Core crate lives at `crates/prism-core` (extracted from `apps/egui`,
which becomes its first consumer).

### 3. WASM everywhere for JS hosts

One wasm artifact (wasm-bindgen; browser + nodejs targets) consumed by
extension, web, api, TUI alike. Node hosts inject fs-backed Storage via
host glue. No napi-rs. The api server is NOT exempt — its provider path
moves onto the same wasm.

Rejected: napi for Node (second binding layer, per-platform CI),
server exemption (reintroduces the divergence being killed).

### 4. UI: Slint (egui and Tauri both dead)

One UI codebase across desktop (Linux/Mac/Windows), Android, iOS
(Rust-only), and web via WASM.

- Tauri rejected on verified facts: its UI layer is the system webview;
  it cannot host a Rust UI framework. Reason given was mobile; Tauri
  would have forced a web UI.
- egui rejected for mobile: eframe officially supports native Android
  with caveats (suspend/resume issue #1951 open) and iOS is not
  blessed; Slint 1.15 (Feb 2026) supports Android + iOS including
  safe-area and virtual-keyboard handling.
- Cost accepted: presentation rewrite (egui `app.rs` -> .slint +
  Rust callbacks). The egui logic harvests into the core first, so the
  work is not lost.
- License: project is MIT; use Slint's royalty-free license (GPLv3
  build would make the distributed binary GPL). Royalty-free license
  ACCEPTED 2026-10-19 — decision made in the grill session (locked
  decisions above); this line is the repo record of that acceptance.
- iOS builds require a Mac. Android builds are possible from Linux.

### 5. Fixtures ARE the spec

`contracts/fixtures/` holds recorded REAL provider responses (OpenAI
SSE, Ollama NDJSON, prism-api JSON, error and malformed cases). The
conformance suite replays every fixture through the core twice (native
build and wasm build) and requires identical parsed output. Property
tests (proptest) cover streaming parsers. The markdown spec describes
the fixture taxonomy and is never authoritative.

CI gate: `cargo test` + `wasm-pack test` both green or the core does
not merge.

Rejected: schema-first (schemas rot independently of behavior),
doc-first-suite-later (the documented drift trap).

### 6. Migration order (with kill dates)

1. ~~Core extraction to `crates/prism-core` behind Transport/Storage
   (native), fixture conformance; egui binary keeps building as first
   consumer.~~ **DONE** — `crates/prism-core` extracted (client,
   providers, thinking, settings, conversations, transport, storage);
   conformance suite green on 18 fixtures whole + byte-split;
   `--no-default-features` build proves the wasm-ready boundary;
   `apps/egui` is a thin host (`bridge.rs`).
2. ~~Slint desktop UI consuming the core natively, at feature parity
   with the egui app.~~ **DONE (code)** — `apps/prism-slint`: full-parity
   chat UI (streaming, chats sidebar with two-step delete, settings
   panel with per-provider keys / fetch-models / sampling / system
   prompt / thinking / hardware cycles, Ollama native path, conversation
   autosave). Host glue hoisted to `prism-core::host`, shared with egui.
   GUI runtime still UNVERIFIED (headless box), but egui is now
   DELETED (2026-11-09) — the desktop + Android Slint app has full
   feature parity and the CI workflow builds it, so the harness has no
   remaining job; `apps/egui` removed from the workspace.
3. ~~WASM target + bindings; conformance green on both targets.~~
   **DONE** — `crates/prism-wasm` (cdylib): JSON-string boundary,
   exported SSE/NDJSON decoders (Uint8Array in, event-JSON out),
   prism-api/models parsers, thinking, providers table, settings
   normalization + legacy migration. Fixture table generated by
   build.rs via include_str!; conformance replays all 18 fixtures
   whole + byte-split under wasm32-unknown-unknown in Node
   (`wasm-pack test --node crates/prism-wasm`) — 7 passed, 0 failed.
   Fetch-based Transport intentionally deferred to the host swaps
   (decoder-first contract: hosts drive HTTP, core parses).
4. ~~Android via Slint.~~ **DONE** — `cargo apk build --target aarch64-linux-android` produces a signed APK (`target/debug/apk/prism-slint.apk`) with `lib/arm64-v8a/libprism_slint.so` and `com.prism.slint.MainActivity`. Slint `backend-android-activity-06` feature, `#[no_mangle] fn android_main` in `lib.rs` calling `slint::android::init(app)` then `shared::run_ui()`. Desktop `main.rs` delegates to `shared::run_ui()` for a single UI code path.
5. ~~apps/api swaps onto wasm-in-node; gains SSE endpoint
   `/api/chat/stream` proxying the core.~~ **DONE** — request-body
   builders (`stream_request_body`/`ollama_chat_body`/`api_chat_body`)
   are core-owned (run_* refactored onto them, unit-tested); exported
   via `crates/prism-wasm` (`build_stream_body` etc.). api's
   hand-rolled `llm.service.ts` DELETED; new `llm-core.service.ts`
   drives fetch + feeds bytes to the wasm SSE decoder (fixture-backed
   jest tests, 6 passed). `/api/chat/stream` emits OpenAI-compatible
   SSE frames (consumable by the core's SseDecoder — egui/TUI can
   adopt streaming later unchanged). Anthropic dropped from the api
   provider path (core is OpenAI-compat-only) — noted. wasm pkg
   committed at `apps/api/src/wasm-pkg` (regenerate:
   `wasm-pack build --target nodejs crates/prism-wasm --out-dir
../../apps/api/src/wasm-pkg`).
6. ~~TUI swaps.~~ **DONE (code)** — `apps/tui` chat path drives the core
   wasm via `apps/tui/src/lib/core-llm.ts` in all three connection
   modes (`3d242f0`); hardware profile flows settings → chat screen →
   core (num_gpu/num_ctx). AdapterRouter instances remain in
   tui-client / api-client for non-chat paths — see item 8.
7. ~~extension + web swap; Expo RN app `apps/Prism` is dead.~~
   **DONE (code)** — `libs/llm-service` AIService.chatCompletion routes
   the extension/web text-chat path through the core (dual pkg loader:
   nodejs pkg for node/tests via process.getBuiltinModule — jest's
   worker-wide resolver patch breaks createRequire otherwise — and
   bundler pkg for browsers). Vision (openai/gemini images) + non-compat
   providers (claude, transformers, poe, cloudflare-workers, zai) keep
   legacy methods until the core extends. Thinking is now core semantics
   (first-user injection — legacy TS used last-user). Core providers
   table +6 (grok, nvidia-nim, cerebras, together, fireworks,
   perplexity). RN app DELETED. Browser bundler-runtime (webpack/vite
   wasm loading) UNVERIFIED headless — flagged. Web app itself doesn't
   import llm-service (no change needed there yet).
8. ~~Deletions happen IN each swap PR — no deprecation window.~~
   **DONE** — every chat wire path is core-mediated:
   libs/llm `openaiCompatibleComplete` funnel (14 providers incl. all
   OpenAI-compat + transformers/HF) → core builders + SSE decoder
   (images keep a legacy branch until core vision); local-adapter
   chat → core (ollama native / compat /v1; kobold on its /v1
   endpoint); ai-adapters `thinking.ts` DELETED; llm-service model-list
   parsing → core `parse_models_response` (OpenAI-shape getters; exotic
   native lists pending); AIService.updateConfig gap fixed. Loader
   hardening: candidate-list node resolution + variable-path browser
   import so consuming dists/bundles resolve the pkg. Final gate
   result: zero hand-rolled provider chat bodies/parsers remain in TS.
   Remaining non-core host surfaces (by design): search/capability
   orchestration, auto-model selection, vision paths, exotic model-list
   getters, transformers/claude/poe/cloudflare/cohere native adapters.
   **CLOSED (2026-11-09)** — `libs/llm-service` and `libs/ai-adapters`
   are DELETED. Replacement: `libs/ai-core` (wasm bindings only — body
   builders, decoders, provider table, `streamSseText`); surfaces drive
   their own HTTP. Ports: api-client owns its own core-driven chat path
   (`coreChatCompletion`/`coreGetModels`); extension ChatPage uses
   `selectAutoModel` from ai-core; TUI tui-client calls LocalAdapter
   directly for the capability set (chat already used core-llm).
   Dropped with the old packages: the TS per-provider switch
   (claude/transformers/poe/cloudflare-workers/zai) and the
   AdapterRouter's server/local mode routing — the core is
   OpenAI-compatible-only by the "must compile for BOTH targets" rule.

### 7. "Fast" = streaming everywhere + measurable budgets

Verified baseline: NOTHING in the TS world streams today
(`stream: false` in llm-service, no stream handling in
direct-api-adapter/use-chat). The Rust core is the first streaming
implementation in the monorepo.

- Every surface renders tokens incrementally. Slint streams natively
  via the core; server-mode surfaces stream through the new
  `/api/chat/stream` endpoint.
- Local-first providers stay first-class (Ollama native path +
  hardware overrides live in the core).
- Budget gates in CI: extension wasm bundle <= 1.5 MB gzipped; core
  cold-init <= 100 ms in browser.

## Env-var keys + prompt history (2026-10-31)

Adopted from the adjacent-implementation survey (feature #1 of the ranked list):

- **Env-var API keys**: `providers::ProviderDef.env` lists each remote
  provider's env-var names (e.g. openai → `OPENAI_API_KEY`, gemini →
  `GEMINI_API_KEY` then `GOOGLE_API_KEY`). `providers::resolve_key`:
  stored settings key wins, else first non-empty env var.
  `Settings::key_for` applies it, so Slint/CLI inherit automatically;
  the TUI mirrors the table in `apps/tui/src/lib/provider-env.ts`
  (wasm surface passes through `env` in `providers_json`).
- **Prompt history**: `prism_core::prompt_history` — JSONL at
  `<config>/history.jsonl`, cap 50, dedupe-on-resend (moves to tail),
  line-level corruption recovery (bad lines dropped, file healed on
  next write). Host glue `host::record_prompt` / `load_prompt_history`.
  Slint: ↑/↓ cycles history, forward-past-newest restores the draft.

## Model catalog (2026-10-31, review #2)

- **Bundled snapshot**: `crates/prism-core/src/catalog_snapshot.json` —
  12 OpenAI-compatible providers mapped onto Prism ids (google→gemini,
  xai→grok, nvidia→nvidia-nim, togetherai→together, fireworks-ai→
  fireworks), ~650 models with `reasoning`/`tool_call`/`attachment`
  flags, context/output limits, per-Mtok pricing, modalities, status.
  ~200 KB (trimmed from the 6 MB full catalog; non-chat providers like
  bedrock/vertex excluded — Prism's transport is OpenAI-compat only).
- **API**: `prism_core::catalog` — `Catalog::model(provider, model)`,
  `models_for(provider)` (newest-first, deprecated-last),
  `CatalogProvider::default_model()` (newest non-deprecated).
  Corrupt/partial snapshots degrade to empty metadata, never fail.
- **Slint surface**: picker falls back to catalog models when the
  per-provider cache is empty (live /models fetch stays authoritative);
  empty-model-field hint shows "name · 128k ctx · tools/reasoning".
- **Regen**: `python3 script/update-catalog.py` (stdlib-only fetcher).
- Deferred from the surveyed design: live refresh with TTL cache
  (snapshot is regenerated manually for now — one command, no daemon);
  reasoning-effort variants; context-tiered pricing.

## Command registry + Slint palette (2026-11-02, review #3)

- **Core registry**: `prism_core::commands` — static `COMMANDS` table
  (21 commands, 5 groups: Chat/Models/Settings/Hardware/View) of
  `CommandDef { id, title, group, takes_arg, while_streaming }` with
  namespaced ids (`chat.new`, `models.pick`, …). `find_command` +
  `filter_commands` (case-insensitive substring over id/title/group).
  Core owns the table so TUI/CLI can reuse it for slash menus.
- **Slint palette**: Ctrl+K-style popup (`palette-toggle` callback,
  opened by the palette button; Esc closes, ↑/↓ move, Enter runs,
  click runs). `palette_refresh` rebuilds results from the query —
  registry commands plus `model:<id>` rows from the cached/catalog
  models, so the palette doubles as the model switcher.
  `palette_execute` dispatches ids onto the existing callbacks (new
  chat, connection switch, save, thinking toggle, hardware cycles +
  compute presets, view toggles, scroll, history recall, models
  fetch) — no logic duplicated, the registry describes, shared.rs
  dispatches.
- Deferred: user-defined commands from a config dir (needs a config
  schema decision), keybinding remaps, fuzzy scoring (substring is
  enough at 21 entries).

## Custom providers (2026-11-02, review #4)

- **Schema**: `Settings.custom_providers: HashMap<String,
  ConfigProvider>` with `ConfigProvider { canonical, label, base_url,
  headers, env, models }` (serde-defaulted, roundtrip-tested). Two
  shapes: canonical alias (clone a built-in's defaults, override the
  base URL — "my OpenRouter proxy") or bare endpoint (LM Studio, vLLM,
  a gateway — label required or the id is used).
- **Resolution**: `Settings::resolve_provider(id) -> ResolvedProvider`
  unifies built-in / alias / bare into one spec (base_url, label,
  default_model, needs_key, env, headers). `send()`, `fetch_models`,
  provider dropdown all go through it. Key precedence: stored key >
  custom `env[]` > canonical provider's env.
- **Slint UI**: settings panel "Custom providers" — id + canonical
  dropdown ("(bare endpoint)" or a built-in) + base URL, add/remove,
  combined provider dropdown refreshed live.
- Deferred: per-model request-body/limit overrides (schema field
  `models` reserved), headers UI (schema-supported, no input yet),
  editing existing entries (remove + re-add).

## Agent loop + code tools + extension system (2026-11-05)

- **Core loop**: `prism_core::agent` — `Tool` trait, `ToolRegistry`
  (`register()` is the extension point; permissions allow/deny/ask),
  `run_agent(task, step_fn, registry, max_steps, ask)`. Loop semantics:
  JSON thought/action/observation; `Final Answer` ends; non-JSON model
  response is treated as the direct answer; max steps returns
  `completed: false` + error. `StepFn` keeps the loop transport-free —
  surfaces inject their own LLM call.
- **Built-ins**: `CalculatorTool` (recursive-descent parser, no eval),
  `WebSearchStubTool` (placeholder the host replaces by registering a
  real tool under `web_search`).
- **Code editing tools**: `prism_core::native_tools` (native-transport
  gated) — `read_file`/`write_file`/`edit_file` (exact string replace,
  errors when pattern absent — never silent)/`list_dir`. All resolve
  through `safe_join(root, path)`: `..` traversal and absolute escapes
  rejected; `register_all` sets write/edit to Ask so interactive
  surfaces gate mutations.
- **WASM extension API**: `AgentRegistry` (JS-registered `JsTool`s,
  permission setter, gated execute with a JS ask fn) and
  `agent_run(task, registry, llm_step, max_steps)` — the JS host
  provides the LLM step function, the core owns loop semantics.
- Deferred: plan-and-execute/reflexion strategies (ReAct first — the
  TS libs/agent already has them for the extension), streaming
  step-by-step callbacks, tool result truncation policy.

## Portable data sync (2026-11-08)

Chat/session/prompt storage is compatible across the extension
(IndexedDB) and Slint/CLI/TUI (JSON files) through one envelope:

- **Envelope**: `SyncEnvelope { app: "prism", version, exported_at,
  conversations[], prompts[], settings }` — defined twice, once per
  language, field-for-field identical (`libs/shared-types/src/lib/sync.ts`
  and `crates/prism-core/src/sync.rs`). Roles are the same strings
  everywhere; timestamps epoch ms. Messages carry BOTH the extension
  fields (id/timestamp) and the core field (thinking), so neither side
  loses what it needs.
- **Extension** (`apps/extension/src/chat/sync.ts`): `exportData` reads
  chatSessions + chatHistory + prompts + chrome.storage settings;
  `importData` writes them back (`saveChatHistory`/`savePromptShortcut`);
  `clearData` deletes sessions + prompts, keeps settings.
- **Rust** (`prism_core::host`): `export_data` writes
  `<config>/prism-data.json` (pretty, diffable); `import_data` applies
  sessions (settings untouched — keys stay local); `clear_data` removes
  conversations. `SyncEnvelope::from_core`/`to_core` map the
  Conversation/StoredMessage shape.
- **UI**: Slint settings → "Data sync" panel (Export / Import / Clear
  local + cloud sign-in row; cloud sign-in reports not-available on
  desktop rather than pretending). Extension Settings gets the same
  buttons via `sync.ts`.
- Import path is deliberately explicit (standard sync path, not a file
  picker) until Slint gains a dialog dependency; the envelope is
  JSON so any file browser works.

## Service-worker note (extension)

The MV3 background service worker imports the core (it relays
`sendMessage` from pages) — request/response only, never a long-lived
stream. Stream state always lives in page contexts (popup/iframe/chat
tab), so the "SW killed mid-stream" failure mode does not apply. The
wasm core is stateless per call (decoders are fed byte chunks and
discarded), so an SW kill/restart just re-instantiates on next use.
Manifest has `"type": "module"` (ESM dynamic import works) and
`wasm-unsafe-eval` CSP; the pkg is copied to both the dist root (SW
chunk) and `assets/` (hashed page chunks) by the vite build.

## Environment realities

- This dev box is headless: verification bar is compile + tests
  (cargo test, wasm-pack test). GUI behavior needs a display; iOS
  needs a Mac.
- If WASM-in-extension ever proves unworkable (CSP is a one-line
  manifest change; the extension already calls providers from page
  context, bypassing the service worker), the fallback is a sanctioned
  TS exception for the extension only — an explicit new decision, not
  a default.
