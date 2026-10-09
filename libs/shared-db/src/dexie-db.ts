import Dexie, { Table } from 'dexie';
import type {
  PromptShortcut,
  CharacterCard,
  PersonaProfile,
  PromptPreset,
  WorldInfo,
  WorldInfoEntry,
  Message,
  CustomAgent,
  AgentMemory,
} from '@prism/shared-types';
import type { DBChatSession } from './db';

export interface ExtensionSetting {
  id?: string;
  key: string;
  value: any;
  createdAt: number;
  updatedAt: number;
}

export interface SiteFilter {
  id?: number;
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
  settings!: Table<ExtensionSetting>;
  siteFilters!: Table<SiteFilter>;
  imageGenConfigs!: Table<ImageGenerationConfig>;
  chatSessions!: Table<DBChatSession>;
  chatHistory!: Table<Message>;
  promptShortcuts!: Table<PromptShortcut>;
  characters!: Table<CharacterCard>;
  personas!: Table<PersonaProfile>;
  promptPresets!: Table<PromptPreset>;
  worldInfo!: Table<WorldInfo>;
  worldInfoEntries!: Table<WorldInfoEntry>;
  customAgents!: Table<CustomAgent>;
  agentMemories!: Table<AgentMemory>;

  constructor() {
    super('PrismDB');
    this.version(1).stores({
      settings: '++id, key, createdAt, updatedAt',
      siteFilters: '++id, urlPattern, type, createdAt',
      imageGenConfigs: '++id, apiKey, createdAt, updatedAt',
      chatSessions: 'id, createdAt, updatedAt',
      chatHistory: 'id, sessionId, timestamp',
      promptShortcuts: 'id, category, createdAt',
    });
    this.version(2).stores({
      settings: '++id, key, createdAt, updatedAt',
      siteFilters: '++id, urlPattern, type, createdAt',
      imageGenConfigs: '++id, apiKey, createdAt, updatedAt',
      chatSessions: 'id, createdAt, updatedAt',
      chatHistory: 'id, sessionId, timestamp',
      promptShortcuts: 'id, category, createdAt',
      characters: 'id, name, createdAt, updatedAt',
      personas: 'id, name, createdAt, updatedAt',
      promptPresets: 'id, name, createdAt, updatedAt',
      worldInfo: 'id, name, createdAt, updatedAt',
      worldInfoEntries: 'id, worldInfoId, insertionOrder, createdAt, updatedAt',
    });
    this.version(3)
      .stores({
        settings: '++id, key, createdAt, updatedAt',
        siteFilters: '++id, urlPattern, type, createdAt',
        imageGenConfigs: '++id, apiKey, createdAt, updatedAt',
        // Add characterIds and groupChatMode to chatSessions index
        chatSessions: 'id, createdAt, updatedAt, groupChatMode',
        chatHistory: 'id, sessionId, timestamp',
        promptShortcuts: 'id, category, createdAt',
        characters: 'id, name, createdAt, updatedAt',
        personas: 'id, name, createdAt, updatedAt',
        promptPresets: 'id, name, createdAt, updatedAt',
        worldInfo: 'id, name, createdAt, updatedAt',
        worldInfoEntries:
          'id, worldInfoId, insertionOrder, createdAt, updatedAt',
      })
      .upgrade((tx) => {
        // V2 -> V3 migration: Add group chat fields to existing sessions
        return tx
          .table('chatSessions')
          .toCollection()
          .modify((session) => {
            if (!session.characterIds) {
              session.characterIds = [];
            }
            // groupChatMode defaults to undefined (single character mode)
          });
      });
    this.version(4).stores({
      agentMemories: 'id, agentId, importance, createdAt, updatedAt',
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
      updatedAt: Date.now(),
    });
  } else {
    await db.settings.add({
      key,
      value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export async function getSetting<T = any>(
  key: string,
  defaultValue?: T,
): Promise<T | undefined> {
  const setting = await db.settings.where('key').equals(key).first();
  if (setting) {
    return setting.value as T;
  }
  return defaultValue;
}

export async function getAllSettings(): Promise<Record<string, any>> {
  const settings = await db.settings.toArray();
  const result: Record<string, any> = {};

  settings.forEach((setting) => {
    result[setting.key] = setting.value;
  });

  return result;
}

// Site filters functions
export async function addSiteFilter(
  urlPattern: string,
  type: 'exclude' | 'whitelist',
): Promise<void> {
  await db.siteFilters.add({
    urlPattern,
    type,
    createdAt: Date.now(),
  });
}

export async function getSiteFilters(
  type?: 'exclude' | 'whitelist',
): Promise<SiteFilter[]> {
  if (type) {
    return await db.siteFilters.where('type').equals(type).toArray();
  }
  return await db.siteFilters.toArray();
}

export async function removeSiteFilter(id: number): Promise<void> {
  await db.siteFilters.delete(id);
}

// Image generation config functions
export async function saveImageGenConfig(
  apiKey: string,
  model: string,
): Promise<void> {
  const existing = await db.imageGenConfigs.orderBy('id').last();

  if (existing) {
    await db.imageGenConfigs.update(existing.id!, {
      apiKey,
      model,
      updatedAt: Date.now(),
    });
  } else {
    await db.imageGenConfigs.add({
      apiKey,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export async function getImageGenConfig(): Promise<ImageGenerationConfig | null> {
  const config = await db.imageGenConfigs.orderBy('id').last();
  return config || null;
}

// ─── Character Card CRUD ────────────────────────────────────────────────────

export async function saveCharacter(card: CharacterCard): Promise<void> {
  await db.characters.put(card);
}

export async function getCharacter(
  id: string,
): Promise<CharacterCard | undefined> {
  return db.characters.get(id);
}

export async function getAllCharacters(): Promise<CharacterCard[]> {
  return db.characters.orderBy('updatedAt').reverse().toArray();
}

export async function deleteCharacter(id: string): Promise<void> {
  await db.characters.delete(id);
  await db.worldInfoEntries.where('worldInfoId').equals(id).delete();
}

// ─── Persona Profile CRUD ───────────────────────────────────────────────────

export async function savePersona(persona: PersonaProfile): Promise<void> {
  await db.personas.put(persona);
}

export async function getPersona(
  id: string,
): Promise<PersonaProfile | undefined> {
  return db.personas.get(id);
}

export async function getAllPersonas(): Promise<PersonaProfile[]> {
  return db.personas.orderBy('updatedAt').reverse().toArray();
}

export async function deletePersona(id: string): Promise<void> {
  await db.personas.delete(id);
}

// ─── Prompt Preset CRUD ─────────────────────────────────────────────────────

export async function savePromptPreset(preset: PromptPreset): Promise<void> {
  await db.promptPresets.put(preset);
}

export async function getPromptPreset(
  id: string,
): Promise<PromptPreset | undefined> {
  return db.promptPresets.get(id);
}

export async function getAllPromptPresets(): Promise<PromptPreset[]> {
  return db.promptPresets.orderBy('updatedAt').reverse().toArray();
}

export async function deletePromptPreset(id: string): Promise<void> {
  await db.promptPresets.delete(id);
}

// ─── World Info CRUD ────────────────────────────────────────────────────────

export async function saveWorldInfo(wi: WorldInfo): Promise<void> {
  await db.worldInfo.put(wi);
}

export async function getWorldInfo(id: string): Promise<WorldInfo | undefined> {
  return db.worldInfo.get(id);
}

export async function getAllWorldInfo(): Promise<WorldInfo[]> {
  return db.worldInfo.orderBy('updatedAt').reverse().toArray();
}

export async function deleteWorldInfo(id: string): Promise<void> {
  await db.worldInfo.delete(id);
  await db.worldInfoEntries.where('worldInfoId').equals(id).delete();
}

// ─── World Info Entry CRUD ──────────────────────────────────────────────────

export async function saveWorldInfoEntry(entry: WorldInfoEntry): Promise<void> {
  await db.worldInfoEntries.put(entry);
}

export async function getWorldInfoEntries(
  worldInfoId: string,
): Promise<WorldInfoEntry[]> {
  return db.worldInfoEntries
    .where('worldInfoId')
    .equals(worldInfoId)
    .sortBy('insertionOrder');
}

export async function deleteWorldInfoEntry(id: string): Promise<void> {
  await db.worldInfoEntries.delete(id);
}

// ─── Custom Agent CRUD ──────────────────────────────────────────────────────

export async function saveCustomAgent(agent: CustomAgent): Promise<void> {
  await db.customAgents.put(agent);
}

export async function getCustomAgent(
  id: string,
): Promise<CustomAgent | undefined> {
  return db.customAgents.get(id);
}

export async function getAllCustomAgents(): Promise<CustomAgent[]> {
  return db.customAgents.orderBy('updatedAt').reverse().toArray();
}

export async function deleteCustomAgent(id: string): Promise<void> {
  await db.customAgents.delete(id);
}

// Agent memory functions (persistent per-agent memories)

export async function saveAgentMemory(memory: AgentMemory): Promise<void> {
  await db.agentMemories.put(memory);
}

export async function getAgentMemories(
  agentId: string,
): Promise<AgentMemory[]> {
  const all = await db.agentMemories.where('agentId').equals(agentId).toArray();
  // Rank: importance desc, then recency desc
  return all.sort((a, b) => {
    const imp = (b.importance ?? 0.5) - (a.importance ?? 0.5);
    if (imp !== 0) return imp;
    return b.updatedAt - a.updatedAt;
  });
}

export async function getAllAgentMemories(): Promise<AgentMemory[]> {
  return db.agentMemories.toArray();
}

export async function deleteAgentMemory(id: string): Promise<void> {
  await db.agentMemories.delete(id);
}

export async function deleteAgentMemoriesForAgent(
  agentId: string,
): Promise<void> {
  await db.agentMemories.where('agentId').equals(agentId).delete();
}
// Export all functions for use in the extension
export * from './db';
