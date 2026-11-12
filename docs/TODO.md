# Prism TODO

Tracking queue state for all apps. Update after each landed feature.

Scope rule: the **extension** is a page-context assistant — it gets chat, page
context, snippets/presets, providers, themes, and metrics display. Agent
runtime features (**tools, permissions, RAG, personalities, hardware modes**)
live in the **TUI** (and are shared with desktop via the same libs) — an
extension has no business ingesting documents or running tool loops.

## Extension (apps/extension)

| Feature                                      | Status  | Notes                                                                        |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| Snippets / prompt shortcuts CRUD             | done    | Popup + Settings, IndexedDB persistence, multiple keyboard bindings + combos |
| Prompt presets (ordered entries)             | done    | PromptPresetManager, rehydrates from DB on mount                             |
| Status bar metrics (latency, tok/s, context) | done    | Metrics strips in ChatPage + Popup                                           |
| Web/deep search toggles                      | done    | ChatPage footer + WebSearchPanel                                             |
| Council / multi-send / debate                | done    | Panels; multi-model chat features fit the extension                          |
| Thinking mode toggle                         | done    | Scratchpad fallback; Claude native handled in shared libs/llm                |
| Material style icons                         | done    | Shared Icon component (libs/ui-components)                                   |
| Auth non-mandatory                           | done    | Sign-in optional; API key fallback chain                                     |
| Max font scale 8.0                           | done    | Popup + content script                                                       |
| Per-provider model cache                     | done    | ModelRecentsEditor, free-form model input                                    |
| Themes (6)                                   | done    | data-theme system + picker in Settings                                       |
| Auto model selection                         | partial | Auto button exists; refined per-task routing lives in TUI/desktop            |
| Media capabilities (image/inpaint/video/3D) | done    | MediaPanel in Popup + standalone chat; per-capability provider + key in Settings (`media-capabilities.ts`) |
| Multi-image (vision) chat input             | done    | Attached images ride the core vision wire format; OpenAI-compatible providers go through the core, Gemini/Claude keep their native payload |
| Blaze-style snippets (trigger expansion)   | done    | `Snippet` model in shared-types; typed triggers expand in any editor on the page (standalone/anywhere modes); optional per-snippet keyboard binding; SnippetManager in the Popup; 10 built-in snippets |
| Page-level hotkeys                         | done    | `hotkey-engine.ts` in the content script; `Ctrl+Shift+…` works anywhere on the page, not just in the popup; rebindable in Settings; page-context uses `Ctrl+Shift+G` because the browser reserves `Ctrl+Shift+P` for the extension's own popup command |
| Emoji / shape picker                       | done    | Searchable palette (emoji + Unicode shapes) in the prompt input; inserts at the caret |
| Closed shadow DOM for the in-page iframe    | done    | Matches Blaze: `mode: 'closed'` root, `all: initial` host reset, extension-owned id registry |

**Not in the extension** (by design): tools/permissions, RAG, personalities,
hardware modes, agent memories. See TUI.

## TUI (apps/tui)

| Feature                                  | Status  | Notes                                                                                                                               |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Chat + streaming                         | done    | Ink, core-llm (wasm decoders) + LocalAdapter for capabilities |
| Status bar                               | done    | provider/model/adapterMode/online + tok/s · latency · ctx · session tokens                                                          |
| Web/deep/council/multi-send/debate/agent | done    | Ctrl+W/D/V/M/B keybindings                                                                                                          |
| SillyTavern characters                   | done    | group chat + character select                                                                                                       |
| Themes                                   | partial | nocturnal-editorial only; 6-theme port planned                                                                                      |
| Tools + permissions (allow/deny/ask)     | done    | TUI agent runtime: Node executor (shell/read_file) + PermissionAwareToolExecutor; y/n ask prompt; settings section (allow/ask/deny) |
| RAG (attach documents)                   | done    | /rag <path> ingests local files (chunk + embed, in-memory store); top-k chunks auto-injected on send                                |
| Personalities & agent memories           | done    | 20 defaults + memory store + system-prompt composition done; AgentPicker UI in TUI done                                             |
| Hardware modes (cpu/gpu/amd/intel)       | done    | TUI settings section (compute/gpu-layers/ctx cycles) → chat path → core wasm (num_gpu/num_ctx)                                      |

## Desktop (apps/desktop)

| Feature                                | Status  | Notes                                                       |
| -------------------------------------- | ------- | ----------------------------------------------------------- |
| Shell (Chat/Settings nav)              | done    | Vite + React, reuses extension UI                           |
| Auth                                   | done    | Optional, Supabase                                          |
| Local LLM adapters                     | done    | Inherited via shared settings                               |
| Agent features (tools/permissions/RAG) | planned | Shares TUI's libs; desktop wrapper around TUI agent runtime |

## Desktop (Rust — apps/slint over crates/prism-core)

| Feature                                | Status  | Notes                                                                                          |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| egui dev harness                       | done    | DELETED (2026-11-09): apps/egui removed from the workspace — Slint reached feature parity and CI builds it; the harness had no remaining job |
| Interaction modes (chat/agent/creative/daemon/generative) | done | Core `prism_core::modes` (Mode + ModeTraits + DaemonTask/TaskTrigger + GenCapability); Slint mode rail, agent panel (strategy switcher + task + run + step list), daemon panel (task list with interval/manual triggers, run/remove) |
| Slint UI at egui feature parity        | done    | Streaming, chats sidebar w/ two-step delete, settings (keys/models/sampling/thinking/hardware); shared logic in `apps/slint/src/shared.rs` used by desktop + Android entry points |
| SillyTavern-style character cards     | done    | Core prompt engine in `prism_core::cards`: V2/V1 card parse, macro expansion ({{char}} {{user}} {{description}} {{personality}} {{scenario}} {{persona}} {{first_mes}} {{mes_example}}), lore books (keyword + secondary keys, constant entries, selective/group scoring, whole-word, scan depth, recursion guard, token budget), prompt assembly into ChatMessage[]. Wasm bindings + `@prism/ai-core` typed API; Slint settings card/persona panel
| GUI runtime verification               | pending | Headless box — slint parity check on a display still owed (egui deletion no longer waits on it)|
| Env-var API keys                       | done    | `ProviderDef.env` (13 remote providers); stored key wins, else env vars in preference order; `Settings::key_for` resolves; TUI mirrors via `apps/tui/src/lib/provider-env.ts`; wasm `providers_json` exports `env` |
| Prompt history (up/down recall)        | done    | core `prompt_history` JSONL store (cap 50, dedupe, corrupt-line heal) + `host::record_prompt/load_prompt_history`; Slint ↑/↓ cycling with draft restore |
| Model catalog (models.dev)             | done    | Bundled snapshot (`catalog_snapshot.json`, 12 OpenAI-compat providers, ~650 models) with capabilities/limits/pricing; `prism_core::catalog` (newest non-deprecated default, deprecated-last sorting); Slint picker falls back to catalog when cache empty; model hint shows "name · 128k ctx · tools/reasoning"; regen via `script/update-catalog.py` |
| Command palette (Ctrl+K)               | done    | core `commands` registry (21 commands, 5 groups, namespaced ids, filter fn); Slint palette popup with live filter, ↑/↓ + Enter, click-to-run; doubles as model switcher (`model:<id>` rows); dispatch maps ids onto existing callbacks |
| Agent loop (ReAct in core)             | done    | `prism_core::agent`: Tool trait + ToolRegistry (extension point via `register()`), ReAct loop with max-steps/Final-Answer/non-JSON-as-answer, permission layer (allow/deny/ask with ask-gate fn), built-in calculator (no-eval parser) + web_search stub; 8 tests |
| Code editing tools (native)            | done    | `prism_core::native_tools` behind native-transport: read_file/write_file/edit_file (exact replace, fails when pattern absent)/list_dir; workspace-root path safety (traversal + absolute escape rejected); register_all defaults write/edit to Ask; 6 tests |
| Agent extension API (wasm)             | done    | `prism-wasm`: AgentRegistry (register JsTool / set_permission / gated execute), `agent_run(task, registry, llm_step, max_steps)` — JS supplies the LLM step fn; host drives transport, core owns loop semantics |
| CLI /agent command                     | done    | `apps/cli/src/chat.rs::agent_job` — background thread runs the core ReAct loop (12 steps) with calculator + native file tools; blocking OpenAI-compat LLM step over ReqwestTransport; steps render as system lines, final answer saved to the conversation; mutating tools denied headless |
| Custom providers (config-driven)       | done    | `Settings.custom_providers` — canonical alias (clone built-in defaults, override base URL) or bare OpenAI-compat endpoint; `resolve_provider` unifies built-in/alias/bare for base URL, needs-key, label, env; key precedence stored > custom env > canonical env; Slint add/remove UI + combined dropdown; 6 settings tests |
| Queue/steer (send while streaming)     | done    | `State.prompt_queue` + `queue_processing`; send() queues when streaming; drain_events steers next on completion; Slint shows "Queued" toast; 1 core test |
| API: /api/model / /api/provider        | done    | `apps/api/src/app/routes/model.provider.routes.ts` backed by wasm `providers_json`; GET /api/model, /model/default, /provider, /provider/:id |
| SSE backpressure (4096 dropping queue) | done    | per-subscriber dropping queue (cap 4096) on /api/chat/stream; overflow sends error frame + drops oldest non-error; `enqueueWrite` + `processQueue` |
| Local model support                  | done    | `prism_core::local`: LocalProvider registry (ollama, LM Studio, llama.cpp, KoboldCpp, SGLang, vLLM) with wire shape (OpenAI-compat vs Ollama native), per-provider model-list/health URLs, hardware-override + GGUF flags; discovery parsers (`/api/tags`, `/v1/models`) returning size labels and embedding flags; Health enum (Up/Degraded/Down); best-effort GGUF header reader (magic, version, counts, metadata k/v) that returns partial info on truncation; `host::probe_local` + `reachable_locals` |
| Media capabilities (core + Slint)     | done    | `prism_core::media`: image/inpaint/video/3D request bodies, response parsing (media URL + task id), async provider polling; `host::spawn_media`/`spawn_media_poll`; Slint media panel (capability + provider + prompt/image/mask/seed/duration/format) with ready/pending/failed states |
| Multi-image (vision) chat request      | done    | `ChatMessage.images`; `stream_request_body` emits the OpenAI vision shape (text part + one `image_url` part per image, empty text part omitted); messages without images keep the plain string shape; `thinking::apply_thinking_to_messages` preserves the attachments |
| Portable data sync (↔ extension)        | done    | One envelope both sides read/write: `SyncEnvelope{v1, conversations, prompts, settings}` in `libs/shared-types/src/lib/sync.ts` + `prism_core::sync`; host glue export/import/clear (`<config>/prism-data.json`); Slint settings "Data sync" panel + extension Settings section; roles/timestamps shared, messages carry both id/timestamp and thinking |
| Agent strategies (react + plan-and-execute) | done | Core `prism_core::agent`: `AgentStrategy` + `run_with_strategy`; plan phase parses numbered plans (falls back to the task when unparseable), execute phase runs each step with a per-step tool loop, synthesize phase answers; `AgentStep.phase` tags plan/execute/react for rendering; wasm `agent_run(task, registry, llm_step, max_steps, strategy)` |
| Agent features (tools/permissions/RAG) | planned | Tool-calling + permission gating shipped in core; RAG and multi-agent remain per-surface per single-core scope |

## CLI (apps/cli)

| Feature                                | Status  | Notes                                                                                          |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Ratatui terminal harness               | done    | Event-driven input + chat jobs over prism-core; conversations persisted to disk via core storage |
| Chat + streaming + queue               | done    | Inline streaming, abort, queue drains on done, error pauses queue                              |
| Settings persistence                   | done    | Commands update + persist settings; restores most recent conversation on restart               |
| Behavior tests                         | done    | 9 tests covering stream/drain/abort/error/queue/commands/credentials/search/persistence         |

## Mobile (Slint, single-core plan item 4)

| Feature | Status | Notes |
|---------|--------|-------|
| Android | done | `cargo apk build --target aarch64-linux-android` produces signed APK at `target/debug/apk/prism-slint.apk` with `lib/arm64-v8a/libprism_slint.so` and `com.prism.slint.MainActivity`. Slint `backend-android-activity-06` feature, `#[no_mangle] fn android_main` in `apps/slint/src/lib.rs` calling `slint::android::init(app)` then `shared::run_ui()`. Single UI code path shared with desktop via `shared.rs`. |
| iOS | planned | Requires a Mac |

Expo RN app `apps/Prism` deleted (plan item 7).

## API server (apps/api) — self-hosted Node/Express

| Feature         | Status | Notes                                                                                                                                            |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structured logs | done   | JSON lines to stdout (level/channel/method/status/duration)                                                                                      |
| /metrics        | done   | Prometheus text format: counters per route/status, p50/p95/p99, uptime                                                                           |
| /tools/execute  | done   | Permission-checked tool execution: PRISM_ENABLE_TOOL_EXECUTION=1 opt-in, command allowlist (read-only default), path-traversal guard, output cap |
| /health         | done   | uptime + timestamp                                                                                                                               |
| /api/chat/stream  | done   | SSE proxy over core wasm decoders, OpenAI-compatible frames                                                                                   |
| Provider path     | done   | llm-core.service.ts drives core wasm; hand-rolled llm.service.ts deleted; Anthropic dropped                                                   |

## Shared libs (used by TUI/desktop; not extension UI)

| Lib                         | Status | Notes                                                                                              |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| libs/agent — tools          | done   | web_search (DuckDuckGo fallback), fetch_url real; read_file denied; calculator/code_eval           |
| libs/agent — permissions    | done   | PermissionAwareToolExecutor (allow/deny/ask, ask handler); 7 unit tests                            |
| libs/rag                    | done   | chunkDocument, embedTexts (ollama/openai), InMemory/Dexie stores, retrieveRagContext; 7 unit tests |
| libs/logging                | done   | levels×channels, ring buffer, JSONL export; api /metrics (p50/p95/p99)                             |
| libs/ai-core — hardware | done   | HardwareProfile → num_gpu/num_ctx plumbing (settings + core body path) |
| libs/ai-core — thinking | done   | core apply_thinking/strip_thinking (scratchpad) via ai-core |

## Session model (core)

`prism_core::session` composes the five layers every surface drives, as
data with mode-scoped defaults:

| Layer | Types | Notes |
|---|---|---|
| Prompt | `PromptLayer` | mode system preset (`default_system_prompt`), user input, bound card + persona; assembles via the core card engine when a card is bound |
| Capability | `CapabilityLayer` | tools / subagents / commands / permissions; a tool the session does not advertise returns **Deny** rather than allow-by-absence |
| Transport | `TransportLayer`, `Endpoint`, `Rotation`, `cooldown` | provider + model + key + base URL; rotation (`prefer-primary` / `round-robin` / `random`) over cooldown-aware endpoints |
| Persistence | `PersistenceLayer` | messages (chat/creative), chat tree (creative), job queue (any tool-using or media mode) |
| Session | `Session` | composes all layers; `set_mode` resets capability + persistence while keeping transport |

Wired into the Slint surface: `State::session: Session`, mode switches
drive `session.set_mode` (transport preserved), so the panels the mode
rail shows are exactly what the session permits. The system-prompt field
writes through to `PromptLayer` via `override_prompt` (empty resets to
the mode preset), and the agent run reports the effective permission
count from `session.permission_for` before starting.

## Tests

| Suite                                     | Status         |
| ----------------------------------------- | -------------- |
| libs/agent (permission executor)          | done — 7 tests |
| libs/rag (chunking, stores, formatting)   | done — 7 tests |
| libs/redux-store (chatSlice, presetSlice) | done — 9 tests |
| libs/context-manager                      | done — 8 tests |
| libs/shared-db                            | planned        |
| crates/prism-core (unit + fixture conformance) | done — 181 + 8 tests |
| crates/prism-wasm (wasm-pack test --node) | done — 7 tests |
| apps/api llm-core fixture tests           | done — 6 tests |

## Known debt

- (CLOSED) `@prism/ai-adapters` + `@prism/llm-service` deleted 2026-11-09; all chat paths run on
  `@prism/ai-core` (core wasm). Replacement note: api-client owns its core-driven chat path,
  TUI uses LocalAdapter directly, extension uses ai-core's selectAutoModel.
- Browser bundler-runtime wasm loading (webpack/vite) UNVERIFIED — headless box
- GUI runtime UNVERIFIED (headless box) — egui deleted anyway (parity reached in code; the display check remains owed)
- Old Electron leftover at `apps/apps/desktop/desktop` — delete after confirming new desktop app is canonical
- Agent tool-calling is prompt-parsing based (ReAct), not native function calling
- Extension ChatPage previously grew RAG/agent-runtime UI that belonged in the
  TUI — being moved per scope rule above
