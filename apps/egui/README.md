# Prism egui (Rust desktop client)

Native desktop chat client for Prism, built with [egui](https://github.com/emilk/egui)
via eframe. Talks to AI providers directly or through a running Prism API
server.

## Features

- Chat window with streaming responses (OpenAI-compatible SSE)
- Direct mode: OpenAI, Gemini (OpenAI-compat), Qwen (DashScope compat),
  Ollama (local `/v1`) — one streaming client for all
- Prism API mode: non-streaming via `POST /api/chat` with Bearer JWT
- Provider/model pickers, temperature slider, credential fields
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
  request/response).
- Temperature is sent as-is; a few providers reject `0` with streaming.

## Tests

Parser and settings logic are covered by unit tests:

```bash
cargo test
```
