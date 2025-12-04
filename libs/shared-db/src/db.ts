import { openDB, IDBPDatabase } from 'idb';
import type { Message } from '@prism/shared-types';

// Define types for our database
export interface DBChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface PromptShortcut {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  category?: string;
  shortcutKey?: string; // Optional keyboard shortcut
}


// Database schema version
const DB_NAME = 'PrismDB';
const DB_VERSION = 1;

// Define stores
const CHAT_HISTORY_STORE = 'chatHistory';
const SESSIONS_STORE = 'chatSessions';
const PROMPTS_STORE = 'prompts';
const CACHE_STORE = 'cache';

let dbInstance: IDBPDatabase | null = null;

export async function getDatabase(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Chat history store
      if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
        const chatHistoryStore = db.createObjectStore(CHAT_HISTORY_STORE, { keyPath: 'id' });
        chatHistoryStore.createIndex('sessionId', 'sessionId', { unique: false });
        chatHistoryStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Chat sessions store
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessionsStore.createIndex('createdAt', 'createdAt', { unique: false });
        sessionsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Prompts store
      if (!db.objectStoreNames.contains(PROMPTS_STORE)) {
        const promptsStore = db.createObjectStore(PROMPTS_STORE, { keyPath: 'id' });
        promptsStore.createIndex('category', 'category', { unique: false });
        promptsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Cache store
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        const cacheStore = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    }
  });

  return dbInstance;
}

// Chat history functions
export async function saveChatHistory(sessionId: string, messages: Message[]): Promise<void> {
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
      sessionId
    });
  }
  
  // Update or create session
  const sessionsStore = tx.objectStore(SESSIONS_STORE);
  const now = Date.now();
  const session: DBChatSession = {
    id: sessionId,
    title: messages[0]?.content?.substring(0, 50) || `Chat ${now}`,
    createdAt: (await sessionsStore.get(sessionId))?.createdAt || now,
    updatedAt: now
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
export async function savePromptShortcut(prompt: PromptShortcut): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PROMPTS_STORE, 'readwrite');
  const store = tx.objectStore(PROMPTS_STORE);

  if (!prompt.id) {
    prompt.id = `prompt_${Date.now()}`;
  }

  await store.put(prompt);
  await tx.done;
}

export async function getPromptShortcuts(category?: string): Promise<PromptShortcut[]> {
  const db = await getDatabase();
  const tx = db.transaction(PROMPTS_STORE, 'readonly');
  const store = tx.objectStore(PROMPTS_STORE);

  let prompts: PromptShortcut[];
  if (category) {
    const index = store.index('category');
    prompts = await index.getAll(IDBKeyRange.only(category));
  } else {
    prompts = await store.getAll();
  }

  return prompts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deletePromptShortcut(promptId: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(PROMPTS_STORE, 'readwrite');
  const store = tx.objectStore(PROMPTS_STORE);
  
  await store.delete(promptId);
  await tx.done;
}

// Caching functions
export async function setCache(key: string, value: any, ttl?: number): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  const store = tx.objectStore(CACHE_STORE);
  
  const expiresAt = ttl ? Date.now() + (ttl * 1000) : null;
  
  await store.put({
    key,
    value,
    expiresAt
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

// Clear all data
export async function clearAllData(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction([CHAT_HISTORY_STORE, SESSIONS_STORE, PROMPTS_STORE, CACHE_STORE], 'readwrite');
  
  await tx.objectStore(CHAT_HISTORY_STORE).clear();
  await tx.objectStore(SESSIONS_STORE).clear();
  await tx.objectStore(PROMPTS_STORE).clear();
  await tx.objectStore(CACHE_STORE).clear();
  
  await tx.done;
}