# Spec: Prism-Blazor-Architecture

Scope: repo

# Prism Blazor C# Migration Architecture

## Technology Mapping per Platform

| Platform | Current | Target | Rationale |
|----------|---------|--------|-----------|
| Web App | Next.js 15 + React | Blazor Web App (Interactive Server + WASM) | Native .NET web framework |
| API Server | Express + MongoDB | ASP.NET Core Minimal API + Supabase PG | Type-safe, DI, middleware |
| Desktop | Electron | Photino.Blazor or MAUI Desktop | Lightweight native shell |
| Mobile | Expo / React Native | .NET MAUI Blazor Hybrid | Shared Razor components |
| **Chrome Extension** | **React + TypeScript** | **React + TypeScript (KEEP)** | **Blazor WASM in extensions = 135MB insanity** |

## Critical Decisions

1. **Chrome Extension stays TypeScript/React** - Blazor WASM runtime (40MB) in a popup is architectural malpractice. Extension stays in its current stack with modular cleanup.
2. **Eliminate MongoDB** - Consolidate to Supabase PostgreSQL as single server DB
3. **Eliminate Firebase Auth** - Consolidate to Supabase Auth only (supports same providers)
4. **Merge duplicate IndexedDB layers** (idb + Dexie) into single BlazorIndexedDB or JS interop
5. **Merge duplicate LLM services** (AIService 800+ lines + UnifiedAIClient 500+ lines) into Strategy pattern: ILlmProvider interface + 15 provider classes + LlmClient facade
6. **Redux → Fluxor or Blazor state services** with DI scoping

## .NET Solution Structure

```
Prism.sln
├── src/
│   ├── Prism.Shared.Models/        # shared-types → C# POCOs, enums
│   ├── Prism.Data/                 # shared-db + supabase-client → IDbService, adapters, sync
│   ├── Prism.AI/                   # api-client + llm-service → LlmClient, ILlmProvider, providers
│   ├── Prism.State/                # redux-store → state services (Fluxor or custom)
│   ├── Prism.ImageGen/             # image-gen → HuggingFace service
│   ├── Prism.UI.Shared/            # ui-components → shared Razor components, Mermaid interop
│   ├── Prism.Context/              # context-manager → IContextProcessor
│   ├── Prism.Web/                  # apps/web → Blazor Web App
│   ├── Prism.Api/                  # apps/api → ASP.NET Core Minimal API
│   ├── Prism.Mobile/               # apps/Prism → MAUI Blazor Hybrid
│   └── Prism.Desktop/              # apps/desktop → Photino.Blazor
├── tests/
│   ├── Prism.Shared.Models.Tests/
│   ├── Prism.Data.Tests/
│   ├── Prism.AI.Tests/
│   ├── Prism.State.Tests/
│   ├── Prism.Web.Tests/
│   └── Prism.Api.Tests/
└── extension/                       # apps/extension → stays TypeScript/React (modular cleanup only)
```

## NuGet Dependencies

| Purpose | Package |
|---------|---------|
| Supabase client | `supabase-csharp` |
| Markdown rendering | `Markdig` |
| Code syntax highlighting | `ColorCode-Sharp` or `Highlight.js` JS interop |
| State management | `Fluxor` (optional, if Redux-like pattern desired) |
| HTTP resilience | `Polly` (retry, circuit breaker, rate limiting) |
| Auth | `Supabase.Auth` |
| IndexedDB | `BlazorIndexedDB` or JS interop |
| Image gen | Raw `HttpClient` to HuggingFace API |
| Mermaid diagrams | JS interop to `mermaid.min.js` |
| DI, logging, config | Built-in ASP.NET Core / .NET 8+ |

## Dependency Migration Order

```
shared-types ──→ Prism.Shared.Models (FIRST, zero inbound deps)
     ↓
shared-db + supabase-client ──→ Prism.Data
     ↓
api-client + llm-service ──→ Prism.AI
     ↓
redux-store ──→ Prism.State
     ↓
image-gen ──→ Prism.ImageGen
ui-components ──→ Prism.UI.Shared
context-manager ──→ Prism.Context
     ↓
apps/web ──→ Prism.Web
apps/api ──→ Prism.Api
apps/Prism ──→ Prism.Mobile
apps/desktop ──→ Prism.Desktop
```

Extension runs in parallel - TypeScript modular cleanup, no C# migration.