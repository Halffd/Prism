import Dexie, { Table } from 'dexie';
import type { AIConfig, ExtensionSettings, PromptShortcut } from '@prism/shared-types';
import type { DBChatSession, Message } from './db';

export interface ExtensionSetting {
  id?: string;
  key: string;
  value: any;
  createdAt: number;
  updatedAt: number;
}

export interface SiteFilter {
  id?: string;
  urlPattern: string;
  type: 'exclude' | 'whitelist';
  createdAt: number;
}

export interface ImageGenerationConfig {
  id?: string;
  apiKey: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

class PrismDexie extends Dexie {
  // Declare tables
  settings!: Table<ExtensionSetting>;
  siteFilters!: Table<SiteFilter>;
  imageGenConfigs!: Table<ImageGenerationConfig>;
  chatSessions!: Table<DBChatSession>;
  chatHistory!: Table<Message>;
  promptShortcuts!: Table<PromptShortcut>;

  constructor() {
    super('PrismDB');
    this.version(1).stores({
      settings: '++id, key, createdAt, updatedAt',
      siteFilters: '++id, urlPattern, type, createdAt',
      imageGenConfigs: '++id, apiKey, createdAt, updatedAt',
      chatSessions: 'id, createdAt, updatedAt',
      chatHistory: 'id, sessionId, timestamp',
      promptShortcuts: 'id, category, createdAt'
    });
  }
}

export const db = new PrismDexie();

// Settings functions
export async function saveSetting(key: string, value: any): Promise<void> {
  const existing = await db.settings.where('key').equals(key).first();
  
  if (existing) {
    await db.settings.update(existing.id!, {
      value,
      updatedAt: Date.now()
    });
  } else {
    await db.settings.add({
      key,
      value,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
}

export async function getSetting<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
  const setting = await db.settings.where('key').equals(key).first();
  if (setting) {
    return setting.value as T;
  }
  return defaultValue;
}

export async function getAllSettings(): Promise<Record<string, any>> {
  const settings = await db.settings.toArray();
  const result: Record<string, any> = {};
  
  settings.forEach(setting => {
    result[setting.key] = setting.value;
  });
  
  return result;
}

// Site filters functions
export async function addSiteFilter(urlPattern: string, type: 'exclude' | 'whitelist'): Promise<void> {
  await db.siteFilters.add({
    urlPattern,
    type,
    createdAt: Date.now()
  });
}

export async function getSiteFilters(type?: 'exclude' | 'whitelist'): Promise<SiteFilter[]> {
  let query = db.siteFilters;
  
  if (type) {
    query = query.where('type').equals(type);
  }
  
  return await query.toArray();
}

export async function removeSiteFilter(id: number): Promise<void> {
  await db.siteFilters.delete(id);
}

// Image generation config functions
export async function saveImageGenConfig(apiKey: string, model: string): Promise<void> {
  const existing = await db.imageGenConfigs.orderBy('id').last();
  
  if (existing) {
    await db.imageGenConfigs.update(existing.id!, {
      apiKey,
      model,
      updatedAt: Date.now()
    });
  } else {
    await db.imageGenConfigs.add({
      apiKey,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
}

export async function getImageGenConfig(): Promise<ImageGenerationConfig | null> {
  const config = await db.imageGenConfigs.orderBy('id').last();
  return config || null;
}

// Export all functions for use in the extension
export * from './db';