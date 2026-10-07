import { openDB, IDBPDatabase } from 'idb';
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
} from '@prism/shared-types';

// Define types for our database
export interface DBChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  characterIds?: string[]; // Multiple characters for group chat
  groupChatMode?: GroupChatMode; // 'round-robin' | 'reactive' | 'selective' | undefined (single)
}

// Database schema version
const DB_NAME = 'PrismDB';
const DB_VERSION = 4;

const CHAT_HISTORY_STORE = 'chatHistory';
const SESSIONS_STORE = 'chatSessions';
const PROMPTS_STORE = 'prompts';
const CACHE_STORE = 'cache';
const CHARACTERS_STORE = 'characters';
const PERSONAS_STORE = 'personas';
const PRESETS_STORE = 'promptPresets';
const WORLD_INFO_STORE = 'worldInfo';
const WORLD_INFO_ENTRIES_STORE = 'worldInfoEntries';
const CUSTOM_AGENTS_STORE = 'customAgents';

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
      }

      // Prompts store
      if (!db.objectStoreNames.contains(PROMPTS_STORE)) {
        const promptsStore = db.createObjectStore(PROMPTS_STORE, {
          keyPath: 'id',
        });
        promptsStore.createIndex('category', 'category', { unique: false });
        promptsStore.createIndex('createdAt', 'createdAt', { unique: false });
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
        charStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(PERSONAS_STORE)) {
        const personaStore = db.createObjectStore(PERSONAS_STORE, {
          keyPath: 'id',
        });
        personaStore.createIndex('name', 'name', { unique: false });
        personaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(PRESETS_STORE)) {
        const presetStore = db.createObjectStore(PRESETS_STORE, {
          keyPath: 'id',
        });
        presetStore.createIndex('name', 'name', { unique: false });
        presetStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(WORLD_INFO_STORE)) {
        const wiStore = db.createObjectStore(WORLD_INFO_STORE, {
          keyPath: 'id',
        });
        wiStore.createIndex('name', 'name', { unique: false });
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
      }

      // V2 -> V3 migration: Add group chat fields to existing sessions
      if (oldVersion < 3 && transaction) {
        const sessionsStore = transaction.objectStore(SESSIONS_STORE);
        let cursor = await (sessionsStore as any).openCursor();
        while (cursor) {
          const session = cursor.value;
          // Add new fields with defaults for existing sessions
          if (!session.characterIds) {
            session.characterIds = [];
          }
          if (!session.groupChatMode) {
            session.groupChatMode = undefined; // single character mode by default
          }
          await cursor.update(session);
          cursor = await cursor.continue();
        }
      }
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
    title: messages[0]?.content?.substring(0, 50) || `Chat ${now}`,
    createdAt: existingSession?.createdAt || now,
    updatedAt: now,
    tags: existingSession?.tags,
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
  const db = await getDatabase();
  const tx = db.transaction(SESSIONS_STORE, 'readonly');
  const store = tx.objectStore(SESSIONS_STORE);
  const sessions = await store.getAll();

  // Sort by most recent
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
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
    const chromeGlobal = globalThis.chrome as any;
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
    const chromeGlobal = globalThis.chrome as any;
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
    const chromeGlobal = globalThis.chrome as any;
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

  await tx.done;
}
