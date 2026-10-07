# Prism Roadmap — From Extension Features to Local AI Suite

Feature queue distilled from the last session (12 items with continuation requests) plus what shipped in earlier splits.

## Legend

- ✅ shipped (this branch)
- ⏳ in progress
- 🔲 planned

---

## Phase 0 — Blockers (now done) ✅

restore `tsc --noEmit` clean across `libs/*` + `apps/extension`, `apps/tui`, `apps/desktop`.

Root causes fixed:

- 5 libs writing flat into shared `dist/out-tsc`, clobbering each other's `index.d.ts`
- `@types/chrome@0.0.114` predates MV3 promise support — added `src/chrome-promises.d.ts` augmentation + `MV3 chrome.action` namespace
- `libs/redux-store/src/store.ts` had drifted from its slice counterparts (duplicate stale types, dead legacy action creators)
- `libs/agent` unused import; `libs/ai-factory` missing `debate` capability entry
- `agentSlice` was not exported from index for Redux consumers (useAppDispatch/useAppSelector)
- `AIConfig.systemPrompt` missing; `DBChatSession` vs `ChatSession` shape mismatch; `PromptShortcut` duplication
- eslint --fix pass had mangled several files (dangling previous edits); restored and re-applied targeted cleanup
- develop: extension `rootDir` lacked `dom.iterable`

---

## Phase 1 — Snippets / Prompts / Skills 🔲 (requested first)

### Goal

Let users create, edit, organize their own content:

- **Snippets**: one-shot text insertion (already shipped via prompt shortcuts in Popup + Settings)
- **Prompts**: slash-triggered templates with `{{variables}}` and structured entries (roles + positions) — partially exists via `PromptPresetManager` but load-from-DB is broken
- **Skills**: reusable bundles of system-prompt + tool permissions + trigger regex (new)

### Work items

- Unify storage: make `personasSlice/aiConfigSlice/promptsSlice` plural use the same `shared-db` paths
- Fix prompt rehydration in `ChatPage.tsx` (currently `setPresets` imported but unused → dropped; need to call `getAllPromptPresets()` on mount)
- Add `libs/skills` (new lib): `Skill = { id, name, description, trigger: { type: 'slash' | 'regex' | 'always' | 'hotkey', pattern?: string }, systemPrompt, entries: PromptEntry[], toolPermissions: Record<string, boolean> }`
- Tabs in ChatInputBar: slash palette already exists — extend to render /skills list
- `apps/extension/src/components/SkillManager.tsx` (mirrors PromptPresetManager)
- Integrate skill application into `assembleContext` in `libs/context-manager`

### Status

Snippet CRUD already shipped. Skills lib + UI: pending.

---

## Phase 2 — Status bar & telemetry 🔲

### Goal

Per-response telemetry in the extension chat footer + TUI status bar.

### Schema (adds to `libs/shared-types/src/lib/message.types.ts`)

```ts
export interface ResponseMetrics {
  tokensPerSecond?: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contextSize?: number;      // estimated tokens of last user turn + context
  finishReason?: string;
  model?: string;
  provider?: string;
}
export interface Message { /* existing */; metrics?: ResponseMetrics; }
```

### Work items

- Instrument `libs/llm-service`, `libs/ai-adapters` (request timing + usage)
- Extension ChatPage footer: `tokens/sec · latency · context size · model` line
- ChatInputBar: optional params row (temperature, maxTokens) — read current AIConfig, edit → persists
- TUI already has status bar — extend with metrics (chat-screen.tsx)
- Ping/latency probe to `localApiUrl` in desktop settings
- Aggregates: total session tokens + avg tok/s in header

---

## Phase 3 — Search & thinking modes 🔲 (partially shipped)

Already exists: web search 🔍, deep research 🔬, council ⚖️, multi-send 🔀, debate 🤝 toggles in ChatPage + TUI keybindings.

### To add

- **Thinking mode** toggle: when on, prepend model-specific reasoning (Anthropic `thinking: { type: 'enabled', budget_tokens }`; DeepSeek reasoner; OpenAI o1 via model swap; falls back to a "scratchpad" system prompt for other providers).
  - Add `thinkingMode?: { enabled: boolean; budgetTokens?: number }` to `AIConfig`
  - Extend `libs/llm/src/index.ts` `complete()` to accept per-call thinking config + populate `LLMResult.thinking?`
- **Auto model selection**: cheap static router in `libs/ai-adapters/src/adapter-router.ts` — given `{ inputLength, hasImages, capability, preferredSpeed: 'fast'|'balanced'|'quality' }` pick model from known list. Expose as toggle in adapter modes.

---

## Phase 4 — CPU/GPU hardware modes 🔲

Prism itself does not run inference (delegates to Ollama, llama.cpp, koboldcpp, sglang servers running on user hardware). It already exposes those as adapters.

### Work items

- **Hardware profile** field in AIConfig + Settings: `{ preferredCompute: 'cpu-only' | 'gpu-auto' | 'gpu-amd' | 'gpu-intel' | 'gpu-nvidia'; gpuLayersOverride?: number; contextSizeMb?: number }`
- Plumb to Ollama (`num_gpu`), llama.cpp (`n_gpu_layers`) via AdapterRouter→LLMService request body
- **Low-spec optimizations**: estimated model GB vs free RAM using `navigator.deviceMemory`; recommend quantization tier; disable image-to-text queueing when recordings available
- Settings section: "Hardware & Performance" with auto-detect report

---

## Phase 5 — Themes & UI polish 🔲 (partially shipped)

`apps/extension/src/styles.scss` is Material-3 dark-only, plus `apps/tui/src/theme/nocturnal-editorial.ts`.

### Work items

- Tokenize current dark palette into CSS vars (already partially), define `data-theme` system
- Themes: `dark` (current), `light`, `high-contrast`, `monokai`, `material`, `github`
- Theme persistence in ExtensionSettings + selector near the top of Settings.tsx
- TUI: match `nocturnal-editorial` with matching Ink tokens for each theme name
- Mobile (`apps/Prism`): reuse `nocturnal-editorial.ts` as the canon

---

## Phase 6 — Personalities / memories per agent 🔲

### Goal

Persona + memory system for custom agents (separate from character cards used in roleplay).

### Work items

- `libs/redux-store/src/agentSlice.ts` already holds `CustomAgent[]` with strategy/tools. Extend with:
  ```ts
  interface CustomAgent {
    /* existing */
    personality?: string; // freeform tone/style descriptor
    coreMemories?: AgentMemory[]; // persistent across sessions
  }
  interface AgentMemory {
    id: string;
    agentId: string;
    kind: 'fact' | 'preference' | 'note';
    content: string;
    createdAt: number;
    updatedAt: number;
    importance?: number; // 0–1, used for retrieval ranking
  }
  ```
- Persistence in `libs/shared-db` (`agentMemories` store)
- UI: extend `AgentBuilder.tsx` with a "Memories" tab
- Defaults: ship 20 personalities in `libs/redux-store/src/personaSlice.ts` initial state (assistant, coder, writer, researcher, mentor, professional, creative, sarcastic, concise, didactic, security-focused, devops, date-scientist, sales-coach, life-coach, therapist, comedian, historian, philosopher, custom-blank)
- Retrieval: simple keyword/recency/importance scoring in `libs/context-manager` (this becomes RAG's retrieval layer in Phase 8)

---

## Phase 7 — Permissions & tools 🔲 (partially shipped via agentSlice.tools[].enabled)

### Goal

Per-tool gates usable both by agents and inline chat:

- `enabled` already exists on `AgentToolDef` — that IS the current permission system; rename it's not needed
- Promote to a first-class permission model scoped by per-agent and global:
  - `permissions: Record<string, 'allow' | 'deny' | 'ask'>` stored on CustomAgent + global fallback in Settings
- Tool execution hooks in `libs/agent`:
  - Replace `BuiltinToolExecutor` stubs (web_search, fetch_url, read_file are stubs) with real implementations
  - `read_file` → extension needs to route to Node or to a configured Ollama-compat endpoint
  - `code_eval` → must be sandboxed; default to **deny**, ship as "asks"
- Chat UI: when a tool fires in agent mode, show a permission prompt (popup overlay) before executing

---

## Phase 8 — Configurable logging & monitoring 🔲

### Work items

- `libs/logging` (new lib): `Logger` interface, levels `debug|info|warn|error`, channels per feature (chat, search, agent, sync), sinks (`console`, `chrome.storage`, optional remote POST endpoint), ring buffer with % capped size, export via URL.createObjectURL JSONL
- Settings section to toggle level per channel, view in-page recent entries, download log
- Optional Supabase `error_logs` table sync (only when user configured)
- API server: replace ad-hoc `console.log` in `apps/api/src/app/middleware/logger.ts` with Pino, add `GET /metrics` (Prometheus-lite: request counts, p50/p95/p99 latency, up-since)

---

## Phase 9 — RAG architecture 🔲

### Work items

- `libs/rag` (new lib):
  - `chunkDocument(text, { maxTokens, overlap })` — heading-aware + sliding-window chunker
  - `embed(text, provider)` — Ollama (default, local), OpenAI, Google embedding providers
  - `VectorStore` interface + `InMemoryVectorStore`, `DexieVectorStore` (IndexedDB-backed), `PrismApiVectorStore` (server pgvector)
  - `retrieveRagContext(query, store, { k, threshold })`
- Extension: "Attach documents" UI in ChatInputBar + a ChatPage RAG tab showing active sources + retrieved chunks
- Wire into `assembleContext` in `libs/context-manager` — add a `ragContext` position slot at medium high priority between world-info and user input
- Settings: chunk size, retrieval k, similarity threshold, embedding provider, per-source toggle

---

## Phase 10 — Mobile (apps/Prism scope)

Out of scope for this queue's earlier requests but present in repo (`apps/Prism` Expo/RN app). Will be a follow-up: extend personaSlice + agentSlice to mobile, share agent+settings sync over Supabase.

---

## Open questions to revisit

1. **Skills vs presets vs agents**: there's overlap. Proposal: skills = curated prompt+tools bundles that activate agents; presets = pure text templates; agents = stateful loops with memory + tool permissions. Confirm before writing more code here.
2. **RAG vector store**: start with IndexedDB-only (offline, no server), or commit to pgvector via the existing `apps/api` from day one?
3. **Thinking mode for non-supporting providers**: emulate with `<thinking>` scratchpad + strip before displaying, or hide the toggle when the provider doesn't support it?
4. **Permissions UX**: model-level prompts only, or pair with Chrome's `chrome.permissions` for sensitive capability (e.g. file system access)?

---

## Implementation order (dependency-driven)

1. Snippets/skills persistence unification (low risk, missing rehydration today)
2. Status bar & telemetry (unlocks per-request perf work in later phases)
3. Thinking mode + adapter auto-select (LLMService plumbing)
4. Personalities & agent memories (extends Skills)
5. Permissions & tools
6. Hardware modes
7. Themes + mobile polish
8. Logging & monitoring
9. RAG

Commit cadence: one logical feature = one commit, authored via the `/home/all/bin/git-commit` convention.
