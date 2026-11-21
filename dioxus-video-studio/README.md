# Video Studio — AI Video Generation Dashboard (Dioxus + Tailwind CSS)

A high-fidelity UI clone of an AI video generation dashboard, built from
scratch with the **Dioxus Rust framework** (Web / WASM target) and styled
with **Tailwind CSS v4** — now a routed multi-page web app **wired to the
Prism system**.

## ✨ Guarantees

- **No paywalls.** There is no upgrade prompt anywhere in the UI.
- **No credits system.** No "credits", "tokens", or cost counters exist
  in the codebase or the rendered UI.
- **Unrestricted generation.** The Generate button is free and unlimited —
  quantity 1–8, any model, any settings.
- **No storage banner.** The "stored for 7 days / upgrade now" banner is
  intentionally omitted from the Workspace.
- **No discount badges.** The "10+ Off" badge on Plugins is omitted, while
  the Workflows `Beta` and Arena `New` badges are kept.
- **Model choice as shopping.** The model picker is a card menu — feature
  chips (Reference / Start-End / Audio), spec lines (`480-4k | 4-30s`) and
  vibe thumbnails — with badges like `Top pick`, `Fast` and `New`, but no
  credits or discounts.
- **Designed empty state.** The workspace greets you with "Empty, for
  now — your first creation changes that." and a gently floating
  polaroid stack, not a blank void.

## 🛣️ Routes

| Route        | Page      | What it does |
| ------------ | --------- | ------------ |
| `/`          | Studio    | The generation dashboard (control panel + workspace) |
| `/chat`      | Chat      | ChatGPT-style chat: conversation rail, streaming transcript, code blocks, copy / regenerate — history persists |
| `/settings`  | Settings  | Provider / model / API key form, persisted to localStorage |
| `/:..segments` | 404     | Styled fallback page for unknown paths |

All pages live under a `ShellLayout` (sidebar + `<Outlet>`), so the
sidebar, mobile drawer and shared state persist across navigation.

## 🔌 Prism system wiring

Per the Prism single-core boundary design
(`crates/prism-core`, see `docs/plans/single-core-plan.md`), the core owns
all AI logic and is transport-free; hosts drive their own HTTP and feed
raw bytes into the core's decoders. This app follows that contract:

- **`prism-core` as a direct dependency** (`default-features = false`,
  so no native tokio/reqwest — wasm-clean):
  - `providers::PROVIDERS` — the provider table (OpenAI, Gemini, Qwen,
    DeepSeek, Groq, OpenRouter, Mistral, Ollama, llama.cpp, KoboldCpp,
    SGLang, …) drives the Settings provider picker and defaults.
  - `client::stream_request_body` / `wire_message` — build the
    OpenAI-compatible `POST {base}/chat/completions` body.
  - `client::SseDecoder` / `NdjsonDecoder` — decode streamed responses
    into `StreamEvent`s. Byte chunks from the browser's
    `ReadableStream` go straight in, at any chunk boundary.
  - `client::parse_api_response` / `parse_models_response` — decode
    non-streaming JSON replies (prism-api chat, `GET {base}/models`).
  - `client::ollama_chat_body` + `providers::ollama_root_url` — the
    Ollama native NDJSON wire (`POST {root}/api/chat`).
- **`src/api.rs`** is the only place that touches the network: browser
  `fetch` + `AbortController` (the Stop button cancels mid-stream), with
  a duck-typed `ReadableStream` reader loop feeding the core decoders.
- **Three wire formats** are supported end to end:
  1. OpenAI-compatible SSE (all direct cloud/local providers)
  2. Ollama native NDJSON (provider id `ollama`)
  3. Self-hosted prism-api (`provider id `prism-api``, non-streaming
     `POST {server}/api/chat`)
- **Settings** persist to `localStorage` under `prism.studio.settings.v1`,
  so a reload keeps the configured provider.

> Note: browser CORS applies — requests go straight from the browser to
> the provider, so the provider endpoint must allow the studio's origin
> (a local CORS proxy or the self-hosted prism-api server works well for
> strict endpoints).

## 🏗️ Architecture

```
main.rs                            — Route enum (Routable derive), shared context provider
├── components/shell.rs            — ShellLayout: sidebar + <Outlet>, mobile backdrop
├── components/sidebar.rs          — project header, Home, Agents, Tools, Assets, Inspire, footer
│   ├── SidebarItem (reusable)
│   └── ToolButton  (reusable, purple glow on the active tool)
├── components/studio.rs           — `/` route (GenerationPanel + Workspace)
│   ├── GenerationPanel            — tabs, mode/model dropdowns, prompt composer, Generate
│   │   ├── DropdownMenu (reusable)
│   │   └── ToggleSwitch (reusable) — Auto Polish, Audio On/Off
│   └── Workspace                  — top nav bar, filters, search, empty/generating/results grid
├── components/chat_page.rs        — `/chat` route: ChatGPT-style UI (history rail, transcript,
│                                    code-block rendering, copy / regenerate, pill composer)
├── components/settings_page.rs    — `/settings` route: provider picker, fields, test connection
├── api.rs                         — transport boundary: fetch streaming → prism-core decoders
└── state.rs                       — StudioState context: generations, settings, conversations, drawer
icons.rs                           — inline SVG icon set (lucide/feather-style), one Icon component
```

### Shared state (`StudioState`, provided via `use_context_provider`)

| Signal | Purpose |
| --- | --- |
| `generations` | Generated clips (GenerationPanel → Workspace) |
| `generating` | In-flight generation flag (2.4 s simulated render) |
| `settings` | Prism connection settings (persisted to localStorage) |
| `conversations` + `active_chat` | Chat history, newest first (persisted to localStorage); empty `active_chat` = home state |
| `streaming` | True while a chat response is streaming in |
| `abort` | Handle for the in-flight chat request (Stop button) |
| `sidebar_open` | Mobile sidebar drawer |

Per-page signals (active tool/tab, prompt, toggles, quantity 1–8,
workspace filters) live in their own components with `use_signal`.

## 🎨 Design tokens

Defined as Tailwind v4 `@theme` tokens in `src/tailwind.css`:

| Token | Value | Used for |
| --- | --- | --- |
| `--color-app` | `#0D0D0D` | App background |
| `--color-panel` | `#161616` | Panels/cards |
| `--color-input` | `#1E1E1E` | Inputs/boxes |
| `--color-edge` | `#333333` | Thin borders |
| `--color-sub` | `#A3A3A3` | Secondary text |
| `--color-accent` | `#B026FF` | Neon purple accents |
| `--color-accent1/2` | `#9D50BB` → `#6E48AA` | Gradient buttons/borders |

Typography: Inter (Google Fonts, system-sans fallback). 10–14 px UI text,
rounded-xl shapes, pill toggles, glow shadows on active states.

## 🚀 Running

This crate is a **member of the Prism monorepo workspace** (see
`../Cargo.toml`). Because it is web-only — its `web-sys` dependencies
exist solely for the wasm32 target — it is excluded from
`default-members`, so plain root-level `cargo check`/`cargo build`
commands skip it. Check/build it explicitly:

```sh
cargo check -p video-studio --target wasm32-unknown-unknown   # from anywhere in the monorepo
```

Prerequisites: Rust with the `wasm32-unknown-unknown` target, [Trunk],
Node.js 20+.

```sh
# 1. Install the wasm target (once)
rustup target add wasm32-unknown-unknown

# 2. Install Tailwind CLI (once)
npm install --registry=https://registry.npmmirror.com

# 3. Build CSS + serve with hot reload (Tailwind regenerates via a Trunk hook)
trunk serve          # → http://localhost:8787

# Production build
trunk build --release
```

Rebuild the CSS on its own: `npm run css` (or `scripts/build-css.sh`).
The generated bundle lives at `public/tailwind.css` and is copied into `dist/`.

Verify the Rust side without a browser:
`cargo check --target wasm32-unknown-unknown`

## 📱 Responsiveness

- **≥ lg (1024 px):** classic three-column dashboard — 250 px sidebar,
  380–400 px generation panel, fluid workspace.
- **< lg:** the sidebar becomes an overlay drawer (hamburger button in the
  panel header), the panel stacks above the workspace, filter buttons
  collapse and the page scrolls naturally. Chat and Settings pages are
  single-column at every width.

[Trunk]: https://trunkrs.dev
