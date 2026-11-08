// Extension-side data sync: export/import/clear over IndexedDB, using the
// shared envelope from @prism/shared-types. Slint/CLI/TUI import the same
// envelope (crates/prism-core/src/sync.rs).
//
// Storage mapping (extension):
//   conversations = chatSessions + chatHistory stores (via shared-db)
//   prompts       = prompts store (PromptShortcut records)
//   settings      = chrome.storage.local 'settings' key

import {
  parseEnvelope,
  makeEnvelope,
  syncToMessage,
  type SyncEnvelope,
  type SyncSettings,
} from '@prism/shared-types';
import {
  getChatSessions,
  loadChatHistory,
  saveChatHistory,
  getPromptShortcuts,
  savePromptShortcut,
  deleteChatSession,
  deletePromptShortcut,
} from '@prism/shared-db';

/** Download a string as a file (browser extension context). */
export function downloadEnvelope(envelope: SyncEnvelope, filename: string): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Collect the full envelope from IndexedDB + chrome.storage. */
export async function exportData(
  getSettings: () => Record<string, unknown>,
): Promise<SyncEnvelope> {
  const sessions = await getChatSessions();
  const conversations = [];
  for (const s of sessions) {
    const messages = await loadChatHistory(s.id);
    conversations.push({
      id: s.id,
      title: s.title || 'Chat',
      created_at: s.createdAt ?? 0,
      updated_at: s.updatedAt ?? 0,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
        ...(m.id ? { id: m.id } : {}),
      })),
    });
  }
  const prompts = (await getPromptShortcuts()).map((p) => ({
    id: p.id,
    name: p.name,
    content: p.content,
    ...(p.category ? { category: p.category } : {}),
    ...(p.createdAt ? { created_at: p.createdAt } : {}),
  }));
  const settings = getSettings();
  return makeEnvelope(
    conversations,
    prompts,
    settings as unknown as SyncSettings,
    Date.now(),
  );
}

/** Apply an imported envelope: sessions/prompts replace local data.
 *  Returns a summary for the UI. */
export async function importData(
  env: SyncEnvelope,
): Promise<{ conversations: number; prompts: number }> {
  const now = Date.now();
  for (const conv of env.conversations) {
    const messages = conv.messages.map((m) => syncToMessage(m, conv.id, now));
    await saveChatHistory(conv.id, messages);
  }
  for (const prompt of env.prompts) {
    await savePromptShortcut({
      id: prompt.id,
      name: prompt.name,
      content: prompt.content,
      ...(prompt.category ? { category: prompt.category } : {}),
      ...(prompt.created_at ? { createdAt: prompt.created_at } : {}),
      createdAt: prompt.created_at ?? now,
    });
  }
  return {
    conversations: env.conversations.length,
    prompts: env.prompts.length,
  };
}

/** Parse user-supplied file text into an envelope (null = not Prism data). */
export function parseImport(text: string): SyncEnvelope | null {
  try {
    return parseEnvelope(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Delete all sessions and prompt shortcuts (settings are kept). */
export async function clearData(): Promise<{ sessions: number; prompts: number }> {
  const sessions = await getChatSessions();
  const prompts = await getPromptShortcuts();
  for (const s of sessions) {
    await deleteChatSession(s.id);
  }
  for (const p of prompts) {
    await deletePromptShortcut(p.id);
  }
  return { sessions: sessions.length, prompts: prompts.length };
}
