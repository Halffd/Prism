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
| Firefox support                             | done    | One cross-browser manifest, one build. **Manifest**: `background` declares both `service_worker` (Chrome) and `scripts` (Firefox event page) — Chrome 121+ and Firefox 121+ each use their own key and ignore the other; `browser_specific_settings.gecko` adds the AMO id, `strict_min_version` and the mandatory `data_collection_permissions` (`required: ["none"]` — the extension stores settings locally and sends page context only to the configured provider). The `commands` *permission* was dropped (Firefox rejects it in MV3; the `commands` manifest key is still valid and keeps both shortcuts). **Content script**: Firefox's `content_scripts` schema has no `type` property, so a manifest-declared content script is always a classic script — an ES module fails with "import declarations may only appear at top level of a module". The content script is therefore built as a standalone IIFE with no imports (a second Vite pass in `vite.config.mjs`), which works in Chrome and Firefox alike. The pass aliases the `@prism/*` workspace packages to their source entries with **exact-match** regexes — a plain string alias also rewrites deeper specifiers, so `@prism/firebase-auth/src/utils` would become `.../index.ts/src/utils` — and defines `process.env` as an empty object, because the classic script has no Node globals to read the shared libraries' configuration from. **Bundle size**: `libs/ui-components` is marked `"sideEffects": false`, which lets the bundler drop the modules a consumer does not use — without it the content script's import of `Icon` dragged `MermaidRenderer` (and mermaid with it) through the package barrel, taking the content script from 1.9 MB to 5.4 MB and tripping `web-ext lint`'s `FILE_TOO_LARGE` check, which refuses to parse files over 5 MB. **Content-script state**: the floating button's dismissal flag moved from the *page's* `localStorage` to the extension's `chrome.storage.local`, keyed by origin: reading the page's storage throws a `SecurityError` on opaque origins (sandboxed iframes, `data:` documents) and aborted the rest of the script's initialization in Firefox, and it wrote the extension's state into the host page's storage where the user could not clear it. **Host permissions**: Firefox MV3 treats the manifest's host permissions as opt-in, so the content script does not run until the user grants access; `browser-compat/host-permissions.ts` detects the gap and the popup shows a grant banner (Chrome grants at install, so the banner never appears there). **Tooling**: `nx firefox` lints with `web-ext` and packages an AMO-ready zip; `scripts/firefox-smoke.mjs` installs the build into a real Firefox over WebDriver BiDi and asserts the manifest installs, the event page starts and the popup renders under Firefox's CSP (it runs Firefox with `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, which Firefox 153+ requires before WebDriver may navigate to a `moz-extension://` URL, and pins the add-on's internal UUID in the profile pref `extensions.webextensions.uuids` so the extension's origin is known up front rather than scraped from the browser log — a *working* build logs nothing, so scraping only worked while something was broken) |

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
| Local model support                  | done    | `prism_core::local`: LocalProvider registry (Prism Native / bundled server, ollama, LM Studio, llama.cpp, KoboldCpp, SGLang, vLLM) with wire shape (OpenAI-compat vs Ollama native), per-provider model-list/health URLs, hardware-override + GGUF flags; discovery parsers (`/api/tags`, `/v1/models`) returning size labels and embedding flags; Health enum (Up/Degraded/Down); best-effort GGUF header reader (magic, version, counts, metadata k/v) that returns partial info on truncation; `host::probe_local` + `reachable_locals` |
| Memory graph (learning made visible)| done     | `prism_core::memory_graph` ported from Hermes `learning_graph.py`: MemoryCard, fingerprint (FNV-1a of the WHOLE body, never the truncated display text), node id `memory:<source>:<index>:<fingerprint>`, tokenize, score_edge (6× name-hit + token overlap), top_edges, build_graph. `host::random_prompt` draws from a `prompts.json` pool falling back to prompt history; Slint "Surprise me" button + ↑/↓ recall |
| Six-mode taxonomy                    | done     | `prism_core::modes`: Chat / Agent / **Code** / Creative / Daemon / Generative each a contract on one runtime (same transports + models, different constraints). `ModeTraits` gained `subagents` (agent+daemon only), `commands` (mode-scoped, empty = none), `style` (`ModeStyle`: MinimalDiff for Code, TerseExecution for Agent, Narrative for Creative, OpsReport for Daemon, AssetDescription for Generative), `persistence` (`Persistence`: Session / ChatTree / JobQueue / AlwaysOn). Code mode = style-only: no tools, no subagents, no commands, so chat can't `rm -rf` and code never sees RP jailbreaks. `default_system_prompt` has a Code preset. All new fields carry `#[serde(default)]` so pre-existing session files still load |
| Six-mode UI (Slint + TUI + extension)| done     | Slint: mode rail is data-driven from `Mode::all()` (Code tile appeared free), each tile gained a third line of binding constraints (`tools · subagents · tasks · media · <style> · <persistence>`), tiles grew 62→78px. TUI: `imode` on App, `/mode [id]`, Alt+M cycles all six and wraps, mode+style in the status bar, composer title carries the mode, details pane rows for style/persistence/subagents/commands; **enforced** — `/agent` is refused with a naming message in tool-less modes, and switching to a tool-less mode stops a running agent and applies the mode preset prompt. Extension: `apps/extension/src/chat/modes.ts` mirroring the core registry + a mode-bar row above the composer; agent flow gated on `mode.tools`; non-chat/non-creative modes inject the mode preset as the system prompt. A jest conformance suite pins the web registry's counts, styles, persistence, and subagent rules against the Rust core so the surfaces cannot drift |
| Mode mixing + capability editor + permission editor | done | `prism_core::modes::Feature` — the unit a mode grants (Tools, Subagents, Commands, CharacterCards, Media, Tasks, Strategy); modes are bundles of features. `Session.mixed` blends additional modes: `ModeTraits::merged_with` unions flags, concatenates commands without duplicates, keeps the **primary's** style (voice is not a capability) and takes the longer-lived persistence scope. `Session.feature/set_feature/reset_feature` are per-feature overrides that beat the blended modes; `ModeTraits::with_feature` applies one (turning Commands off empties the command list rather than leaving a hollow flag). Permission editing on `CapabilityLayer`: `set_permission` (rejects tools the session does not advertise), `set_default_permission`, `clear_permission`, `permission_rows`, `overridden_tools`; `Permission::label/cycled/from_label`. All new `Session` fields carry `serde(default)` so pre-existing session files still parse. **TUI**: `/mix <mode>`, `/unmix <mode>`, `/cap <feature> [on\|off]`, `/perm <tool> allow\|ask\|deny`; the `/agent` gate reads the *session* traits, so a mix that grants tools opens it and a `/cap` that revokes tools closes it; details pane gains mix/caps/perms rows. **Slint**: per-tile blend toggle (amber edge + `+`/`○` marker, primary shows `●`), a capabilities panel (per-feature checkbox) and a permissions panel (per-tool cycle + default cycle). **Extension**: `ModeSession` in `chat/modes.ts` mirrors the core session (mix/unmix/setFeature/resetFeature/setPermission/cycleToolPermission); the mode bar supports multi-select blending, plus collapsible capability and permission editors; agent flow gated on `sessionHasFeature(session,'tools')`. Tool lists come from `ToolRegistry::tool_names` so the editors list exactly the tools the loop will have |
| Media capabilities (core + Slint)     | done    | `prism_core::media`: image/inpaint/video/3D request bodies, response parsing (media URL + task id), async provider polling; `host::spawn_media`/`spawn_media_poll`; Slint media panel (capability + provider + prompt/image/mask/seed/duration/format) with ready/pending/failed states |
| Image Studio (Slint + Next.js web)    | done    | Node-style parameter panel — Checkpoint / LoRA / Prompt / Sampler / Latent / Seed — exposing steps, CFG, sampler, scheduler, denoise, batch, width/height, VAE, CLIP skip and LoRA chains. Slint: new surface mode 4 (`shared/image.rs` owns state, `app.slint` only presents), worker-thread native renders, `MediaOutcome` polling for ComfyUI. Web: `/image` route in `apps/web`, page-local form state, browser fetch driven by `apps/web/src/studio/media.ts`. Every wire body/response parser comes from `prism-core` through `prism-wasm` media bindings (`media_a1111_body`, `media_comfyui_workflow`, `media_native_png_data_url`, `media_parse_a1111_images`, …), so the browser never duplicates SD rules; results render straight into `<img>`. The former `dioxus-video-studio` crate was migrated here and removed from the workspace |
| Local SD backends (A1111 + in-process) | done    | `apps/native-server`: std-only A1111-compatible HTTP server (`/sdapi/v1/txt2img`, `/img2img`, `/sd-models`, `/samplers`, CORS, `--bind`, default `127.0.0.1:7861`). `prism_core::native_sd`: deterministic CPU renderer + pure PNG encoder (data URLs), one tile per batch cell on both surfaces. No Python, no weights, no sockets in core |
| Unified local Rust backend (LLM + images) | done | One std-only TCP server serves OpenAI-compatible chat (`/v1/models`, `/v1/chat/completions` with SSE `[DONE]`), Ollama-native parity (`/api/tags`, `/api/chat` with NDJSON), and A1111 images on one port with CORS. `prism_core::native_llm` is a deterministic seed-driven preview engine (temperature-scaled nucleus sampling, top-p, stop sequences, max tokens, frequency/presence penalties, UTF-8-safe stream chunks); first-class `local` provider in `providers.rs` + `local.rs` points chat at `http://127.0.0.1:7861/v1`. 10 core engine tests plus 7 HTTP roundtrip tests decode the server's own SSE/NDJSON bytewise with core's decoders |
| Candle SD real inference | done (feature-gated, verified) | `prism_core::candle_sd` runs actual neural weights on CPU (CLIP → UNet → VAE) from a local Diffusers-style directory — no Python, no sockets, no downloads. `candle-sd` feature keeps WASM/preview builds small; `MediaRequest.base_url` is the model path and `model` selects `v1-5`/`v2-1`/`sdxl`/`sdxl-turbo`. Core exposes `CANDLE_ID` through `run_media`; `apps/native-server --sd-model DIR` (or `PRISM_SD_MODEL`) switches the A1111 image routes to real inference with a cached pipeline; Slint Image Studio gains a "Candle (real SD)" backend with the same knob panel. Feature-gated tests cover discovery, version parsing, seeded noise, all sampler mappings, dispatch, and the server/UI error paths; a real-image test runs when `PRISM_CANDLE_SD_MODEL` points at weights. SD 1.5 repos that ship only `vocab.json` + `merges.txt` can use the byte-compatible `tokenizer.json` from `openai/clip-vit-large-patch14` (all 49,408 vocab entries and 48,894 merge rules match). Verified end to end with `runwayml/stable-diffusion-v1-5` fp16 weights (all three SHA-256s checked against Hugging Face metadata): the env-gated real test generated a PNG, and with both Candle engines on one port `/health` reported `image_backend:candle` while A1111 `/sdapi/v1/txt2img` returned valid 64×64 PNGs — identical seeds produced identical bytes and a different seed produced different bytes. Euler ancestral still uses Candle's internal RNG, and LoRA/VAE overrides are not applied by the Candle backend |
| Candle LLM real inference | done (feature-gated, verified) | `prism_core::candle_llm` runs trained quantized chat weights on CPU through Candle's quantized runners: a local GGUF/GGML file plus `tokenizer.json`, no network/Python/downloads. `candle-llm` feature keeps WASM/preview builds small. GGUF `general.architecture` selects `quantized_llama`, `quantized_gemma3`, or `quantized_qwen3`; a streaming header preflight rejects unknown tensor dtypes and unsupported architectures with actionable errors *before* Candle tries to load 10 GB of weights. Shared `GenerateRequest`/`Generated` contract keeps the OpenAI and Ollama wire surfaces unchanged: `apps/native-server --llm-model FILE --llm-tokenizer FILE --llm-format ID` (or `PRISM_LLM_MODEL` / `PRISM_LLM_TOKENIZER` / `PRISM_LLM_FORMAT`) switches both chat routes to real inference with a cached, mutex-serialized pipeline and clears the KV cache between requests. Prompt wrappers: `auto` (filename heuristic), `chatml`, `llama3`, `llama2`, `mistral`, `zephyr`, `deepseek`, `gemma` (Gemma turn markers), `plain`. Seeded temperature/top-p sampling, frequency/presence penalties, EOS/stop-sequence handling, context trimming, preflight, and discovery errors are tested; real generation tests run when `PRISM_CANDLE_LLM_MODEL` / `PRISM_GEMMA3_MODEL` point at weights. Verified end to end with TinyLlama 1.1B Chat Q4_K_M (SHA-256 checked against Hugging Face metadata): real generation passed and the native server served `/health`, `/v1/models`, OpenAI JSON, SSE `[DONE]`, Ollama NDJSON, `/api/tags`, and byte-identical stream/plain content on one port. Gemma 3 1B F16 was also verified end to end: its GGUF loads through `quantized_gemma3`, the matching `tokenizer.json` comes from the model's Hugging Face repo (LFS SHA-256 `d7864051…`), and `PRISM_GEMMA3_MODEL=… PRISM_GEMMA3_TOKENIZER=…` produced real tokens with the `gemma` wrapper. `native_llm` remains the zero-dependency preview engine and is always accepted in model listings |
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
the mode preset), the composer text is the prompt layer's `user_input`,
and the agent run both reports the effective permission count from
`session.permission_for` and renders the session's own tool list with
`allow`/`ask`/`deny` badges rather than a static list.

## Tests

| Suite                                     | Status         |
| ----------------------------------------- | -------------- |
| libs/agent (permission executor)          | done — 7 tests |
| libs/rag (chunking, stores, formatting)   | done — 7 tests |
| libs/redux-store (chatSlice, presetSlice) | done — 9 tests |
| libs/context-manager                      | done — 8 tests |
| libs/shared-db                            | planned        |
| crates/prism-core (unit + fixture conformance) | done — 281 default / 287 with `candle-sd` / 296 with `candle-llm` / 302 with both + 8 fixture tests |
| apps/native-server (HTTP roundtrips) | done — 17 default / 19 with `candle-llm` / 20 with both Candle features |
| Candle real-inference smoke (manual, local weights) | done — TinyLlama chat + Gemma 3 chat + SD 1.5 image verified end to end on one server port |
| `/data/.llama` model compatibility probe | done — Gemma 3 1B F16 loads and generates through `quantized_gemma3`; Qwen 3.6 27B `qwen35` uses GGML dtypes 21/22/23 (IQ3_S/IQ2_S/IQ4_XS) which Candle 0.11.1 cannot read, so preflight rejects it with an actionable `local`/llama.cpp hint. llama.cpp b12606 does support `qwen35` and those dtypes; Prism's `llamacpp` provider already targets its OpenAI-compatible `/v1` endpoint on port 8080 |
| crates/prism-wasm (wasm-pack test --node) | done — 7 tests |
| apps/api llm-core fixture tests           | done — 6 tests |

## Known debt

- (CLOSED) `@prism/ai-adapters` + `@prism/llm-service` deleted 2026-11-09; all chat paths run on
  `@prism/ai-core` (core wasm). Replacement note: api-client owns its core-driven chat path,
  TUI uses LocalAdapter directly, extension uses ai-core's selectAutoModel.
- Browser bundler-runtime wasm loading (webpack/vite) UNVERIFIED — headless box
- GUI runtime UNVERIFIED (headless box) — egui deleted anyway (parity reached in code; the display check remains owed)
- Old Electron leftover at `apps/apps/desktop/desktop` — delete after confirming new desktop app is canonical
- (CLOSED) Candle Stable Diffusion real inference — the feature-gated
  CLIP → UNet → VAE path was verified with `runwayml/stable-diffusion-v1-5`
  fp16 weights: the real-image test passed and the A1111 route returned valid
  PNGs with deterministic seed behavior. The repo still does not ship weights;
  `PRISM_CANDLE_SD_MODEL` (or `--sd-model`) must point at a local
  Diffusers-style checkpoint. `prism_core::native_sd` remains the zero-dependency
  preview renderer; A1111 / ComfyUI stay available for full checkpoint/LoRA flows.
- (CLOSED) Real neural LLM inference — `prism_core::candle_llm` adds a
  feature-gated Candle/GGUF runner for trained chat models, wired into both
  local chat routes with cached inference. Verified end to end with the
  TinyLlama 1.1B Chat Q4_K_M GGUF plus its `tokenizer.json`: the env-gated real
  generation test passed and the native server served OpenAI JSON, SSE,
  Ollama NDJSON, model discovery, and matching stream/plain content. The
  repository still does not ship weights; `PRISM_CANDLE_LLM_MODEL` (or
  `--llm-model`) must point at local files. `prism_core::native_llm` remains the
  deterministic offline preview engine; Ollama / OpenAI-compatible local
  servers remain available for models Candle cannot load (non-llama GGUF
  architectures, newer quantization formats).
- Gemma 3 GGUFs are now dispatched to Candle's `quantized_gemma3` runner with a
  `gemma` chat wrapper and the model repo's own `tokenizer.json` (the GGUF only
  stores a chat template, not a tokenizers file). Its KV cache is overwritten at
  position 0 instead of explicitly cleared, and real generation is CPU-slow
  (~5 minutes for 4 tokens on a 1B F16 model), but it is trained neural
  inference, not the preview engine.
- Qwen 3.6 27B in `/data/.llama` is a `qwen35` architecture with GGML dtypes
  21/22/23; Candle 0.11.1 (latest published) supports neither, so it cannot run
  in the Candle backend. Preflight reports this in seconds instead of failing
  deep inside `gguf_file::Content::read`. llama.cpp b12606 loads and supports
  this file, and Prism's built-in `llamacpp` provider can talk to `llama-server`
  on `http://localhost:8080/v1`. That external-runtime path is not built into
  `prism-native-server`, which stays self-contained.
- Remote browser backends need the local install to send CORS headers; the bundled
  `apps/native-server` does, stock A1111/ComfyUI may need a proxy or launch flag.
- Agent tool-calling is prompt-parsing based (ReAct), not native function calling
- Extension ChatPage previously grew RAG/agent-runtime UI that belonged in the
  TUI — being moved per scope rule above
