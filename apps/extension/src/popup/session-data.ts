import type { Message } from '@prism/shared-types';
import {
  getDatabase,
  loadChatHistory,
  saveChatHistory,
  setCache,
  getCache,
  updateChatSessionMeta,
  type DBChatSession,
} from '@prism/shared-db';

/**
 * Session-list data helpers: filtering, tagging, archive/read state,
 * the portable backup envelope and the local auto-backup snapshots.
 *
 * The backup envelope mirrors the core's `BackupEnvelope`:
 * `{ app, version, exported_at, conversations }`.
 */

/** Version of the backup format this build writes. */
export const BACKUP_FORMAT_VERSION = 1;

/** Marker every Prism backup file carries. */
export const BACKUP_APP = 'prism';

/** One message inside a backup conversation. */
export interface BackupMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  id?: string;
  tags?: string[];
  read?: boolean;
  edited_at?: number;
}

/** One conversation inside a backup envelope. */
export interface BackupConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: BackupMessage[];
  tags?: string[];
  archived?: boolean;
  read?: boolean;
  forked_from?: string;
  forked_at_message?: number;
}

/** A complete backup file. */
export interface BackupEnvelope {
  app: string;
  version: number;
  exported_at: number;
  conversations: BackupConversation[];
}

/** Why an import failed. */
export type ImportFailure =
  | { kind: 'not-envelope'; reason: string }
  | { kind: 'unsupported'; version: number; reason: string }
  | { kind: 'corrupt'; reason: string };

/** The result of parsing an import file. */
export type ImportParseResult =
  | { ok: true; envelope: BackupEnvelope; migrated: boolean }
  | { ok: false; failure: ImportFailure };

export interface StoredBackup {
  id: string;
  createdAt: number;
  conversationCount: number;
  envelope: BackupEnvelope;
}

export interface SessionFilters {
  text: string;
  tag: string;
  read: 'all' | 'read' | 'unread';
  archived: 'all' | 'active' | 'archived';
}

/** All filters off. */
export function defaultSessionFilters(): SessionFilters {
  return { text: '', tag: '', read: 'all', archived: 'active' };
}

/** True when a session is unread. Missing means read. */
export function isUnread(session: DBChatSession): boolean {
  return session.read === false;
}

/** True when a session is archived. */
export function isArchived(session: DBChatSession): boolean {
  return session.archived === true;
}

/** Every tag used by the given sessions, sorted. */
export function collectSessionTags(sessions: DBChatSession[]): string[] {
  const tags = new Set<string>();
  for (const session of sessions) {
    for (const tag of session.tags ?? []) {
      if (tag.trim()) tags.add(tag.trim());
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

/**
 * Apply the list filters.
 *
 * The title search is case-insensitive; the tag filter matches a session
 * that carries the tag; the read filter matches the unread badge; the
 * archived filter separates archived sessions from the active list.
 */
export function filterSessions(
  sessions: DBChatSession[],
  filters: SessionFilters,
): DBChatSession[] {
  const query = filters.text.trim().toLowerCase();
  return sessions.filter((session) => {
    if (query && !(session.title ?? '').toLowerCase().includes(query)) {
      return false;
    }
    if (filters.tag && !(session.tags ?? []).includes(filters.tag)) {
      return false;
    }
    if (filters.read === 'read' && isUnread(session)) return false;
    if (filters.read === 'unread' && !isUnread(session)) return false;
    if (filters.archived === 'active' && isArchived(session)) return false;
    if (filters.archived === 'archived' && !isArchived(session)) return false;
    return true;
  });
}

/** Add a tag to a session, keeping the list sorted and free of blanks. */
export function addSessionTag(tags: string[] | undefined, tag: string): string[] {
  const trimmed = tag.trim();
  if (!trimmed) return tags ?? [];
  const next = new Set(tags ?? []);
  next.add(trimmed);
  return Array.from(next).sort((a, b) => a.localeCompare(b));
}

/** Remove a tag from a session. */
export function removeSessionTag(
  tags: string[] | undefined,
  tag: string,
): string[] {
  return (tags ?? []).filter((candidate) => candidate !== tag);
}

function toBackupMessage(message: Message): BackupMessage {
  const result: BackupMessage = {
    role: message.role,
    content: message.content,
  };
  if (message.id) result.id = message.id;
  if (message.tags && message.tags.length > 0) result.tags = message.tags;
  if (message.read !== undefined) result.read = message.read;
  if (message.editedAt !== undefined) result.edited_at = message.editedAt;
  return result;
}

function fromBackupMessage(
  message: BackupMessage,
  sessionId: string,
  now: number,
): Message {
  const result: Message = {
    id:
      message.id ??
      `${sessionId}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    role: message.role,
    content: message.content,
    timestamp: now,
  };
  if (message.tags && message.tags.length > 0) result.tags = message.tags;
  if (message.read !== undefined) result.read = message.read;
  if (message.edited_at !== undefined) result.editedAt = message.edited_at;
  return result;
}

/**
 * Build a backup envelope from the given sessions.
 *
 * The messages of each session are read from storage; a session whose
 * transcript cannot be read is skipped rather than written half-empty.
 */
export async function buildBackupEnvelope(
  sessions: DBChatSession[],
  now: number = Date.now(),
): Promise<BackupEnvelope> {
  const conversations: BackupConversation[] = [];
  for (const session of sessions) {
    let messages: Message[];
    try {
      messages = await loadChatHistory(session.id);
    } catch {
      continue;
    }
    const conversation: BackupConversation = {
      id: session.id,
      title: session.title,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      messages: messages.map(toBackupMessage),
    };
    if (session.tags && session.tags.length > 0) conversation.tags = session.tags;
    if (session.read !== undefined) conversation.read = session.read;
    if (session.archived !== undefined) conversation.archived = session.archived;
    if (session.forkedFrom) conversation.forked_from = session.forkedFrom;
    if (session.forkedAtMessage !== undefined) {
      conversation.forked_at_message = session.forkedAtMessage;
    }
    conversations.push(conversation);
  }

  return {
    app: BACKUP_APP,
    version: BACKUP_FORMAT_VERSION,
    exported_at: now,
    conversations,
  };
}

function isBackupMessage(value: unknown): value is BackupMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BackupMessage>;
  return (
    typeof candidate.content === 'string' &&
    (candidate.role === 'user' ||
      candidate.role === 'assistant' ||
      candidate.role === 'system')
  );
}

function isBackupConversation(value: unknown): value is BackupConversation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BackupConversation>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isBackupMessage)
  );
}

/**
 * Validate a backup file.
 *
 * A document that is not a Prism backup, or one written by a newer Prism,
 * is refused with a reason the user can read. A document that is a Prism
 * backup of an older format version is migrated on the way in.
 */
export function parseBackupEnvelope(raw: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: 'corrupt',
        reason: `This file is not readable JSON: ${(error as Error).message}`,
      },
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      ok: false,
      failure: {
        kind: 'not-envelope',
        reason: 'This file is not a Prism backup.',
      },
    };
  }

  const candidate = parsed as Partial<BackupEnvelope>;
  if (candidate.app !== BACKUP_APP) {
    return {
      ok: false,
      failure: {
        kind: 'not-envelope',
        reason: `This file is not a Prism backup (app = ${JSON.stringify(
          candidate.app ?? null,
        )}).`,
      },
    };
  }
  if (
    typeof candidate.version !== 'number' ||
    !Number.isFinite(candidate.version)
  ) {
    return {
      ok: false,
      failure: {
        kind: 'corrupt',
        reason: 'This Prism backup has no readable format version.',
      },
    };
  }
  if (candidate.version > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      failure: {
        kind: 'unsupported',
        version: candidate.version,
        reason: `This backup was written by a newer Prism (format version ${candidate.version}; this build understands ${BACKUP_FORMAT_VERSION}).`,
      },
    };
  }
  if (!Array.isArray(candidate.conversations)) {
    return {
      ok: false,
      failure: {
        kind: 'corrupt',
        reason: 'This Prism backup has no readable conversation list.',
      },
    };
  }
  if (!candidate.conversations.every(isBackupConversation)) {
    return {
      ok: false,
      failure: {
        kind: 'corrupt',
        reason:
          'This Prism backup contains a conversation with a missing id, title or unreadable messages.',
      },
    };
  }

  return {
    ok: true,
    migrated: candidate.version < BACKUP_FORMAT_VERSION,
    envelope: {
      app: BACKUP_APP,
      version: candidate.version,
      exported_at: candidate.exported_at ?? 0,
      conversations: candidate.conversations.map((conversation) => ({
        ...conversation,
        created_at: conversation.created_at ?? 0,
        updated_at: conversation.updated_at ?? 0,
      })),
    },
  };
}

/**
 * Write an imported envelope into storage.
 *
 * The sessions are merged: an imported conversation replaces the stored
 * one with the same id.
 */
export async function applyBackupEnvelope(
  envelope: BackupEnvelope,
  now: number = Date.now(),
): Promise<number> {
  let imported = 0;
  for (const conversation of envelope.conversations) {
    const messages = conversation.messages.map((message) =>
      fromBackupMessage(message, conversation.id, now),
    );
    await saveChatHistory(conversation.id, messages);
    await updateChatSessionMeta(conversation.id, {
      title: conversation.title,
      tags: conversation.tags ?? [],
      read: conversation.read ?? true,
      archived: conversation.archived ?? false,
      forkedFrom: conversation.forked_from,
      forkedAtMessage: conversation.forked_at_message,
      updatedAt: conversation.updated_at || now,
    });
    imported += 1;
  }
  return imported;
}

const BACKUP_KEY_PREFIX = 'backup:';

/** Key of a snapshot in the cache store. */
export function backupCacheKey(id: string): string {
  return `${BACKUP_KEY_PREFIX}${id}`;
}

/** True when a cache key belongs to a backup snapshot. */
export function isBackupCacheKey(key: string): boolean {
  return key.startsWith(BACKUP_KEY_PREFIX);
}

interface CacheRow {
  key?: string;
  value?: unknown;
}

/**
 * Write a snapshot of the given sessions and drop the oldest ones above
 * the retention count.
 */
export async function createBackupSnapshot(
  sessions: DBChatSession[],
  retention: number,
  now: number = Date.now(),
): Promise<StoredBackup> {
  const envelope = await buildBackupEnvelope(sessions, now);
  // Two snapshots in the same millisecond must not collide.
  const id = `snapshot_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const stored: StoredBackup = {
    id,
    createdAt: now,
    conversationCount: envelope.conversations.length,
    envelope,
  };
  await setCache(backupCacheKey(id), stored);
  await pruneBackupSnapshots(retention);
  return stored;
}

function isStoredBackup(value: unknown): value is StoredBackup {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredBackup>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.conversationCount === 'number' &&
    typeof candidate.envelope === 'object' &&
    candidate.envelope !== null
  );
}

/** Read every stored snapshot, newest first. */
export async function listBackupSnapshots(): Promise<StoredBackup[]> {
  const db = await getDatabase();
  const tx = db.transaction('cache', 'readonly');
  const rows = (await tx.objectStore('cache').getAll()) as CacheRow[];
  await tx.done;

  const snapshots: StoredBackup[] = [];
  for (const row of rows) {
    if (!row?.key || !isBackupCacheKey(row.key)) continue;
    if (!isStoredBackup(row.value)) continue;
    snapshots.push(row.value);
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  return snapshots;
}

/** Delete all but the newest `retention` snapshots. */
export async function pruneBackupSnapshots(retention: number): Promise<void> {
  const keep = Math.max(1, Math.floor(retention));
  const snapshots = await listBackupSnapshots();
  const surplus = snapshots.slice(keep);
  if (surplus.length === 0) return;

  const db = await getDatabase();
  const tx = db.transaction('cache', 'readwrite');
  const store = tx.objectStore('cache');
  for (const snapshot of surplus) {
    await store.delete(backupCacheKey(snapshot.id));
  }
  await tx.done;
}

/** Delete every stored snapshot. */
export async function deleteAllBackupSnapshots(): Promise<void> {
  const snapshots = await listBackupSnapshots();
  if (snapshots.length === 0) return;

  const db = await getDatabase();
  const tx = db.transaction('cache', 'readwrite');
  const store = tx.objectStore('cache');
  for (const snapshot of snapshots) {
    await store.delete(backupCacheKey(snapshot.id));
  }
  await tx.done;
}

/** Restore a snapshot into storage, returning the number of sessions. */
export async function restoreBackupSnapshot(
  snapshot: StoredBackup,
): Promise<number> {
  return applyBackupEnvelope(snapshot.envelope);
}

/** Read one snapshot by id. */
export async function getBackupSnapshot(
  id: string,
): Promise<StoredBackup | null> {
  return getCache<StoredBackup>(backupCacheKey(id));
}
