import {
  matchSnippet,
  isPartialTrigger,
  normalizeCombination,
  combinationMatchesEvent,
  type Snippet,
} from '@prism/shared-types';

const snippet = (overrides: Partial<Snippet>): Snippet => ({
  id: 'snippet-1',
  name: 'Test snippet',
  shortcut: '/fix',
  text: 'Fixed text',
  triggerMode: 'standalone',
  expansionMode: 'text',
  createdAt: 0,
  ...overrides,
});

describe('Snippet matcher', () => {
  test('expands a standalone trigger when it is the whole input', () => {
    const match = matchSnippet('/fix', [snippet({})]);

    expect(match).not.toBeNull();
    expect(match?.snippet.name).toBe('Test snippet');
    expect(match?.replacement).toBe('Fixed text');
    expect(match?.isHtml).toBe(false);
  });

  test('does not expand a standalone trigger inside longer text', () => {
    const match = matchSnippet('/fix this please', [snippet({})]);

    expect(match).toBeNull();
  });

  test('expands an anywhere trigger inside longer text', () => {
    const match = matchSnippet(
      'please /fix this',
      [snippet({ triggerMode: 'anywhere' })],
    );

    expect(match).not.toBeNull();
    expect(match?.matchedText).toBe('/fix');
  });

  test('prefers the longest matching trigger', () => {
    const match = matchSnippet('/summarise', [
      snippet({ id: 'a', shortcut: '/sum' }),
      snippet({ id: 'b', shortcut: '/summarise', name: 'Longer' }),
    ]);

    expect(match?.snippet.name).toBe('Longer');
  });

  test('uses the html payload for html snippets', () => {
    const match = matchSnippet(
      '/rich',
      [
        snippet({
          shortcut: '/rich',
          expansionMode: 'html',
          html: '<b>bold</b>',
          text: 'bold',
        }),
      ],
    );

    expect(match?.replacement).toBe('<b>bold</b>');
    expect(match?.isHtml).toBe(true);
  });

  test('reports a partial trigger while the user is still typing', () => {
    expect(isPartialTrigger('/fi', [snippet({})])).toBe(true);
    expect(isPartialTrigger('/f', [snippet({})])).toBe(true);
    expect(isPartialTrigger('/fix', [snippet({})])).toBe(true);
    expect(isPartialTrigger('/fixx', [snippet({})])).toBe(false);
  });

  test('reports no partial trigger for empty input', () => {
    expect(isPartialTrigger('', [snippet({})])).toBe(false);
  });
});

describe('Hotkey combination matching', () => {
  test('normalizes modifier order and case', () => {
    expect(normalizeCombination('shift+ctrl+F')).toBe('ctrl+shift+f');
    expect(normalizeCombination('Ctrl+Shift+F')).toBe('ctrl+shift+f');
  });

  test('treats Cmd and Ctrl as the same modifier', () => {
    expect(normalizeCombination('Cmd+K')).toBe('ctrl+k');
    expect(normalizeCombination('Ctrl+K')).toBe('ctrl+k');
  });

  test('matches an event with the expected modifiers', () => {
    const event = {
      key: 't',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    };

    expect(combinationMatchesEvent('Ctrl+Shift+T', event)).toBe(true);
  });

  test('does not match when a modifier is missing', () => {
    const event = {
      key: 't',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };

    expect(combinationMatchesEvent('Ctrl+Shift+T', event)).toBe(false);
  });

  test('does not match when an extra modifier is held', () => {
    const event = {
      key: 't',
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: true,
    };

    expect(combinationMatchesEvent('Ctrl+Shift+T', event)).toBe(false);
  });

  test('matches Cmd on macOS as Ctrl', () => {
    const event = {
      key: 'k',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: false,
    };

    expect(combinationMatchesEvent('Ctrl+K', event)).toBe(true);
  });

  test('matches a bare key only when no modifier is held', () => {
    const event = {
      key: 'k',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };

    expect(combinationMatchesEvent('K', event)).toBe(true);
    expect(
      combinationMatchesEvent('K', { ...event, ctrlKey: true }),
    ).toBe(false);
  });
});
