# Spec: Prism-Extension-TypeScript

Scope: repo

# Prism Extension Stays TypeScript

## Why NOT Blazor WASM in Chrome Extension

| Metric | React+TS | Blazor WASM | Ratio |
|--------|----------|-------------|-------|
| Runtime size | ~5MB (React) | ~40MB (.NET) | 8x |
| Total extension | ~10MB | ~135MB (popup+settings+iframes) | 13.5x |
| Cold start | <100ms | 2-5 seconds | 20-50x |
| Communication layers | JS → DOM | JS → postMessage → C# → JS Interop → DOM | 3 extra hops |
| Content script | Direct DOM access | IMPOSSIBLE (no WASM in content scripts) | N/A |

**Chrome Extensions run in constrained environments.** Popup lifecycle is seconds. Blazor WASM cold start kills UX.

## What Changes for the Extension

The extension stays TypeScript/React BUT gets modular cleanup:

### Current Monoliths to Decompose
| File | Lines | Decomposition |
|------|-------|---------------|
| `Popup.tsx` | ~57K | ChatLayout + MessageList + MessageInput + ProviderSelector + SessionManager + AuthPanel + SyncControls + VoiceInput + ImageGenPanel + ContextModeToggle |
| `Settings.tsx` | ~56K | SettingsLayout + AiConfigPanel + ImageModelsPanel + SiteFiltersPanel + PromptShortcutsPanel + DisplayModePanel + KeyboardBindingsPanel |
| `content.ts` | 1654 | content-extract + content-inject + content-keyboard + content-ui + content-shortcuts |
| `StandaloneChatPage.tsx` | 1213 | Reuse Popup decomposition with LocalStorageProvider |

### Communication with C# Backend
- Extension uses `Prism.Api` ASP.NET Core endpoints (same as web/mobile)
- `chrome.runtime.sendMessage` within extension
- No Blazor runtime needed - just standard HTTP calls to the C# API

### What Extension Gains from Migration
- Better API backend (ASP.NET Core > Express)
- Supabase Auth instead of dual Firebase+Supabase
- Cleaner, modular TypeScript codebase
- Same LLM providers via API (no client-side API keys needed if routed through server)