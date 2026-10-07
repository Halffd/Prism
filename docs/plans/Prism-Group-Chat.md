---
plan name: Prism-Group-Chat
plan description: Multi-character group chat feature
plan status: active
---

## Idea
Design and implement group chat / multi-character chat feature for the Prism Chrome Extension (TypeScript/React). This allows multiple CharacterCards to participate in a single chat session.

**Modes supported:**
1. Round-robin -- characters take turns responding in sequence
2. Reactive -- all active characters respond to every user message  
3. Selective / Addressed -- user tags @CharacterName to direct responses

**LLM Orchestration (Hybrid):**
- Round-robin: Single LLM call with the next character's card as system prompt (inject previous multi-character messages for context)
- Reactive: Sequential LLM calls per character, each with their own card as system prompt
- Selective: Like reactive but only for tagged characters

**Core changes needed across 10 files:**
1. shared-types: Add `characterId` to Message, `characterIds` + `groupChatConfig` to ChatMeta, new GroupChatConfig type
2. characterSlice: Add `activeCharacterIds: string[]` alongside existing `activeCharacterId`
3. context-manager: Extend `assembleContext` to accept `characters?: CharacterCard[]`, build multi-character prompt
4. api-client: Add `sendGroupMessage` method for multi-character orchestration
5. ChatPage.tsx: Multi-character rendering, group send flow with mode branching
6. ChatInputBar.tsx: Multi-character pills + mode selector + @mention autocomplete
7. ChatMessageEnhanced.tsx: Character name/avatar attribution per message
8. CharacterSelector.tsx: Multi-select mode toggle
9. shared-db db.ts: DBChatSession gains characterIds + groupChatMode fields, schema v3
10. dexie-db.ts: Schema version bump

**Implementation order:**
Phase 1: Types + Redux (shared-types, characterSlice, new groupChatSlice)
Phase 2: Context assembly (context-manager multi-character prompt building)
Phase 3: API orchestration (api-client sendGroupMessage with hybrid strategy)
Phase 4: DB schema (shared-db migration to v3)
Phase 5: UI components (CharacterSelector multi-select, ChatInputBar pills + mode + @mentions, ChatMessageEnhanced attribution)
Phase 6: ChatPage integration (wire everything together, send flow branching by mode)

## Implementation
- Phase 1 - Types & Redux: Add characterId to Message, characterIds + groupChatConfig to ChatMeta, create GroupChatConfig type (mode, turnOrder, speakingCharacterId). Add activeCharacterIds to characterSlice. Create new groupChatSlice with mode state, turn order tracking, active speaker.
- Phase 2 - Context Assembly: Extend assembleContext to accept characters?: CharacterCard[]. Implement buildMultiCharacterPrompt that formats all character cards with [Character: Name] blocks. Support round-robin (single character prompt), reactive (individual character prompts), selective (tagged character prompts).
- Phase 3 - API Orchestration: Add sendGroupMessage to UnifiedAIClient. Round-robin: single LLM call with next character's prompt + full multi-char message history. Reactive: Promise.all or sequential calls per character, each with their own prompt. Selective: filter to only tagged characters, then reactive pattern.
- Phase 4 - DB Schema: Bump DB_VERSION to 3. Add characterIds: string[] and groupChatMode to DBChatSession. Write migration from v2 to v3 (existing sessions get characterIds: [meta.characterId] and groupChatMode: null).
- Phase 5 - UI Components: Add multi-select toggle to CharacterSelector (checkboxes instead of radio). Update ChatInputBar to show multiple character pills, mode selector (round-robin/reactive/selective), @mention autocomplete for selective mode. Update ChatMessageEnhanced to show character name + avatar for assistant messages with characterId.
- Phase 6 - ChatPage Integration: Wire sendMessage to branch by groupChatMode. Round-robin: determine next speaker from turn order, single call. Reactive: call sendGroupMessage for all active chars. Selective: parse @mentions from input, call for tagged chars only. Render messages with character attribution. Update session save to persist group config.

## Required Specs
<!-- SPECS_START -->
- Prism-Extension-TypeScript
- Prism-AI-Consolidation
- Prism-Data-Migration
<!-- SPECS_END -->