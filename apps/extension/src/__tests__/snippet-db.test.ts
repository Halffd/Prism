import {
  getSnippets,
  saveSnippet,
  deleteSnippet,
  getHotkeys,
  saveHotkey,
  deleteHotkey,
  DEFAULT_SNIPPETS,
  DEFAULT_HOTKEYS,
} from '@prism/shared-db';
import type { HotkeyBinding, Snippet } from '@prism/shared-types';

describe('Snippet storage', () => {
  test('returns the built-in snippets on a fresh install', async () => {
    const snippets = await getSnippets();

    expect(snippets.length).toBeGreaterThanOrEqual(DEFAULT_SNIPPETS.length);
    for (const builtIn of DEFAULT_SNIPPETS) {
      expect(snippets.some((snippet) => snippet.id === builtIn.id)).toBe(true);
    }
  });

  test('saves a snippet and reads it back', async () => {
    const snippet: Snippet = {
      id: 'snippet-test-1',
      name: 'Test snippet',
      shortcut: '/test',
      text: 'Test content',
      group: 'Testing',
      triggerMode: 'standalone',
      expansionMode: 'text',
      keyboardShortcuts: ['Ctrl+Shift+T'],
      createdAt: Date.now(),
    };

    await saveSnippet(snippet);
    const snippets = await getSnippets();

    const stored = snippets.find((candidate) => candidate.id === snippet.id);
    expect(stored).toEqual(snippet);

    await deleteSnippet(snippet.id);
  });

  test('does not delete a built-in snippet', async () => {
    const builtIn = DEFAULT_SNIPPETS[0];
    await deleteSnippet(builtIn.id);

    const snippets = await getSnippets();
    expect(snippets.some((snippet) => snippet.id === builtIn.id)).toBe(true);
  });

  test('lets a stored copy of a built-in snippet override the default', async () => {
    const builtIn = DEFAULT_SNIPPETS[0];
    const customized: Snippet = {
      ...builtIn,
      name: 'Customised built-in',
      text: 'Custom text',
    };

    await saveSnippet(customized);
    const snippets = await getSnippets();

    const stored = snippets.find((snippet) => snippet.id === builtIn.id);
    expect(stored?.name).toBe('Customised built-in');
    expect(stored?.text).toBe('Custom text');
  });
});

describe('Hotkey storage', () => {
  test('returns the built-in hotkeys on a fresh install', async () => {
    const hotkeys = await getHotkeys();

    expect(hotkeys.length).toBeGreaterThanOrEqual(DEFAULT_HOTKEYS.length);
    for (const builtIn of DEFAULT_HOTKEYS) {
      expect(hotkeys.some((hotkey) => hotkey.id === builtIn.id)).toBe(true);
    }
  });

  test('saves a hotkey and reads it back', async () => {
    const hotkey: HotkeyBinding = {
      id: 'hotkey-test-1',
      name: 'Test hotkey',
      combination: 'Ctrl+Shift+K',
      kind: 'action',
      enabled: true,
    };

    await saveHotkey(hotkey);
    const hotkeys = await getHotkeys();

    const stored = hotkeys.find((candidate) => candidate.id === hotkey.id);
    expect(stored).toEqual(hotkey);

    await deleteHotkey(hotkey.id);
  });

  test('deletes a hotkey', async () => {
    const hotkey: HotkeyBinding = {
      id: 'hotkey-test-2',
      name: 'Temporary hotkey',
      combination: 'Ctrl+Shift+M',
      kind: 'action',
      enabled: true,
    };

    await saveHotkey(hotkey);
    await deleteHotkey(hotkey.id);

    const hotkeys = await getHotkeys();
    expect(hotkeys.some((candidate) => candidate.id === hotkey.id)).toBe(false);
  });
});
