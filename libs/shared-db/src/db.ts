import { openDB, unwrap, IDBPDatabase } from 'idb';
import type {
  Message,
  CharacterCard,
  PersonaProfile,
  PromptPreset,
  PromptShortcut,
  WorldInfo,
  WorldInfoEntry,
  GroupChatMode,
  CustomAgent,
  SessionContextItem,
} from '@prism/shared-types';

// Define types for our database
export interface DBChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  /** False means unread. Missing means read, so old sessions are not flooded with unread badges. */
  read?: boolean;
  /** Archived sessions stay searchable but leave the default list. */
  archived?: boolean;
  /** Id of the session this one was forked from. */
  forkedFrom?: string;
  /** Index in the source session the fork branched at. */
  forkedAtMessage?: number;
  /** Extra context material attached to this session. */
  contextItems?: SessionContextItem[];
  characterIds?: string[]; // Multiple characters for group chat
  groupChatMode?: GroupChatMode; // 'round-robin' | 'reactive' | 'selective' | undefined (single)
}

// Database schema version.
//
// The Dexie client numbers its versions in steps of ten: its `version(5)`
// is the native version 50. Both clients open the same database, so they
// have to use the same numbering, or one of them always finds a version it
// cannot open.
const DB_NAME = 'PrismDB';
const DB_VERSION = 50;

const CHAT_HISTORY_STORE = 'chatHistory';
const SESSIONS_STORE = 'chatSessions';
const PROMPTS_STORE = 'prompts';
const PROMPT_SHORTCUTS_STORE = 'promptShortcuts';
const CACHE_STORE = 'cache';
const CHARACTERS_STORE = 'characters';
const PERSONAS_STORE = 'personas';
const PRESETS_STORE = 'promptPresets';
const WORLD_INFO_STORE = 'worldInfo';
const WORLD_INFO_ENTRIES_STORE = 'worldInfoEntries';
const CUSTOM_AGENTS_STORE = 'customAgents';
const SETTINGS_STORE = 'settings';
const SITE_FILTERS_STORE = 'siteFilters';
const IMAGE_GEN_CONFIGS_STORE = 'imageGenConfigs';
const AGENT_MEMORIES_STORE = 'agentMemories';
const SNIPPETS_STORE = 'snippets';
const HOTKEYS_STORE = 'hotkeys';

let dbInstance: IDBPDatabase | null = null;

export async function getDatabase(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, newVersion, transaction) {
      // Chat history store
      if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
        const chatHistoryStore = db.createObjectStore(CHAT_HISTORY_STORE, {
          keyPath: 'id',
        });
        chatHistoryStore.createIndex('sessionId', 'sessionId', {
          unique: false,
        });
        chatHistoryStore.createIndex('timestamp', 'timestamp', {
          unique: false,
        });
      }

      // Chat sessions store
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = db.createObjectStore(SESSIONS_STORE, {
          keyPath: 'id',
        });
        sessionsStore.createIndex('createdAt', 'createdAt', { unique: false });
        sessionsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        sessionsStore.createIndex('groupChatMode', 'groupChatMode', {
          unique: false,
        });
      }

      // Prompts store
      if (!db.objectStoreNames.contains(PROMPTS_STORE)) {
        const promptsStore = db.createObjectStore(PROMPTS_STORE, {
          keyPath: 'id',
        });
        promptsStore.createIndex('category', 'category', { unique: false });
        promptsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // The legacy name of the prompts store. The Dexie client knows this
      // table under this name, so both clients have to agree that it
      // exists.
      if (!db.objectStoreNames.contains(PROMPT_SHORTCUTS_STORE)) {
        const shortcutsStore = db.createObjectStore(PROMPT_SHORTCUTS_STORE, {
          keyPath: 'id',
        });
        shortcutsStore.createIndex('category', 'category', { unique: false });
        shortcutsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Cache store
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        const cacheStore = db.createObjectStore(CACHE_STORE, {
          keyPath: 'key',
        });
        cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(CHARACTERS_STORE)) {
        const charStore = db.createObjectStore(CHARACTERS_STORE, {
          keyPath: 'id',
        });
        charStore.createIndex('name', 'name', { unique: false });
        charStore.createIndex('createdAt', 'createdAt', { unique: false });
        charStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(PERSONAS_STORE)) {
        const personaStore = db.createObjectStore(PERSONAS_STORE, {
          keyPath: 'id',
        });
        personaStore.createIndex('name', 'name', { unique: false });
        personaStore.createIndex('createdAt', 'createdAt', { unique: false });
        personaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(PRESETS_STORE)) {
        const presetStore = db.createObjectStore(PRESETS_STORE, {
          keyPath: 'id',
        });
        presetStore.createIndex('name', 'name', { unique: false });
        presetStore.createIndex('createdAt', 'createdAt', { unique: false });
        presetStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(WORLD_INFO_STORE)) {
        const wiStore = db.createObjectStore(WORLD_INFO_STORE, {
          keyPath: 'id',
        });
        wiStore.createIndex('name', 'name', { unique: false });
        wiStore.createIndex('createdAt', 'createdAt', { unique: false });
        wiStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(WORLD_INFO_ENTRIES_STORE)) {
        const wieStore = db.createObjectStore(WORLD_INFO_ENTRIES_STORE, {
          keyPath: 'id',
        });
        wieStore.createIndex('worldInfoId', 'worldInfoId', { unique: false });
        wieStore.createIndex('insertionOrder', 'insertionOrder', {
          unique: false,
        });
        wieStore.createIndex('createdAt', 'createdAt', { unique: false });
        wieStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(CUSTOM_AGENTS_STORE)) {
        db.createObjectStore(CUSTOM_AGENTS_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        const settingsStore = db.createObjectStore(SETTINGS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        settingsStore.createIndex('key', 'key', { unique: false });
        settingsStore.createIndex('createdAt', 'createdAt', { unique: false });
        settingsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(SITE_FILTERS_STORE)) {
        const filtersStore = db.createObjectStore(SITE_FILTERS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        filtersStore.createIndex('urlPattern', 'urlPattern', { unique: false });
        filtersStore.createIndex('type', 'type', { unique: false });
        filtersStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(IMAGE_GEN_CONFIGS_STORE)) {
        const imageStore = db.createObjectStore(IMAGE_GEN_CONFIGS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        imageStore.createIndex('apiKey', 'apiKey', { unique: false });
        imageStore.createIndex('createdAt', 'createdAt', { unique: false });
        imageStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(AGENT_MEMORIES_STORE)) {
        const memoriesStore = db.createObjectStore(AGENT_MEMORIES_STORE, {
          keyPath: 'id',
        });
        memoriesStore.createIndex('agentId', 'agentId', { unique: false });
        memoriesStore.createIndex('importance', 'importance', { unique: false });
        memoriesStore.createIndex('createdAt', 'createdAt', { unique: false });
        memoriesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Blaze-style snippets and the page-level hotkey bindings.
      if (!db.objectStoreNames.contains(SNIPPETS_STORE)) {
        const snippetsStore = db.createObjectStore(SNIPPETS_STORE, {
          keyPath: 'id',
        });
        snippetsStore.createIndex('group', 'group', { unique: false });
        snippetsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(HOTKEYS_STORE)) {
        const hotkeysStore = db.createObjectStore(HOTKEYS_STORE, {
          keyPath: 'id',
        });
        hotkeysStore.createIndex('mode', 'mode', { unique: false });
      }

      // V2 -> V3 migration: Add group chat fields to existing sessions.
      // The Dexie client numbers its versions in steps of ten, so its
      // version 3 is the native version 30.
      //
      // The cursor is driven through the native request's callbacks rather
      // than `await`: awaiting between cursor steps lets the upgrade
      // transaction auto-commit, which strands the rest of the migration.
      // `idb` wraps the native request in a promise that has no `onsuccess`
      // hook, so the raw request is unwrapped first.
      if (oldVersion < 30 && transaction) {
        const sessionsStore = transaction.objectStore(SESSIONS_STORE);
        const request = unwrap(sessionsStore.openCursor());
        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest<
            IDBCursorWithValue
          >).result;
          if (!cursor) {
            return;
          }
          const session = cursor.value;
          // Add new fields with defaults for existing sessions
          if (!session.characterIds) {
            session.characterIds = [];
          }
          if (!session.groupChatMode) {
            session.groupChatMode = undefined; // single character mode by default
          }
          // The cursor may only advance once the update has landed,
          // otherwise the write is lost.
          const update = cursor.update(session);
          update.onsuccess = () => cursor.continue();
        };
      }

      // V4 -> V5 migration: bring the database up to the schema that both
      // clients agree on. The stores exist already in a database that was
      // created by the Dexie client, so their indexes have to be added
      // here rather than at creation.
      if (oldVersion < 50 && transaction) {
        const addIndex = (
          storeName: string,
          indexName: string,
          keyPath: string,
        ) => {
          if (!db.objectStoreNames.contains(storeName)) {
            return;
          }
          const store = transaction.objectStore(storeName);
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, keyPath, { unique: false });
          }
        };

        addIndex(SESSIONS_STORE, 'groupChatMode', 'groupChatMode');
        addIndex(WORLD_INFO_ENTRIES_STORE, 'createdAt', 'createdAt');
        addIndex(WORLD_INFO_ENTRIES_STORE, 'updatedAt', 'updatedAt');
        addIndex(CHARACTERS_STORE, 'createdAt', 'createdAt');
        addIndex(PERSONAS_STORE, 'createdAt', 'createdAt');
        addIndex(PRESETS_STORE, 'createdAt', 'createdAt');
        addIndex(WORLD_INFO_STORE, 'createdAt', 'createdAt');
      }
    },
    // Another client of the same database — the Dexie one — needs to open
    // a newer version. The connection has to be given up, or that client
    // waits for it forever.
    blocking() {
      dbInstance?.close();
      dbInstance = null;
    },
  });

  return dbInstance;
}

// Chat history functions
export async function saveChatHistory(
  sessionId: string,
  messages: Message[],
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction([CHAT_HISTORY_STORE, SESSIONS_STORE], 'readwrite');

  // Clear existing messages for this session
  const historyStore = tx.objectStore(CHAT_HISTORY_STORE);
  const index = historyStore.index('sessionId');
  const messagesToDelete = await index.getAllKeys(sessionId);

  for (const messageId of messagesToDelete) {
    await historyStore.delete(messageId);
  }

  // Save new messages
  for (const message of messages) {
    await historyStore.add({
      ...message,
      sessionId,
    });
  }

  // Update or create session
  const sessionsStore = tx.objectStore(SESSIONS_STORE);
  const now = Date.now();
  const existingSession = await sessionsStore.get(sessionId);
  const session: DBChatSession = {
    id: sessionId,
    // A session keeps the title it was given (a fork's title says where
    // it came from); only a session without one is named after its first
    // message.
    title:
      existingSession?.title ||
      messages[0]?.content?.substring(0, 50) ||
      `Chat ${now}`,
    createdAt: existingSession?.createdAt || now,
    updatedAt: now,
    // Session metadata belongs to the session, not to its transcript:
    // saving messages must not throw away tags, archive state or the
    // link to the session a fork came from.
    tags: existingSession?.tags,
    read: existingSession?.read,
    archived: existingSession?.archived,
    forkedFrom: existingSession?.forkedFrom,
    forkedAtMessage: existingSession?.forkedAtMessage,
    contextItems: existingSession?.contextItems,
    characterIds: existingSession?.characterIds || [],
    groupChatMode: existingSession?.groupChatMode,
  };

  await sessionsStore.put(session);

  await tx.done;
}

export async function loadChatHistory(sessionId: string): Promise<Message[]> {
  const db = await getDatabase();
  const tx = db.transaction(CHAT_HISTORY_STORE, 'readonly');
  const store = tx.objectStore(CHAT_HISTORY_STORE);
  const index = store.index('sessionId');
  const messages = await index.getAll(sessionId);

  // Sort messages by timestamp
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getChatSessions(): Promise<DBChatSession[]> {
  const { sessions } = await getChatSessionsDetailed();
  return sessions;
}

/**
 * Reads every session, repairing the rows written by older versions.
 *
 * A row without the newer fields is filled in with the defaults
 * (`tags: []`, `read: true`, `archived: false`) so the rest of the app
 * never has to deal with a missing field. A row that cannot be read at
 * all is reported as corrupt instead of breaking the whole list.
 */
export async function getChatSessionsDetailed(): Promise<{
  sessions: DBChatSession[];
  corrupt: Array<{ id: string; reason: string }>;
}> {
  const db = await getDatabase();
  const readTx = db.transaction(SESSIONS_STORE, 'readonly');
  const rows = await readTx.objectStore(SESSIONS_STORE).getAll();
  await readTx.done;

  const sessions: DBChatSession[] = [];
  const corrupt: Array<{ id: string; reason: string }> = [];
  const migrated: DBChatSession[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      corrupt.push({ id: '', reason: 'not an object' });
      continue;
    }
    const candidate = row as Partial<DBChatSession>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      corrupt.push({ id: String(candidate.id ?? ''), reason: 'missing id' });
      continue;
    }
    const needsMigration =
      !Array.isArray(candidate.tags) ||
      typeof candidate.read !== 'boolean' ||
      typeof candidate.archived !== 'boolean' ||
      typeof candidate.title !== 'string';
    const session: DBChatSession = {
      ...candidate,
      id: candidate.id,
      title: candidate.title ?? 'Untitled Chat',
      createdAt: candidate.createdAt ?? 0,
      updatedAt: candidate.updatedAt ?? 0,
      tags: candidate.tags ?? [],
      read: candidate.read ?? true,
      archived: candidate.archived ?? false,
      characterIds: candidate.characterIds ?? [],
    };
    sessions.push(session);
    if (needsMigration) {
      migrated.push(session);
    }
  }

  // The repair is written back, so the migration happens once instead of
  // on every read.
  if (migrated.length > 0) {
    const writeTx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = writeTx.objectStore(SESSIONS_STORE);
    for (const session of migrated) {
      await store.put(session);
    }
    await writeTx.done;
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions, corrupt };
}

/**
 * Merges metadata into an existing chat session.
 *
 * Only the fields present in `patch` are changed; every other field of
 * the stored session is kept. A session that does not exist yet is
 * created, so a fork can record its source link before its transcript
 * is written.
 */
export async function updateChatSessionMeta(
  sessionId: string,
  patch: Partial<
    Pick<
      DBChatSession,
      | 'title'
      | 'tags'
      | 'read'
      | 'archived'
      | 'forkedFrom'
      | 'forkedAtMessage'
      | 'contextItems'
      | 'updatedAt'
    >
  >,
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(SESSIONS_STORE, 'readwrite');
  const store = tx.objectStore(SESSIONS_STORE);
  const existing = await store.get(sessionId);
  const now = Date.now();
  const session: DBChatSession = {
    id: sessionId,
    title: existing?.title ?? `Chat ${now}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    tags: existing?.tags,
    read: existing?.read,
    archived: existing?.archived,
    forkedFrom: existing?.forkedFrom,
    forkedAtMessage: existing?.forkedAtMessage,
    contextItems: existing?.contextItems,
    characterIds: existing?.characterIds ?? [],
    groupChatMode: existing?.groupChatMode,
    ...patch,
  };
  await store.put(session);
  await tx.done;
}

/** One stored message together with the session it belongs to. */
export interface StoredChatMessage {
  sessionId: string;
  message: Message;
}

/**
 * Reads every stored message of every session.
 *
 * Global search needs all transcripts at once; reading them session by
 * session would make one IndexedDB transaction per conversation.
 */
export async function getAllChatHistory(): Promise<StoredChatMessage[]> {
  const db = await getDatabase();
  const tx = db.transaction(CHAT_HISTORY_STORE, 'readonly');
  const store = tx.objectStore(CHAT_HISTORY_STORE);
  const messages = await store.getAll();
  await tx.done;
  return messages
    .map((message) => {
      const stored = message as Message & { sessionId?: string };
      return {
        sessionId: stored.sessionId ?? '',
        message: stored,
      };
    })
    .filter((entry) => entry.sessionId.length > 0);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction([CHAT_HISTORY_STORE, SESSIONS_STORE], 'readwrite');

  // Delete session messages
  const historyStore = tx.objectStore(CHAT_HISTORY_STORE);
  const historyIndex = historyStore.index('sessionId');
  const messagesToDelete = await historyIndex.getAllKeys(sessionId);

  for (const messageId of messagesToDelete) {
    await historyStore.delete(messageId);
  }

  // Delete session
  const sessionsStore = tx.objectStore(SESSIONS_STORE);
  await sessionsStore.delete(sessionId);

  await tx.done;
}

// Prompt shortcuts functions
export async function savePromptShortcut(
  prompt: PromptShortcut,
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PROMPTS_STORE, 'readwrite');
  const store = tx.objectStore(PROMPTS_STORE);

  if (!prompt.id) {
    prompt.id = `prompt_${Date.now()}`;
  }

  await store.put(prompt);
  await tx.done;

  // Also sync to chrome.storage.local for content script access (if in extension context)
  // Only execute if chrome is defined (in browser extension environment)
  if (typeof globalThis !== 'undefined' && 'chrome' in globalThis) {
    const chromeGlobal = (globalThis as Record<string, unknown>).chrome as any;
    if (chromeGlobal && chromeGlobal.storage && chromeGlobal.storage.local) {
      try {
        const result = await chromeGlobal.storage.local.get([
          'promptShortcuts',
        ]);
        const promptShortcuts = result.promptShortcuts || [];
        const updatedPrompts = [
          ...promptShortcuts.filter((p: PromptShortcut) => p.id !== prompt.id),
          prompt,
        ];
        await chromeGlobal.storage.local.set({
          promptShortcuts: updatedPrompts,
        });
      } catch (error) {
        console.warn(
          'Could not sync prompt shortcut to chrome.storage.local:',
          error,
        );
      }
    }
  }
}

export async function getPromptShortcuts(
  category?: string,
): Promise<PromptShortcut[]> {
  let prompts: PromptShortcut[] = [];

  // First try to get from IndexedDB (primary storage)
  try {
    const db = await getDatabase();
    const tx = db.transaction(PROMPTS_STORE, 'readonly');
    const store = tx.objectStore(PROMPTS_STORE);

    if (category) {
      const index = store.index('category');
      prompts = await index.getAll(IDBKeyRange.only(category));
    } else {
      prompts = await store.getAll();
    }
  } catch (error) {
    console.warn('Could not get prompt shortcuts from IndexedDB:', error);
  }

  // Also try to get from chrome.storage.local (for content script access)
  // Only execute if chrome is defined (in browser extension environment)
  if (typeof globalThis !== 'undefined' && 'chrome' in globalThis) {
    const chromeGlobal = (globalThis as Record<string, unknown>).chrome as any;
    if (chromeGlobal && chromeGlobal.storage && chromeGlobal.storage.local) {
      try {
        const result = await chromeGlobal.storage.local.get([
          'promptShortcuts',
        ]);
        const chromePrompts = result.promptShortcuts || [];

        // Merge with IndexedDB results, preferring newer entries
        const allPromptsMap = new Map<string, PromptShortcut>();

        // Add IndexedDB prompts first
        prompts.forEach((prompt) => {
          allPromptsMap.set(prompt.id, prompt);
        });

        // Add chrome.storage prompts, potentially overriding older entries
        chromePrompts.forEach((prompt: PromptShortcut) => {
          const existing = allPromptsMap.get(prompt.id);
          if (
            !existing ||
            (prompt.createdAt &&
              existing.createdAt &&
              prompt.createdAt > existing.createdAt)
          ) {
            allPromptsMap.set(prompt.id, prompt);
          }
        });

        prompts = Array.from(allPromptsMap.values());
      } catch (error) {
        console.warn(
          'Could not get prompt shortcuts from chrome.storage.local:',
          error,
        );
      }
    }
  }

  return prompts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deletePromptShortcut(promptId: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PROMPTS_STORE, 'readwrite');
  const store = tx.objectStore(PROMPTS_STORE);

  await store.delete(promptId);
  await tx.done;

  // Also sync to chrome.storage.local for content script access (if in extension context)
  // Only execute if chrome is defined (in browser extension environment)
  if (typeof globalThis !== 'undefined' && 'chrome' in globalThis) {
    const chromeGlobal = (globalThis as Record<string, unknown>).chrome as any;
    if (chromeGlobal && chromeGlobal.storage && chromeGlobal.storage.local) {
      try {
        const result = await chromeGlobal.storage.local.get([
          'promptShortcuts',
        ]);
        const promptShortcuts = result.promptShortcuts || [];
        const updatedPrompts = promptShortcuts.filter(
          (p: PromptShortcut) => p.id !== promptId,
        );
        await chromeGlobal.storage.local.set({
          promptShortcuts: updatedPrompts,
        });
      } catch (error) {
        console.warn(
          'Could not sync prompt shortcut deletion to chrome.storage.local:',
          error,
        );
      }
    }
  }
}

// Character card functions
export async function saveCharacterCard(card: CharacterCard): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CHARACTERS_STORE, 'readwrite');
  await tx.objectStore(CHARACTERS_STORE).put(card);
  await tx.done;
}

export async function loadCharacterCard(
  id: string,
): Promise<CharacterCard | undefined> {
  const db = await getDatabase();
  return db
    .transaction(CHARACTERS_STORE, 'readonly')
    .objectStore(CHARACTERS_STORE)
    .get(id);
}

export async function loadAllCharacterCards(): Promise<CharacterCard[]> {
  const db = await getDatabase();
  const cards = await db
    .transaction(CHARACTERS_STORE, 'readonly')
    .objectStore(CHARACTERS_STORE)
    .getAll();
  return cards.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteCharacterCard(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CHARACTERS_STORE, 'readwrite');
  await tx.objectStore(CHARACTERS_STORE).delete(id);
  await tx.done;
}

// Persona profile functions
export async function savePersonaProfile(
  persona: PersonaProfile,
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PERSONAS_STORE, 'readwrite');
  await tx.objectStore(PERSONAS_STORE).put(persona);
  await tx.done;
}

export async function loadPersonaProfile(
  id: string,
): Promise<PersonaProfile | undefined> {
  const db = await getDatabase();
  return db
    .transaction(PERSONAS_STORE, 'readonly')
    .objectStore(PERSONAS_STORE)
    .get(id);
}

export async function loadAllPersonaProfiles(): Promise<PersonaProfile[]> {
  const db = await getDatabase();
  const personas = await db
    .transaction(PERSONAS_STORE, 'readonly')
    .objectStore(PERSONAS_STORE)
    .getAll();
  return personas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePersonaProfile(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PERSONAS_STORE, 'readwrite');
  await tx.objectStore(PERSONAS_STORE).delete(id);
  await tx.done;
}

// Prompt preset functions
export async function savePromptPresetDB(preset: PromptPreset): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PRESETS_STORE, 'readwrite');
  await tx.objectStore(PRESETS_STORE).put(preset);
  await tx.done;
}

export async function loadPromptPreset(
  id: string,
): Promise<PromptPreset | undefined> {
  const db = await getDatabase();
  return db
    .transaction(PRESETS_STORE, 'readonly')
    .objectStore(PRESETS_STORE)
    .get(id);
}

export async function loadAllPromptPresets(): Promise<PromptPreset[]> {
  const db = await getDatabase();
  const presets = await db
    .transaction(PRESETS_STORE, 'readonly')
    .objectStore(PRESETS_STORE)
    .getAll();
  return presets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePromptPresetDB(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PRESETS_STORE, 'readwrite');
  await tx.objectStore(PRESETS_STORE).delete(id);
  await tx.done;
}

// World info functions
export async function saveWorldInfoDB(wi: WorldInfo): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(WORLD_INFO_STORE, 'readwrite');
  await tx.objectStore(WORLD_INFO_STORE).put(wi);
  await tx.done;
}

export async function loadWorldInfo(
  id: string,
): Promise<WorldInfo | undefined> {
  const db = await getDatabase();
  return db
    .transaction(WORLD_INFO_STORE, 'readonly')
    .objectStore(WORLD_INFO_STORE)
    .get(id);
}

export async function loadAllWorldInfo(): Promise<WorldInfo[]> {
  const db = await getDatabase();
  const all = await db
    .transaction(WORLD_INFO_STORE, 'readonly')
    .objectStore(WORLD_INFO_STORE)
    .getAll();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteWorldInfoDB(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(
    [WORLD_INFO_STORE, WORLD_INFO_ENTRIES_STORE],
    'readwrite',
  );
  await tx.objectStore(WORLD_INFO_STORE).delete(id);
  const index = tx.objectStore(WORLD_INFO_ENTRIES_STORE).index('worldInfoId');
  const keys = await index.getAllKeys(id);
  for (const key of keys) {
    await tx.objectStore(WORLD_INFO_ENTRIES_STORE).delete(key);
  }
  await tx.done;
}

// World info entry functions
export async function saveWorldInfoEntryDB(
  entry: WorldInfoEntry,
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(WORLD_INFO_ENTRIES_STORE, 'readwrite');
  await tx.objectStore(WORLD_INFO_ENTRIES_STORE).put(entry);
  await tx.done;
}

export async function loadWorldInfoEntries(
  worldInfoId: string,
): Promise<WorldInfoEntry[]> {
  const db = await getDatabase();
  const tx = db.transaction(WORLD_INFO_ENTRIES_STORE, 'readonly');
  const index = tx.objectStore(WORLD_INFO_ENTRIES_STORE).index('worldInfoId');
  const entries = await index.getAll(worldInfoId);
  return entries.sort((a, b) => a.insertionOrder - b.insertionOrder);
}

export async function deleteWorldInfoEntryDB(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(WORLD_INFO_ENTRIES_STORE, 'readwrite');
  await tx.objectStore(WORLD_INFO_ENTRIES_STORE).delete(id);
  await tx.done;
}

// Caching functions
export async function setCache(
  key: string,
  value: any,
  ttl?: number,
): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  const store = tx.objectStore(CACHE_STORE);

  const expiresAt = ttl ? Date.now() + ttl * 1000 : null;

  await store.put({
    key,
    value,
    expiresAt,
  });

  await tx.done;
}

export async function getCache<T = any>(key: string): Promise<T | null> {
  const db = await getDatabase();
  const tx = db.transaction(CACHE_STORE, 'readonly');
  const store = tx.objectStore(CACHE_STORE);
  const cached = await store.get(key);

  if (!cached) {
    return null;
  }

  // Check if expired
  if (cached.expiresAt && Date.now() > cached.expiresAt) {
    // Delete expired entry
    const writeTx = db.transaction(CACHE_STORE, 'readwrite');
    await writeTx.objectStore(CACHE_STORE).delete(key);
    await writeTx.done;
    return null;
  }

  return cached.value as T;
}

export async function clearExpiredCache(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  const store = tx.objectStore(CACHE_STORE);
  const index = store.index('expiresAt');

  // Get all expired entries
  const expired = await index.getAll(IDBKeyRange.upperBound(Date.now()));

  for (const item of expired) {
    await store.delete(item.key);
  }

  await tx.done;
}

// Custom agent functions
export async function saveCustomAgentDB(agent: CustomAgent): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CUSTOM_AGENTS_STORE, 'readwrite');
  await tx.objectStore(CUSTOM_AGENTS_STORE).put(agent);
  await tx.done;
}

export async function loadCustomAgent(
  id: string,
): Promise<CustomAgent | undefined> {
  const db = await getDatabase();
  return db
    .transaction(CUSTOM_AGENTS_STORE, 'readonly')
    .objectStore(CUSTOM_AGENTS_STORE)
    .get(id);
}

export async function loadAllCustomAgents(): Promise<CustomAgent[]> {
  const db = await getDatabase();
  const all = await db
    .transaction(CUSTOM_AGENTS_STORE, 'readonly')
    .objectStore(CUSTOM_AGENTS_STORE)
    .getAll();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteCustomAgentDB(id: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CUSTOM_AGENTS_STORE, 'readwrite');
  await tx.objectStore(CUSTOM_AGENTS_STORE).delete(id);
  await tx.done;
}

// Clear all data
export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(
    [
      CHAT_HISTORY_STORE,
      SESSIONS_STORE,
      PROMPTS_STORE,
      CACHE_STORE,
      CHARACTERS_STORE,
      PERSONAS_STORE,
      PRESETS_STORE,
      WORLD_INFO_STORE,
      WORLD_INFO_ENTRIES_STORE,
      CUSTOM_AGENTS_STORE,
      SNIPPETS_STORE,
      HOTKEYS_STORE,
    ],
    'readwrite',
  );

  await tx.objectStore(CHAT_HISTORY_STORE).clear();
  await tx.objectStore(SESSIONS_STORE).clear();
  await tx.objectStore(PROMPTS_STORE).clear();
  await tx.objectStore(CACHE_STORE).clear();
  await tx.objectStore(CHARACTERS_STORE).clear();
  await tx.objectStore(PERSONAS_STORE).clear();
  await tx.objectStore(PRESETS_STORE).clear();
  await tx.objectStore(WORLD_INFO_STORE).clear();
  await tx.objectStore(WORLD_INFO_ENTRIES_STORE).clear();
  await tx.objectStore(CUSTOM_AGENTS_STORE).clear();
  await tx.objectStore(SNIPPETS_STORE).clear();
  await tx.objectStore(HOTKEYS_STORE).clear();

  await tx.done;
}
