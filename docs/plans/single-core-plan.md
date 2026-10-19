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
   GUI runtime UNVERIFIED (headless box) — egui remains as the native
   dev harness until parity is confirmed on a display; deletion
   deferred to that point.
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
4. Android via Slint.
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
8. Deletions happen IN each swap PR — no deprecation window. Final
   gate: zero imports of `@prism/ai-adapters` / `@prism/llm-service`
   provider paths / duplicated client logic remain.

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

## Environment realities

- This dev box is headless: verification bar is compile + tests
  (cargo test, wasm-pack test). GUI behavior needs a display; iOS
  needs a Mac.
- If WASM-in-extension ever proves unworkable (CSP is a one-line
  manifest change; the extension already calls providers from page
  context, bypassing the service worker), the fallback is a sanctioned
  TS exception for the extension only — an explicit new decision, not
  a default.
