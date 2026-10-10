import type { PromptShortcut } from '@prism/shared-types';

const mockSendMessage = jest.fn();
const mockStorageGet = jest.fn();

describe('Content Script Keyboard Shortcuts', () => {
  beforeAll(async () => {
    (global as any).chrome.runtime.sendMessage = mockSendMessage;
    (global as any).chrome.storage.local.get = mockStorageGet;
    mockStorageGet.mockResolvedValue({});

    // Suppress the floating button and its MutationObserver; they are
    // unrelated to the keydown handling under test and outlive the test
    // environment.
    localStorage.setItem('prismButtonRemoved', 'true');

    // Importing the content script registers the capture-phase keydown
    // listener under test. Settings are read from chrome.storage.local on
    // every keydown, so tests only need to change the storage mock.
    await import('../content/content');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    mockSendMessage.mockClear();
    mockStorageGet.mockReset();
    mockStorageGet.mockResolvedValue({});
    document.getElementById('prism-toast')?.remove();
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

  test('toggles text selection mode on Shift+1', async () => {
    pressKey({ key: '1', shiftKey: true });
    await settle();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'TOGGLE_MODE',
      mode: 'textSelection',
      value: true,
    });
    expect(document.getElementById('prism-toast')?.textContent).toBe(
      'Text selection mode enabled',
    );
  });

  test('toggles page context mode on Shift+2', async () => {
    pressKey({ key: '2', shiftKey: true });
    await settle();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'TOGGLE_MODE',
      mode: 'pageContext',
      value: true,
    });
    expect(document.getElementById('prism-toast')?.textContent).toBe(
      'Page context mode enabled',
    );
  });

  test('respects custom mode toggle keys from settings', async () => {
    mockStorageGet.mockResolvedValue({
      displaySettings: {
        textSelectionKey: 'Q',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5',
      },
    });

    pressKey({ key: 'Q', shiftKey: true });
    await settle();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'TOGGLE_MODE',
      mode: 'textSelection',
      value: true,
    });
  });

  test('inserts a registered prompt shortcut on its key combination', async () => {
    const promptShortcuts: PromptShortcut[] = [
      {
        id: 'prompt-1',
        name: 'Test Prompt',
        content: 'This is a test prompt',
        category: 'Testing',
        keyboardShortcut: 'Ctrl+Shift+T',
        createdAt: Date.now(),
      },
    ];
    mockStorageGet.mockImplementation((keys: string[]) =>
      Promise.resolve(
        keys.includes('promptShortcuts') ? { promptShortcuts } : {},
      ),
    );

    pressKey({ key: 't', ctrlKey: true, shiftKey: true });
    await settle();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'INSERT_PROMPT_SHORTCUT',
      content: 'This is a test prompt',
    });
  });

  test('does not fire shortcuts when focus is in an input field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    pressKey({ key: '1', shiftKey: true }, input);
    await settle();

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('prism-toast')).toBeNull();

    input.remove();
  });

  test('does not fire shortcuts in contenteditable elements', async () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    // jsdom does not implement isContentEditable, which the content script
    // checks, so mirror what a browser reports for contenteditable elements.
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    document.body.appendChild(editable);

    pressKey({ key: '1', shiftKey: true }, editable);
    await settle();

    expect(mockSendMessage).not.toHaveBeenCalled();

    editable.remove();
  });
});
