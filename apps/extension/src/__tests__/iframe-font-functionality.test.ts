const mockSendMessage = jest.fn();
const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();

// The iframe popup mounts the real Popup component, which needs a redux store
// and auth context that are irrelevant to the keyboard handling under test.
jest.mock('../popup/Popup', () => ({
  Popup: () => null,
}));

describe('Iframe and Font Size Functionality', () => {
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
    };
    mockStorageGet.mockResolvedValue({});

    // Suppress the floating button and its MutationObserver; they are
    // unrelated to the keydown handling under test and outlive the test
    // environment.
    localStorage.setItem('prismButtonRemoved', 'true');

    await import('../content/content');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    mockSendMessage.mockClear();
    mockStorageSet.mockClear();
    mockStorageGet.mockReset();
    mockStorageGet.mockResolvedValue({});
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

  // The iframe popup is loaded through a dynamic import inside the keydown
  // handler, so wait for the container to actually appear.
  const waitFor = async (selector: string) => {
    for (let i = 0; i < 100; i++) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };

  test('increases font size on Shift+=', async () => {
    const before = document.documentElement.style.fontSize;

    pressKey({ key: '=', shiftKey: true });
    await settle();

    const after = document.documentElement.style.fontSize;
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before || '32'));
    expect(mockStorageSet).toHaveBeenCalledWith({ fontScale: 1.1 });
  });

  test('decreases font size on Shift+-', async () => {
    const before = parseFloat(document.documentElement.style.fontSize);

    pressKey({ key: '-', shiftKey: true });
    await settle();

    expect(parseFloat(document.documentElement.style.fontSize)).toBeLessThan(
      before,
    );
    expect(mockStorageSet).toHaveBeenCalledWith({ fontScale: 1 });
  });

  test('injects the iframe on the default Ctrl+` shortcut', async () => {
    pressKey({ key: '`', ctrlKey: true });
    expect(await waitFor('#prism-iframe-container')).toBeTruthy();
  });

  test('replaces the existing iframe instead of duplicating it', async () => {
    pressKey({ key: '`', ctrlKey: true });
    expect(await waitFor('#prism-iframe-container')).toBeTruthy();

    pressKey({ key: '`', ctrlKey: true });
    await waitFor('#prism-iframe-container');
    await settle();

    expect(document.querySelectorAll('#prism-iframe-container')).toHaveLength(
      1,
    );
  });

  test('ignores the default shortcut when a custom key is configured', async () => {
    mockStorageGet.mockImplementation((keys: string[]) =>
      Promise.resolve(
        keys.includes('displaySettings')
          ? { displaySettings: { iframeToggleKey: 'j' } }
          : {},
      ),
    );

    pressKey({ key: '`', ctrlKey: true });
    await settle();

    expect(document.getElementById('prism-iframe-container')).toBeNull();

    pressKey({ key: 'j', ctrlKey: true });
    expect(await waitFor('#prism-iframe-container')).toBeTruthy();
  });

  test('does not change font size from inside an input field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const before = document.documentElement.style.fontSize;

    pressKey({ key: '=', shiftKey: true }, input);
    await settle();

    expect(document.documentElement.style.fontSize).toBe(before);
    expect(mockStorageSet).not.toHaveBeenCalled();

    input.remove();
  });

  test('opens the prompt chat iframe with clear and retry controls', async () => {
    for (const key of 'prompt') {
      pressKey({ key });
    }

    const container = await waitFor('#prism-chat-popup-container');
    expect(container).toBeTruthy();

    const shadow = container?.shadowRoot;
    expect(shadow?.querySelector('#prism-chat-iframe')).toBeTruthy();
    expect(shadow?.querySelector('button[title="Clear chat"]')).toBeTruthy();
    expect(
      shadow?.querySelector('button[title="Retry last message"]'),
    ).toBeTruthy();

    // jsdom reports contentWindow as null for iframes inside a shadow root,
    // so the clear/retry postMessage targets are not observable here.
    const closeButton = shadow?.querySelector(
      'button[title="Close iframe"]',
    ) as HTMLButtonElement;
    closeButton.click();
    expect(document.getElementById('prism-chat-popup-container')).toBeNull();
  });
});
