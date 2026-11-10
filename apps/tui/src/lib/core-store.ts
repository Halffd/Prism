import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The TUI's gateway to the shared conversation vault — the same files
 * the Slint desktop app and the CLI use, byte-for-byte: one JSON file
 * per conversation (`<id>.json`) inside the core's config root,
 * written with the core's atomic tmp+rename. Opening a chat in one
 * surface shows it in the other on their next list refresh.
 *
 * The shape mirrors `prism_core::conversations::{Conversation,
 * StoredMessage}` and the id rule (`valid_id`: only hex characters,
 * at most 32) — anything else would be silently dropped by the core's
 * loader, which is exactly what we must not let happen.
 */

export interface StoredMessage {
  role: string; // "user" | "assistant" | "system"
  content: string;
  thinking?: string | null;
}

export interface StoredConversation {
  id: string;
  title: string;
  created_at: number; // unix epoch ms
  updated_at: number;
  messages: StoredMessage[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  updated_at: number;
}

/** Storage dir: the core's conversation store, not a TUI-private one. */
export function conversationsDir(): string | null {
  const override = process.env.PRISM_CONVERSATIONS_DIR;
  if (override) {
    return override;
  }
  try {
    const configHome =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'prism', 'conversations');
  } catch {
    return null;
  }
}

/** The core's id rule: ascii-hex only, non-empty, at most 32 chars. */
export function isValidId(id: string): boolean {
  return id.length > 0 && id.length <= 32 && /^[0-9a-fA-F]+$/.test(id);
}

/** Unique id in the same class the core produces (nanosecond hex). */
export function newConversationId(): string {
  return process.hrtime.bigint().toString(16);
}

/** Auto-title: first user message, cut on a char boundary (48 chars). */
export function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = (firstUser?.content ?? 'New chat').trim();
  const truncated = Array.from(raw).slice(0, 48).join('');
  return Array.from(raw).length > 48 ? `${truncated}…` : truncated;
}

function cleanRole(role: string): string | null {
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }
  // Character/roleplay roles and tool-only lines stay TUI-local.
  return null;
}

/** Map TUI chat messages onto vault messages (dropping unmappable). */
export function toStoredMessages(
  messages: Array<{ role: string; content: string }>,
): StoredMessage[] {
  return messages
    .map((m) => ({ role: m.role, content: m.content }))
    .filter((m) => cleanRole(m.role) !== null)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Path of one conversation file. Throws on an invalid id. */
function filePath(dir: string, id: string): string {
  if (!isValidId(id)) {
    throw new Error(`invalid conversation id: ${id}`);
  }
  return path.join(dir, `${id}.json`);
}

/** Atomic tmp+rename write, matching the core's FsStorage. */
function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best effort: the rename error is what matters
    }
    throw err;
  }
}

/** Save a conversation. Returns false (with reason) when refused. */
export function saveConversation(
  dir: string | null,
  conv: StoredConversation,
): { ok: boolean; error?: string } {
  if (!dir) {
    return { ok: false, error: 'no conversations dir' };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(filePath(dir, conv.id), JSON.stringify(conv, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Load one conversation; null when missing/corrupt/invalid id. */
export function loadConversation(
  dir: string | null,
  id: string,
): StoredConversation | null {
  if (!dir || !isValidId(id)) {
    return null;
  }
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, `${id}.json`), 'utf-8'),
    ) as Partial<StoredConversation>;
    if (typeof raw.id !== 'string' || !Array.isArray(raw.messages)) {
      return null;
    }
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      created_at: typeof raw.created_at === 'number' ? raw.created_at : 0,
      updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : 0,
      messages: raw.messages.filter(
        (m): m is StoredMessage =>
          m !== null && typeof m.role === 'string' && typeof m.content === 'string',
      ),
    };
  } catch {
    return null;
  }
}

/** List newest-first metadata; corrupt files skipped (core parity). */
export function listConversations(dir: string | null): ConversationMeta[] {
  if (!dir) {
    return [];
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const metas: ConversationMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, name), 'utf-8'),
      ) as Partial<StoredConversation>;
      if (typeof raw.id !== 'string' || !Array.isArray(raw.messages)) {
        continue; // corrupt-skipped, like the core
      }
      metas.push({
        id: raw.id,
        title: typeof raw.title === 'string' ? raw.title : '',
        updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : 0,
      });
    } catch {
      continue;
    }
  }
  metas.sort((a, b) => b.updated_at - a.updated_at);
  return metas;
}

/** Delete one conversation file; missing file counts as removed. */
export function deleteConversation(dir: string | null, id: string): boolean {
  if (!dir || !isValidId(id)) {
    return false;
  }
  try {
    fs.unlinkSync(path.join(dir, `${id}.json`));
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/** Persist a TUI chat as a vault conversation (create or update).
 *
 * The caller passes the session's full history; the latest snapshot
 * wins. A snapshot that is strictly shorter than what the vault
 * already holds (and still starts with the same head) is treated as a
 * stale read — the longer store is kept instead of truncating.
 */
export function persistChat(
  dir: string | null,
  currentId: string | null,
  messages: Array<{ role: string; content: string }>,
): { id: string; error?: string } {
  const stored = toStoredMessages(messages);
  if (stored.length === 0) {
    return { id: currentId ?? '', error: 'nothing storable in this chat yet' };
  }
  const id = currentId && isValidId(currentId) ? currentId : newConversationId();
  const now = Date.now();
  const existing = id === currentId ? loadConversation(dir, currentId) : null;
  // A snapshot that is a strict prefix of what the vault holds (same
  // head, fewer messages) is a stale read: keep the longer store
  // instead of truncating it.
  const isPrefix =
    existing != null &&
    existing.messages.length > stored.length &&
    stored.every((m, i) => {
      const prev = existing.messages[i];
      return prev.role === m.role && prev.content === m.content;
    });
  const finalMessages = isPrefix ? existing!.messages : stored;
  const conv: StoredConversation = {
    id,
    title: existing?.title || deriveTitle(finalMessages),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    messages: finalMessages,
  };
  const res = saveConversation(dir, conv);
  return res.ok ? { id } : { id: currentId ?? '', error: res.error };
}
