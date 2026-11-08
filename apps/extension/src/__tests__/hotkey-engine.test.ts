import { createHotkeyEngine } from '../content/hotkey-engine';
import type { HotkeyBinding, Snippet } from '@prism/shared-types';

const snippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 'snippet-1',
  name: 'Fix grammar',
  shortcut: '/fix',
  text: 'Fixed text',
  triggerMode: 'standalone',
  expansionMode: 'text',
  createdAt: 0,
  ...overrides,
});

const hotkey = (overrides: Partial<HotkeyBinding> = {}): HotkeyBinding => ({
  id: 'hotkey-1',
  name: 'Send selected text',
  combination: 'Ctrl+Shift+T',
  kind: 'toggle',
  mode: 'textSelection',
  enabled: true,
  ...overrides,
});

describe('Page hotkey engine', () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    input = document.createElement('input');
    document.body.appendChild(input);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const press = (
    key: string,
    init: KeyboardEventInit = {},
    target: HTMLElement = input,
  ) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  };

  /**
   * Waits for the engine's asynchronous key handling to finish.
   *
   * The engine's key handling is a chain of awaited promises, so draining
   * the microtask queue is enough for a plain text input, whose insertion
   * path is synchronous.
   */
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  test('expands a snippet when its trigger is typed', async () => {
    const expanded: Snippet[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({})],
      getHotkeys: () => [],
      onSnippetExpanded: (s) => expanded.push(s),
    });
    engine.start();

    for (const char of '/fix') {
      press(char);
      await settle();
    }

    expect(input.value).toBe('Fixed text');
    expect(expanded).toHaveLength(1);
    expect(expanded[0].name).toBe('Fix grammar');

    engine.stop();
  });

  test('does not expand a snippet when the trigger is not typed', async () => {
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({})],
      getHotkeys: () => [],
    });
    engine.start();

    for (const char of 'hello') {
      press(char);
      await settle();
    }

    expect(input.value).toBe('');

    engine.stop();
  });

  test('expands an anywhere snippet inside surrounding text', async () => {
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({ triggerMode: 'anywhere' })],
      getHotkeys: () => [],
    });
    engine.start();

    input.value = 'please ';
    for (const char of '/fix') {
      press(char);
      await settle();
    }

    expect(input.value).toBe('please Fixed text');

    engine.stop();
  });

  test('runs a hotkey binding and toggles its mode', async () => {
    const toggles: { mode: string; enabled: boolean }[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [],
      getHotkeys: () => [hotkey({})],
      getModeState: () => false,
      onToggleMode: (mode, enabled) => toggles.push({ mode, enabled }),
    });
    engine.start();

    press('t', { ctrlKey: true, shiftKey: true });
    await settle();

    expect(toggles).toEqual([{ mode: 'textSelection', enabled: true }]);

    engine.stop();
  });

  test('runs a hotkey binding outside an editable', async () => {
    const toggles: { mode: string; enabled: boolean }[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [],
      getHotkeys: () => [hotkey({})],
      getModeState: () => true,
      onToggleMode: (mode, enabled) => toggles.push({ mode, enabled }),
    });
    engine.start();

    press('t', { ctrlKey: true, shiftKey: true }, document.body);
    await settle();

    expect(toggles).toEqual([{ mode: 'textSelection', enabled: false }]);

    engine.stop();
  });

  test('does not fire a hotkey when the modifier is missing', async () => {
    const toggles: { mode: string; enabled: boolean }[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [],
      getHotkeys: () => [hotkey({})],
      getModeState: () => false,
      onToggleMode: (mode, enabled) => toggles.push({ mode, enabled }),
    });
    engine.start();

    press('t', { ctrlKey: true });
    await settle();

    expect(toggles).toHaveLength(0);

    engine.stop();
  });

  test('fires a prompt shortcut through the same matcher', async () => {
    const inserted: string[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [],
      getHotkeys: () => [],
      getPromptShortcuts: () => [
        {
          id: 'prompt-1',
          name: 'Test prompt',
          content: 'Prompt content',
          keyboardShortcut: 'Ctrl+Shift+P',
          createdAt: 0,
        },
      ],
      onPromptShortcut: (content) => inserted.push(content),
    });
    engine.start();

    press('p', { ctrlKey: true, shiftKey: true }, document.body);
    await settle();

    expect(inserted).toEqual(['Prompt content']);

    engine.stop();
  });
});
