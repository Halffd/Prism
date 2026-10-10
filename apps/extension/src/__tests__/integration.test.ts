import type { PromptShortcut } from '@prism/shared-types';
import {
  savePromptShortcut,
  getPromptShortcuts,
  deletePromptShortcut,
} from '@prism/shared-db';

jest.mock('../popup/Popup', () => ({
  Popup: () => null,
}));

const mockSendMessage = jest.fn();
const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();

describe('Integration: Prompt Shortcuts and Mode Toggles', () => {
  beforeAll(async () => {
    (global as any).chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        sendMessage: mockSendMessage,
      },
      storage: {
        local: {
          get: mockStorageGet,
          set: mockStorageSet,
        },
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
        sendMessage: jest.fn().mockResolvedValue({}),
      },
      action: { openPopup: jest.fn() },
    };
    mockStorageGet.mockResolvedValue({});

    // Suppress the floating button and its MutationObserver; they are
    // unrelated to the shortcut handling under test and outlive the test
    // environment.
    localStorage.setItem('prismButtonRemoved', 'true');

    await import('../content/content');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    mockSendMessage.mockClear();
    mockStorageSet.mockClear();
    mockStorageGet.mockReset();
    mockStorageGet.mockResolvedValue({});

    // Clear all prompt shortcuts before each test
    const shortcuts = await getPromptShortcuts();
    for (const shortcut of shortcuts) {
      await deletePromptShortcut(shortcut.id);
    }
  });

  afterEach(async () => {
    // Clear all prompt shortcuts after each test
    const shortcuts = await getPromptShortcuts();
    for (const shortcut of shortcuts) {
      await deletePromptShortcut(shortcut.id);
    }
  });

  const pressKey = (
    init: KeyboardEventInit,
    target: HTMLElement = document.body,
  ) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const withPromptShortcuts = (promptShortcuts: PromptShortcut[]) => {
    mockStorageGet.mockImplementation((keys: string[]) =>
      Promise.resolve(
        keys.includes('promptShortcuts') ? { promptShortcuts } : {},
      ),
    );
  };

  test('inserts a prompt shortcut on its key combination', async () => {
    const prompt: PromptShortcut = {
      id: 'integration-test-prompt',
      name: 'Integration Test',
      content: 'This is an integration test prompt',
      category: 'Integration',
      keyboardShortcut: 'Ctrl+Shift+I',
      createdAt: Date.now(),
    };

    await savePromptShortcut(prompt);
    withPromptShortcuts([prompt]);

    pressKey({ key: 'i', ctrlKey: true, shiftKey: true });
    await settle();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'INSERT_PROMPT_SHORTCUT',
      content: prompt.content,
    });
  });

  test('toggles modes with configurable keys', async () => {
    mockStorageGet.mockImplementation((keys: string[]) =>
      Promise.resolve(
        keys.includes('displaySettings')
          ? {
              displaySettings: {
                textSelectionKey: 'A',
                pageContextKey: 'B',
                pageScreenshotKey: 'C',
                clipboardKey: 'D',
                pageInfoKey: 'E',
              },
            }
          : {},
      ),
    );

    const testCases = [
      { key: 'A', mode: 'textSelection', toast: 'Text selection mode enabled' },
      { key: 'B', mode: 'pageContext', toast: 'Page context mode enabled' },
      {
        key: 'C',
        mode: 'pageScreenshot',
        toast: 'Page screenshot mode enabled',
      },
      { key: 'D', mode: 'clipboard', toast: 'Clipboard mode enabled' },
      { key: 'E', mode: 'pageInfo', toast: 'Page info mode enabled' },
    ];

    for (const testCase of testCases) {
      mockSendMessage.mockClear();
      document.getElementById('prism-toast')?.remove();

      const event = new KeyboardEvent('keydown', {
        key: testCase.key,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      await settle();

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'TOGGLE_MODE',
        mode: testCase.mode,
        value: true,
      });
      expect(document.getElementById('prism-toast')?.textContent).toBe(
        testCase.toast,
      );
      expect(event.defaultPrevented).toBe(true);
    }
  });

  test('does not trigger shortcuts in input fields', async () => {
    const prompt: PromptShortcut = {
      id: 'input-test-prompt',
      name: 'Input Test',
      content: 'This should not trigger in input',
      category: 'Input Test',
      keyboardShortcut: 'Ctrl+Shift+X',
      createdAt: Date.now(),
    };

    await savePromptShortcut(prompt);
    withPromptShortcuts([prompt]);

    const input = document.createElement('input');
    document.body.appendChild(input);

    pressKey({ key: 'x', ctrlKey: true, shiftKey: true }, input);
    await settle();

    expect(mockSendMessage).not.toHaveBeenCalled();

    input.remove();
  });

  test('handles both text-based and keyboard shortcuts', async () => {
    const textPrompt: PromptShortcut = {
      id: 'text-prompt',
      name: 'Text Prompt',
      content: 'This is a text-based prompt',
      category: 'Text',
      shortcutKey: '/hello',
      createdAt: Date.now(),
    };

    const keyboardPrompt: PromptShortcut = {
      id: 'keyboard-prompt',
      name: 'Keyboard Prompt',
      content: 'This is a keyboard-based prompt',
      category: 'Keyboard',
      keyboardShortcut: 'Ctrl+Shift+H',
      createdAt: Date.now(),
    };

    await savePromptShortcut(textPrompt);
    await savePromptShortcut(keyboardPrompt);

    const allPrompts = await getPromptShortcuts();
    expect(allPrompts).toHaveLength(2);

    const foundTextPrompt = allPrompts.find((p) => p.id === textPrompt.id);
    const foundKeyboardPrompt = allPrompts.find(
      (p) => p.id === keyboardPrompt.id,
    );

    expect(foundTextPrompt).toBeDefined();
    expect(foundTextPrompt?.shortcutKey).toBe('/hello');
    expect(foundTextPrompt?.keyboardShortcut).toBeUndefined();

    expect(foundKeyboardPrompt).toBeDefined();
    expect(foundKeyboardPrompt?.keyboardShortcut).toBe('Ctrl+Shift+H');
    expect(foundKeyboardPrompt?.shortcutKey).toBeUndefined();
  });
});
