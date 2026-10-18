# Fixtures are the spec

Each case directory holds `input.txt` (raw recorded wire bytes) and
`expected.json` (the exact decoded output the core must produce). The
conformance suite in `crates/prism-core/tests/conformance.rs` replays
every fixture through the decoders **twice** — whole input and
byte-by-byte — and requires identical output on both paths.

Categories:

- `sse/` — OpenAI-compatible `chat/completions` SSE streams
  (`data:` lines, keep-alives, `[DONE]`, unterminated streams,
  multi-byte UTF-8 split across chunk boundaries)
- `ollama/` — Ollama native `/api/chat` NDJSON streams
  (`done: true` terminators, blank-line keep-alives, error lines)
- `api/` — prism-api `POST /api/chat` full-response bodies
- `models/` — OpenAI-compatible `GET /models` bodies
- `thinking/` — `<thinking>` scratchpad strip semantics
- `settings/` — settings JSON normalization + legacy migration

Provenance: shapes are taken from the provider wire formats and the
prism-api server's actual response construction. Where a live capture
differs from these files, capture it and update the fixture — the
fixture wins over any prose spec.

Rule: a core change that breaks a fixture is a regression, not a
fixture problem. New behavior means a new fixture.
