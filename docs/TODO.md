# Prism TODO

Tracking queue state for all apps. Update after each landed feature.

## Extension (apps/extension)

| Feature                                                   | Status  | Notes                                                                          |
| --------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| Snippets / prompt shortcuts CRUD                          | done    | Popup + Settings, IndexedDB persistence, multiple keyboard bindings + combos   |
| Prompt presets (ordered entries)                          | done    | PromptPresetManager, rehydrates from DB on mount                               |
| Status bar metrics (latency, tok/s, context)              | partial | Metrics captured in api-client; per-message `metrics` field; footer UI pending |
| Thinking mode toggle                                      | planned | See docs/plans/Prism-Roadmap.md Phase 3                                        |
| Auto model selection                                      | planned | Roadmap Phase 3                                                                |
| Web/deep search, council, multi-send, debate toggles      | done    | ChatPage footer + panels                                                       |
| Agent builder + runner                                    | done    | AgentBuilder + AgentRunnerPanel                                                |
| Themes (dark/light/high-contrast/monokai/material/github) | planned | Roadmap Phase 5; dark-only today                                               |
| Material style icons                                      | partial | Shared Icon component in libs/ui-components                                    |
| Auth non-mandatory                                        | done    | Sign-in optional; API key fallback chain (supabase → firebase → prismApiKey)   |
| Max font scale 8.0                                        | done    | Popup + content script                                                         |
| Per-provider model cache                                  | done    | ModelRecentsEditor, free-form model input                                      |
| Permissions & tools                                       | partial | agentSlice.tools[].enabled; full allow/deny/ask model planned                  |
| Logging & monitoring                                      | planned | Roadmap Phase 8                                                                |
| RAG                                                       | planned | Roadmap Phase 9                                                                |

## TUI (apps/tui)

| Feature                                  | Status  | Notes                                              |
| ---------------------------------------- | ------- | -------------------------------------------------- |
| Chat + streaming                         | done    | Ink, shares ai-adapters                            |
| Status bar                               | partial | provider/model/adapterMode/online; metrics pending |
| Web/deep/council/multi-send/debate/agent | done    | Ctrl+W/D/V/M/B keybindings                         |
| SillyTavern characters                   | done    | group chat + character select                      |
| Themes                                   | partial | nocturnal-editorial only                           |
| Metrics in status bar                    | planned | Roadmap Phase 2                                    |

## Desktop (apps/desktop)

| Feature                            | Status  | Notes                                         |
| ---------------------------------- | ------- | --------------------------------------------- |
| Shell (Chat/Settings nav)          | done    | Vite + React, reuses extension Popup/Settings |
| Auth                               | done    | Optional, Supabase                            |
| Local LLM adapters                 | done    | Inherited from extension settings             |
| Hardware modes (cpu/gpu/amd/intel) | planned | Roadmap Phase 4                               |
| Metrics/ping probe                 | planned | Roadmap Phase 2                               |

## Mobile (apps/Prism, Expo)

| Feature                     | Status  | Notes                                         |
| --------------------------- | ------- | --------------------------------------------- |
| Chat screen                 | partial | Basic; needs persona/agent/preset integration |
| Settings screen             | partial | Provider URLs only                            |
| Themes                      | partial | nocturnal-editorial.ts exists                 |
| Apply extension feature set | planned | Roadmap Phase 10                              |

## Tests

| Suite                                                         | Status         |
| ------------------------------------------------------------- | -------------- |
| libs/redux-store (chatSlice, presetSlice)                     | done — 9 tests |
| libs/context-manager (assemble, tokens, world-info, v2 cards) | done — 8 tests |
| libs/shared-db                                                | planned        |
| libs/llm-service                                              | planned        |

## Known debt

- `libs/llm-service` is a 1165-line single file — split per provider
- Old Electron leftover at `apps/apps/desktop/desktop` — delete after confirming new desktop app is canonical
- `toolsToRequestTools` removed from libs/agent (unused); agent tool-calling is still prompt-parsing based, not native function calling
