# Spec: Prism-Data-Migration

Scope: repo

# Prism Data & Auth Migration Strategy

## Database Consolidation

### Current State (4 overlapping layers)
1. **MongoDB** (server, Mongoose) - duplicate schemas in `mongo-schemas.ts` + `mongo-models.ts`
2. **IndexedDB via idb** (client) - `chatHistory`, `chatSessions`, `prompts`, `cache` stores
3. **IndexedDB via Dexie** (client) - overlapping stores for chat data
4. **Supabase PostgreSQL** (cloud) - 36 tables defined in `database.types.ts`

### Target State (2 layers)
1. **Supabase PostgreSQL** - single server-side source of truth
2. **IndexedDB** - offline cache only, single implementation via BlazorIndexedDB or JS interop

### Eliminated
- **MongoDB** - all data migrates to Supabase PG
- **Dexie** - merges into single IndexedDB layer

### Consolidated IndexedDB Schema
- `chatHistory` (messages, keyed by sessionId)
- `chatSessions` (session metadata)
- `promptShortcuts` (user prompt templates)
- `settings` (user preferences, AI config)
- `syncQueue` (offline write queue)

### C# Adapter Pattern
- `IDbService` interface
- `SupabaseDbAdapter` (online)
- `IndexedDbAdapter` (offline)
- `SyncService` (auto-switches + offline queue)

## Auth Consolidation

### Eliminate Firebase Auth → Supabase Auth only
- Export Firebase users → Import into Supabase Auth via Admin API
- Drop `firebase-auth` lib, `firebase`, `firebase-admin` packages

## Supabase Edge Functions → ASP.NET Core Endpoints
- `auth/index.ts` → Supabase Auth native
- `chat.ts` → `POST /api/chat` with [Authorize] + SSE streaming
- `sync.ts` → `GET/POST/PUT/DELETE /api/sync/*` with [Authorize]