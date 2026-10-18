# Prism egui (Rust desktop client)

Native desktop chat client for Prism, built with [egui](https://github.com/emilk/egui)
via eframe. Talks to AI providers directly or through a running Prism API
server.

This crate is a **thin host over `crates/prism-core`** — the single AI
core shared by all Prism surfaces. The host owns only the UI, the tokio
executor (`bridge::runtime`) and platform paths; all provider clients,
stream decoders, thinking, settings and conversation persistence live in
the core.

## Features

- Chat window with streaming responses (OpenAI-compatible SSE)
- Direct mode: OpenAI, Gemini (OpenAI-compat), Qwen (DashScope compat),
  DeepSeek, Groq, OpenRouter, Mistral, and local Ollama / llama.cpp /
  KoboldCpp / SGLang servers — one streaming client for all
- Prism API mode: non-streaming via `POST /api/chat` with Bearer JWT
- Per-provider API keys (migrated from the legacy single key on load)
- Fetch Available Models (`GET /models`) with a per-provider cache,
  click a cached model to select it
- Sampling controls: temperature, max tokens, top P, frequency and
  presence penalties (empty = omitted, server default)
- System prompt, sent as the first message in direct mode
- Thinking mode: reasons inside `<thinking>` tags first, shown as a
  collapsible block above the answer (same scheme as the extension)
- Hardware profile (preferred compute, GPU layers, context tokens) —
  reaches Ollama through its native `/api/chat` options when overrides
  are set; other local servers take these as launch flags
- Conversation persistence: transcripts autosave under
  `~/.config/prism-egui/conversations/` as JSON (atomic writes), with a
  sidebar to switch, create and delete chats; thinking is stored
  separately from the answer
- Settings persisted to the platform config dir, e.g.
  `~/.config/prism-egui/settings.json` (written atomically)

## Run

```bash
cd apps/egui
cargo run
```

Or through nx (project name `egui`):

```bash
npx nx build egui
npx nx test egui
```

## Known limitations

- API keys and the prism-api JWT are stored in plaintext, matching how
  the Prism extension stores keys in chrome.storage.
- Prism API server mode is non-streaming (the endpoint is a single
  request/response) and does not carry the system prompt — the server
  owns the prompt there.
- Hardware overrides are ignored on the OpenAI-compat path of
  llama.cpp/KoboldCpp (server launch flags in that API); Ollama gets
  them per-request via its native endpoint.
- Claude is not offered in direct mode: its native API is not
  OpenAI-compatible.
- Temperature is sent as-is; a few providers reject `0` with streaming.
- Conversation transcripts are saved at send/response boundaries, so a
  crash mid-stream can lose the last partial response.

## Tests

Parsers, thinking port, conversation store and settings logic are
covered by unit tests:

```bash
cargo test
```
