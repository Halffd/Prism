// Prism data sync: one envelope importable by every surface.
//
// Shapes map between:
// - extension (IndexedDB via shared-db): Message[] + DBChatSession + PromptShortcut + ExtensionSettings
// - Slint/CLI/TUI (prism-core JSON files): Conversation{role,content,thinking} + Settings
//
// Roles are identical strings ("user"|"assistant"|"system"). Timestamps are
// epoch ms in both. The only real mapping work is messages: extension
// Message has id/tokens/metrics; core StoredMessage has role/content/thinking.
// Both fields are carried: id/tokens/metrics when present, thinking when
// present, so neither side loses data on its own terms.

/** Role strings are identical across every Prism surface. */
export type SyncRole = 'user' | 'assistant' | 'system';

/** One transcript message in the sync envelope. */
export interface SyncMessage {
  role: SyncRole;
  content: string;
  /** Reasoning extracted from <thinking> tags (core surfaces store it here). */
  thinking?: string;
  /** Extension-side id, carried through so re-import keeps ids stable. */
  id?: string;
  timestamp?: number;
}

/** One conversation in the sync envelope. */
export interface SyncConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: SyncMessage[];
}

/** One prompt shortcut / preset in the sync envelope. */
export interface SyncPrompt {
  id: string;
  name: string;
  content: string;
  category?: string;
  createdAt?: number;
}

/** Settings subset every surface understands. Provider-shaped fields are
 *  named as in core `Settings` (provider/model) with extension aliases. */
export interface SyncSettings {
  connection?: 'direct' | 'api';
  provider?: string;
  defaultProvider?: string; // extension alias
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  thinkingEnabled?: boolean;
  prismApiUrl?: string;
  prismApiToken?: string;
  baseUrl?: string;
}

/** Format version so a future importer can migrate instead of guessing. */
export const SYNC_FORMAT_VERSION = 1;

/** The export/import envelope. `app`/`version` let a future Prism reject
 *  unknown producers; unknown fields are ignored, never fatal. */
export interface SyncEnvelope {
  app: 'prism';
  version: number;
  exportedAt: number;
  conversations: SyncConversation[];
  prompts: SyncPrompt[];
  settings: SyncSettings;
}

/** Build an envelope. Empty lists are valid (a clear-then-export round). */
export function makeEnvelope(
  conversations: SyncConversation[],
  prompts: SyncPrompt[],
  settings: SyncSettings,
  now: number,
): SyncEnvelope {
  return {
    app: 'prism',
    version: SYNC_FORMAT_VERSION,
    exportedAt: now,
    conversations,
    prompts,
    settings,
  };
}

/** Parse an envelope, tolerating unknown/missing fields.
 *  Returns null when the document is not a Prism envelope at all. */
export function parseEnvelope(raw: unknown): SyncEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.app !== 'prism') return null;
  return {
    app: 'prism',
    version: typeof obj.version === 'number' ? obj.version : 1,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    conversations: Array.isArray(obj.conversations)
      ? (obj.conversations as SyncConversation[]).filter(isConversation)
      : [],
    prompts: Array.isArray(obj.prompts)
      ? (obj.prompts as SyncPrompt[]).filter(isPrompt)
      : [],
    settings:
      typeof obj.settings === 'object' && obj.settings !== null
        ? (obj.settings as SyncSettings)
        : {},
  };
}

function isConversation(v: unknown): v is SyncConversation {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && Array.isArray(c.messages);
}

function isPrompt(v: unknown): v is SyncPrompt {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.content === 'string';
}

/** Extension Message -> SyncMessage. */
export function messageToSync(m: {
  id?: string;
  role: SyncRole;
  content: string;
  timestamp?: number;
}): SyncMessage {
  return {
    role: m.role,
    content: m.content,
    ...(m.id ? { id: m.id } : {}),
    ...(m.timestamp ? { timestamp: m.timestamp } : {}),
  };
}

/** SyncMessage -> extension Message. */
export function syncToMessage(
  m: SyncMessage,
  conversationId: string,
  now: number,
): {
  id: string;
  role: SyncRole;
  content: string;
  timestamp: number;
  sessionId: string;
} {
  return {
    id: m.id ?? `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? now,
    sessionId: conversationId,
  };
}
