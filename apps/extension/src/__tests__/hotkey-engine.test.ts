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

  /**
   * Dispatches a keydown the way a browser does.
   *
   * A browser inserts the character into the field after the keydown
   * handlers run, unless the handler called `preventDefault()`. The test
   * mirrors that: it inserts the character only when the event was not
   * prevented.
   */
  const press = (
    key: string,
    init: KeyboardEventInit = {},
    target: HTMLElement = input,
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });

    target.dispatchEvent(event);

    if (!event.defaultPrevented && key.length === 1) {
      const field = target as HTMLInputElement;
      if (typeof field.selectionStart === 'number') {
        const caret = field.selectionStart;
        field.value =
          field.value.slice(0, caret) + key + field.value.slice(caret);
        field.setSelectionRange(caret + 1, caret + 1);
      }
    }
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

    // The text is left alone because it is not a trigger.
    expect(input.value).toBe('hello');

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

  test('expands a snippet through its own keyboard binding', async () => {
    const expanded: Snippet[] = [];
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({ keyboardShortcuts: ['Ctrl+Shift+G'] })],
      getHotkeys: () => [],
      onSnippetExpanded: (s) => expanded.push(s),
    });
    engine.start();

    press('g', { ctrlKey: true, shiftKey: true });
    await settle();

    expect(input.value).toBe('Fixed text');
    expect(expanded).toHaveLength(1);

    engine.stop();
  });

  test('appends a shortcut-expanded snippet at the caret', async () => {
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({ keyboardShortcuts: ['Ctrl+Shift+G'] })],
      getHotkeys: () => [],
    });
    engine.start();

    input.value = 'before ';
    input.setSelectionRange(input.value.length, input.value.length);

    press('g', { ctrlKey: true, shiftKey: true });
    await settle();

    expect(input.value).toBe('before Fixed text');

    engine.stop();
  });

  test('does not expand a snippet when its binding modifier is missing', async () => {
    const engine = createHotkeyEngine({
      getSnippets: () => [snippet({ keyboardShortcuts: ['Ctrl+Shift+G'] })],
      getHotkeys: () => [],
    });
    engine.start();

    press('g', { ctrlKey: true });
    await settle();

    // The character was typed normally, because the binding did not match.
    expect(input.value).toBe('g');

    engine.stop();
  });
});
