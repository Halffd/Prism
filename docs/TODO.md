# Prism TODO

Tracking queue state for all apps. Update after each landed feature.

## Extension (apps/extension)

| Feature                                                   | Status  | Notes                                                                                                                |
| --------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| Snippets / prompt shortcuts CRUD                          | done    | Popup + Settings, IndexedDB persistence, multiple keyboard bindings + combos                                         |
| Prompt presets (ordered entries)                          | done    | PromptPresetManager, rehydrates from DB on mount                                                                     |
| Status bar metrics (latency, tok/s, context)              | done    | api-client captures metrics; strips in ChatPage + Popup; TUI status bar shows tok/s · latency · ctx · session tokens |
| Thinking mode toggle                                      | done    | Claude native budget_tokens; scratchpad fallback for other providers; toggle in ChatPage footer |
| Auto model selection                                      | done    | selectAutoModel heuristic (modelCache -> known list, tier by input size/capability); Auto button in header |
| Web/deep search, council, multi-send, debate toggles      | done    | ChatPage footer + panels                                                                                             |
| Agent builder + runner                                    | done    | AgentBuilder + AgentRunnerPanel; web_search + fetch_url tools now real                                               |
| Themes (dark/light/high-contrast/monokai/material/github) | planned | Roadmap Phase 5; dark-only today                                                                                     |
| Material style icons                                      | done    | Shared Icon component applied to ChatPage, Popup, HeaderSection, StandaloneChatPage                                  |
| Auth non-mandatory                                        | done    | Sign-in optional; API key fallback chain (supabase → firebase → prismApiKey)                                         |
| Max font scale 8.0                                        | done    | Popup + content script                                                                                               |
| Per-provider model cache                                  | done    | ModelRecentsEditor, free-form model input                                                                            |
| Permissions & tools                                       | partial | agentSlice.tools[].enabled; read_file denied with guidance; allow/deny/ask model planned                             |
| Logging & monitoring                                      | planned | Roadmap Phase 8                                                                                                      |
| RAG                                                       | planned | Roadmap Phase 9                                                                                                      |

## TUI (apps/tui)

| Feature                                  | Status  | Notes                                                                      |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------- |
| Chat + streaming                         | done    | Ink, shares ai-adapters                                                    |
| Status bar                               | done    | provider/model/adapterMode/online + tok/s · latency · ctx · session tokens |
| Web/deep/council/multi-send/debate/agent | done    | Ctrl+W/D/V/M/B keybindings                                                 |
| SillyTavern characters                   | done    | group chat + character select                                              |
| Themes                                   | partial | nocturnal-editorial only                                                   |

## Desktop (apps/desktop)

| Feature                            | Status  | Notes                                         |
| ---------------------------------- | ------- | --------------------------------------------- |
| Shell (Chat/Settings nav)          | done    | Vite + React, reuses extension Popup/Settings |
| Auth                               | done    | Optional, Supabase                            |
| Local LLM adapters                 | done    | Inherited from extension settings             |
| Hardware modes (cpu/gpu/amd/intel) | planned | Roadmap Phase 4                               |
| Metrics/ping probe                 | planned | Roadmap Phase 2                               |

## Mobile (apps/Prism, Expo)

| Feature                     | Status  | Notes                                                                          |
| --------------------------- | ------- | ------------------------------------------------------------------------------ |
| Chat screen                 | partial | Basic; metrics strip added; persona/agent/preset integration pending           |
| Settings screen             | partial | Provider URLs only                                                             |
| Themes                      | partial | nocturnal-editorial.ts exists                                                  |
| Apply extension feature set | partial | metrics via shared api-client + UI strip done; rest planned (Roadmap Phase 10) |

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
- Agent tool-calling is prompt-parsing based (ReAct), not native function calling — native `tools` param on LLMRequest is roadmap Phase 7 follow-up
- TUI/mobile do not yet surface prompt presets / skills / personalities UI — shared libs ready, screens pending
