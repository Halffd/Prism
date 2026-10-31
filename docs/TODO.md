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

**Not in the extension** (by design): tools/permissions, RAG, personalities,
hardware modes, agent memories. See TUI.

## TUI (apps/tui)

| Feature                                  | Status  | Notes                                                                                                                               |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Chat + streaming                         | done    | Ink, shares ai-adapters                                                                                                             |
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

## Desktop (Rust — apps/egui + apps/slint over crates/prism-core)

| Feature                                | Status  | Notes                                                                                          |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| egui dev harness                       | done    | Thin host over prism-core (bridge.rs); no own tests, logic lives in the core                   |
| Slint UI at egui feature parity        | done    | Streaming, chats sidebar w/ two-step delete, settings (keys/models/sampling/thinking/hardware); shared logic in `apps/slint/src/shared.rs` used by desktop + Android entry points |
| GUI runtime verification               | pending | Headless box — slint parity check on a display gates egui deletion (plan item 2)               |
| Env-var API keys                       | done    | `ProviderDef.env` (13 remote providers); stored key wins, else env vars in preference order; `Settings::key_for` resolves; TUI mirrors via `apps/tui/src/lib/provider-env.ts`; wasm `providers_json` exports `env` |
| Prompt history (up/down recall)        | done    | core `prompt_history` JSONL store (cap 50, dedupe, corrupt-line heal) + `host::record_prompt/load_prompt_history`; Slint ↑/↓ cycling with draft restore |
| Model catalog (models.dev)             | done    | Bundled snapshot (`catalog_snapshot.json`, 12 OpenAI-compat providers, ~650 models) with capabilities/limits/pricing; `prism_core::catalog` (newest non-deprecated default, deprecated-last sorting); Slint picker falls back to catalog when cache empty; model hint shows "name · 128k ctx · tools/reasoning"; regen via `script/update-catalog.py` |
| Agent features (tools/permissions/RAG) | planned | Stays per-surface until core proven (single-core plan scope)                                   |

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
| libs/ai-adapters — hardware | done   | HardwareProfile → num_gpu/num_ctx plumbing                                                         |
| libs/ai-adapters — thinking | done   | Claude native + scratchpad fallback helpers                                                        |

## Tests

| Suite                                     | Status         |
| ----------------------------------------- | -------------- |
| libs/agent (permission executor)          | done — 7 tests |
| libs/rag (chunking, stores, formatting)   | done — 7 tests |
| libs/redux-store (chatSlice, presetSlice) | done — 9 tests |
| libs/context-manager                      | done — 8 tests |
| libs/shared-db                            | planned        |
| crates/prism-core (unit + fixture conformance) | done — 52 + 8 tests |
| crates/prism-wasm (wasm-pack test --node) | done — 7 tests |
| apps/api llm-core fixture tests           | done — 6 tests |

## Known debt

- `@prism/ai-adapters` imports remain: extension ChatPage (selectAutoModel), tui-client + api-client
  (AdapterRouter instances for non-chat paths) — deletion target, plan item 8
- Browser bundler-runtime wasm loading (webpack/vite) UNVERIFIED — headless box
- GUI runtime UNVERIFIED — egui kept as native dev harness until slint parity is confirmed on a display
- Old Electron leftover at `apps/apps/desktop/desktop` — delete after confirming new desktop app is canonical
- Agent tool-calling is prompt-parsing based (ReAct), not native function calling
- Extension ChatPage previously grew RAG/agent-runtime UI that belonged in the
  TUI — being moved per scope rule above
