jest.mock('../popup/Popup', () => ({
  Popup: () => null,
}));

// Recorded before the content script is imported so the capture-phase
// registrations it makes at module scope can be inspected.
const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

const mockStorageGet = jest.fn().mockResolvedValue({});
const mockStorageSet = jest.fn();

describe('Capture Phase Keyboard Event Handling', () => {
  beforeAll(async () => {
    (global as any).chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        sendMessage: jest.fn(),
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

    // Suppress the floating button and its MutationObserver; they are
    // unrelated to the keydown handling under test and outlive the test
    // environment.
    localStorage.setItem('prismButtonRemoved', 'true');

    await import('../content/content');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    document.getElementById('prism-chat-popup-container')?.remove();
    document.getElementById('prism-iframe-container')?.remove();
    // The sequence buffers live at module scope and persist between tests, so
    // send a key that breaks any partial sequence before the next test.
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F',
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const waitFor = async (selector: string) => {
    for (let i = 0; i < 100; i++) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };

  const pressKey = (
    key: string,
    target: HTMLElement = document.body,
    init: KeyboardEventInit = {},
  ) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    // Record whether the page saw the key before the capture-phase handlers ran.
    let reachedBody = false;
    target.addEventListener('keydown', () => {
      reachedBody = true;
    });
    target.dispatchEvent(event);
    return { event, didReachBody: () => reachedBody };
  };

  test('registers keydown listeners in the capture phase', () => {
    const keydownRegistrations = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === 'keydown',
    );
    expect(keydownRegistrations.length).toBeGreaterThan(0);
    expect(keydownRegistrations.some(([, , options]) => options === true)).toBe(
      true,
    );
  });

  test('opens the chat iframe when /prompt is typed in an input field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    for (const key of '/prompt') {
      pressKey(key, input);
    }

    expect(await waitFor('#prism-chat-popup-container')).toBeTruthy();
    // The sequence is consumed rather than typed into the field.
    expect(input.value).toBe('');

    input.remove();
  });

  test('opens the chat iframe when "prompt" is typed anywhere on the page', async () => {
    for (const key of 'prompt') {
      pressKey(key);
    }

    expect(await waitFor('#prism-chat-popup-container')).toBeTruthy();
  });

  test('blocks propagation once a partial sequence is typed', () => {
    // The first key of a sequence cannot be recognised yet, so it reaches the
    // page; every following partial key is swallowed.
    expect(pressKey('p').didReachBody()).toBe(true);
    expect(pressKey('r').didReachBody()).toBe(false);

    // A key that breaks the sequence lets the page see it again.
    expect(pressKey('x').didReachBody()).toBe(true);
  });

  test('prevents the default action of the final sequence character', async () => {
    const lastEvents: KeyboardEvent[] = [];
    document.addEventListener(
      'keydown',
      (event) => {
        lastEvents.push(event as KeyboardEvent);
      },
      true,
    );

    for (const key of 'prompt') {
      pressKey(key);
    }
    await waitFor('#prism-chat-popup-container');

    const finalEvent = lastEvents[lastEvents.length - 1];
    expect(finalEvent.key).toBe('t');
    expect(finalEvent.defaultPrevented).toBe(true);
  });

  test('does not open the chat iframe for an unrelated sequence', async () => {
    for (const key of 'prox') {
      pressKey(key);
    }
    await settle();

    expect(document.getElementById('prism-chat-popup-container')).toBeNull();
  });
});
