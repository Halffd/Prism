/**
 * Storage for Blaze-style snippets and hotkey bindings.
 *
 * Snippets live in their own IndexedDB store so they can grow beyond the
 * legacy `prompts` table (which stores slash-command prompt shortcuts). The
 * content script cannot read IndexedDB, so the list is mirrored into
 * `chrome.storage.local` — the same mirroring the prompt shortcuts already
 * use — and the content script reads that mirror.
 *
 * The stores live in the shared `PrismDB` database, so this module reuses
 * the connection from `db.ts` rather than opening a second one. Two clients
 * on one database have to agree on the version and the schema, and a single
 * connection avoids the two of them blocking each other.
 */

import type { HotkeyBinding, Snippet } from '@prism/shared-types';
import { getDatabase } from './db';

const SNIPPETS_STORE = 'snippets';
const HOTKEYS_STORE = 'hotkeys';

const SNIPPETS_STORAGE_KEY = 'prismSnippets';
const HOTKEYS_STORAGE_KEY = 'prismHotkeys';

/** The subset of `chrome.storage.local` this module uses. */
interface ChromeLocalStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * True when the given value exposes a usable `chrome.storage.local`.
 *
 * `shared-db` is compiled without the extension's `chrome` typings, so the
 * global is checked at runtime instead of being asserted.
 */
function hasChromeLocalStorage(
  value: unknown,
): value is { chrome: { storage: { local: ChromeLocalStorage } } } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('chrome' in value)) {
    return false;
  }

  const chrome = value.chrome;
  if (typeof chrome !== 'object' || chrome === null) {
    return false;
  }
  if (!('storage' in chrome)) {
    return false;
  }

  const storage = chrome.storage;
  if (typeof storage !== 'object' || storage === null) {
    return false;
  }
  if (!('local' in storage)) {
    return false;
  }

  const local = storage.local;
  return (
    typeof local === 'object' &&
    local !== null &&
    'get' in local &&
    typeof local.get === 'function' &&
    'set' in local &&
    typeof local.set === 'function'
  );
}

/**
 * Writes the snippet list to `chrome.storage.local` so the content script
 * can read it. Failures are non-fatal: IndexedDB remains the source of
 * truth and the content script simply sees the previous mirror.
 */
async function mirrorToChromeStorage(snippets: Snippet[]): Promise<void> {
  if (!hasChromeLocalStorage(globalThis)) {
    return;
  }

  try {
    await globalThis.chrome.storage.local.set({
      [SNIPPETS_STORAGE_KEY]: snippets,
    });
  } catch (error) {
    console.warn('Could not mirror snippets to chrome.storage.local:', error);
  }
}

/**
 * Reads the mirrored snippet list from `chrome.storage.local`.
 *
 * The content script uses this because it has no IndexedDB access. Returns
 * an empty array when the mirror is missing or unreadable.
 */
export async function getMirroredSnippets(): Promise<Snippet[]> {
  if (!hasChromeLocalStorage(globalThis)) {
    return [];
  }

  try {
    const result = await globalThis.chrome.storage.local.get([
      SNIPPETS_STORAGE_KEY,
    ]);
    const snippets = result[SNIPPETS_STORAGE_KEY];
    return Array.isArray(snippets) ? (snippets as Snippet[]) : [];
  } catch (error) {
    console.warn('Could not read mirrored snippets:', error);
    return [];
  }
}

/** Saves a snippet, replacing any existing snippet with the same id. */
export async function saveSnippet(snippet: Snippet): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(SNIPPETS_STORE, 'readwrite');
  await tx.objectStore(SNIPPETS_STORE).put(snippet);
  await tx.done;

  const all = await getSnippets();
  await mirrorToChromeStorage(all);
}

/**
 * Returns every stored snippet.
 *
 * Built-in snippets are merged in so a fresh install still has the default
 * set even before anything has been written to IndexedDB.
 */
export async function getSnippets(): Promise<Snippet[]> {
  let stored: Snippet[] = [];

  try {
    const db = await getDatabase();
    const tx = db.transaction(SNIPPETS_STORE, 'readonly');
    stored = await tx.objectStore(SNIPPETS_STORE).getAll();
  } catch (error) {
    console.warn('Could not read snippets from IndexedDB:', error);
  }

  const merged = new Map<string, Snippet>();
  for (const snippet of DEFAULT_SNIPPETS) {
    merged.set(snippet.id, snippet);
  }
  for (const snippet of stored) {
    // A stored copy of a built-in snippet overrides the default so users can
    // customise the built-ins without them being reset on every read.
    merged.set(snippet.id, snippet);
  }

  return Array.from(merged.values()).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

/** Deletes a snippet. Built-in snippets cannot be deleted. */
export async function deleteSnippet(snippetId: string): Promise<void> {
  const snippet = (await getSnippets()).find((s) => s.id === snippetId);
  if (snippet?.builtIn) {
    return;
  }

  const db = await getDatabase();
  const tx = db.transaction(SNIPPETS_STORE, 'readwrite');
  await tx.objectStore(SNIPPETS_STORE).delete(snippetId);
  await tx.done;

  const all = await getSnippets();
  await mirrorToChromeStorage(all);
}

/** Saves a hotkey binding, replacing any existing binding with the same id. */
export async function saveHotkey(binding: HotkeyBinding): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(HOTKEYS_STORE, 'readwrite');
  await tx.objectStore(HOTKEYS_STORE).put(binding);
  await tx.done;

  await mirrorHotkeys(await getHotkeys());
}

/** Returns every stored hotkey binding. */
export async function getHotkeys(): Promise<HotkeyBinding[]> {
  let stored: HotkeyBinding[] = [];

  try {
    const db = await getDatabase();
    const tx = db.transaction(HOTKEYS_STORE, 'readonly');
    stored = await tx.objectStore(HOTKEYS_STORE).getAll();
  } catch (error) {
    console.warn('Could not read hotkeys from IndexedDB:', error);
  }

  const merged = new Map<string, HotkeyBinding>();
  for (const binding of DEFAULT_HOTKEYS) {
    merged.set(binding.id, binding);
  }
  for (const binding of stored) {
    merged.set(binding.id, binding);
  }

  return Array.from(merged.values());
}

/** Deletes a hotkey binding. */
export async function deleteHotkey(hotkeyId: string): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(HOTKEYS_STORE, 'readwrite');
  await tx.objectStore(HOTKEYS_STORE).delete(hotkeyId);
  await tx.done;

  await mirrorHotkeys(await getHotkeys());
}

/** Writes the hotkey list to `chrome.storage.local` for the content script. */
async function mirrorHotkeys(bindings: HotkeyBinding[]): Promise<void> {
  if (!hasChromeLocalStorage(globalThis)) {
    return;
  }

  try {
    await globalThis.chrome.storage.local.set({
      [HOTKEYS_STORAGE_KEY]: bindings,
    });
  } catch (error) {
    console.warn('Could not mirror hotkeys to chrome.storage.local:', error);
  }
}

/** Reads the mirrored hotkey list from `chrome.storage.local`. */
export async function getMirroredHotkeys(): Promise<HotkeyBinding[]> {
  if (!hasChromeLocalStorage(globalThis)) {
    return [];
  }

  try {
    const result = await globalThis.chrome.storage.local.get([
      HOTKEYS_STORAGE_KEY,
    ]);
    const bindings = result[HOTKEYS_STORAGE_KEY];
    return Array.isArray(bindings) ? (bindings as HotkeyBinding[]) : [];
  } catch (error) {
    console.warn('Could not read mirrored hotkeys:', error);
    return [];
  }
}

/**
 * The snippets Prism ships with.
 *
 * These cover the everyday writing jobs an AI assistant is asked to do, and
 * double as the worked examples for the snippet manager.
 */
export const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: 'snippet-builtin-fix',
    name: 'Fix grammar',
    shortcut: '/fix',
    text: 'Fix the grammar and clarity of the following text. Keep the original meaning and tone:\n\n',
    group: 'Writing',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-shorter',
    name: 'Make shorter',
    shortcut: '/short',
    text: 'Rewrite the following text to be significantly shorter while keeping every important detail:\n\n',
    group: 'Writing',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-longer',
    name: 'Make longer',
    shortcut: '/long',
    text: 'Expand the following text with relevant detail and explanation:\n\n',
    group: 'Writing',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-translate',
    name: 'Translate',
    shortcut: '/translate',
    text: 'Translate the following text into English:\n\n',
    group: 'Writing',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-summary',
    name: 'Summarize',
    shortcut: '/sum',
    text: 'Summarize the following text in a few clear bullet points:\n\n',
    group: 'Writing',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-explain',
    name: 'Explain',
    shortcut: '/explain',
    text: 'Explain the following clearly and simply, step by step:\n\n',
    group: 'Learning',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-code',
    name: 'Explain code',
    shortcut: '/code',
    text: 'Explain what this code does, step by step, and point out any problems:\n\n',
    group: 'Learning',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-refactor',
    name: 'Refactor code',
    shortcut: '/refactor',
    text: 'Refactor this code for clarity and maintainability, and explain each change:\n\n',
    group: 'Development',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-tests',
    name: 'Write tests',
    shortcut: '/test',
    text: 'Write thorough tests for this code, covering the happy path and the edge cases:\n\n',
    group: 'Development',
    triggerMode: 'standalone',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'snippet-builtin-signature',
    name: 'Email signature',
    shortcut: '/sig',
    text: 'Best regards,\n',
    group: 'Templates',
    triggerMode: 'anywhere',
    expansionMode: 'text',
    builtIn: true,
    createdAt: 0,
  },
];

/**
 * The hotkeys Prism ships with.
 *
 * The `Ctrl+Shift+…` combinations match the ones the popup already
 * advertises for the send-context toggles, so the same shortcut works
 * whether the user is in the popup or on the page.
 *
 * The browser reserves `Ctrl+Shift+P` for the extension's own "open the
 * popup" command, so the page-context hotkey uses `Ctrl+Shift+G` instead —
 * otherwise the browser would open the popup before the page-level hotkey
 * could fire.
 */
export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  {
    id: 'hotkey-text-selection',
    name: 'Send selected text',
    combination: 'Ctrl+Shift+T',
    kind: 'toggle',
    mode: 'textSelection',
    enabled: true,
  },
  {
    id: 'hotkey-page-context',
    name: 'Send page contents',
    combination: 'Ctrl+Shift+G',
    kind: 'toggle',
    mode: 'pageContext',
    enabled: true,
  },
  {
    id: 'hotkey-screenshot',
    name: 'Send screenshot',
    combination: 'Ctrl+Shift+S',
    kind: 'toggle',
    mode: 'pageScreenshot',
    enabled: true,
  },
  {
    id: 'hotkey-clipboard',
    name: 'Send clipboard',
    combination: 'Ctrl+Shift+C',
    kind: 'toggle',
    mode: 'clipboard',
    enabled: true,
  },
  {
    id: 'hotkey-page-info',
    name: 'Send page info',
    combination: 'Ctrl+Shift+I',
    kind: 'toggle',
    mode: 'pageInfo',
    enabled: true,
  },
];
