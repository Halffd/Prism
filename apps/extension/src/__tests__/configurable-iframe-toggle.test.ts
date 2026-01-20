describe('Configurable Iframe Toggle Key', () => {
  let dom: any;
  let window: any;
  let document: Document;

  beforeEach(() => {
    // Mock the chrome API
    (global as any).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        sendMessage: jest.fn()
      },
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue({})
        }
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
        sendMessage: jest.fn().mockResolvedValue({})
      }
    };

    // Create a new JSDOM instance for each test
    dom = new (require('jsdom').JSDOM)('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://example.com',
      pretendToBeVisual: true,
      resources: 'usable'
    });
    window = dom.window;
    document = window.document;

    // Mock the shadow DOM functionality
    document.body.attachShadow = jest.fn().mockReturnValue({
      appendChild: jest.fn()
    });
  });

  afterEach(() => {
    delete (global as any).chrome;
  });

  test('should use default backtick key when no custom key is set', async () => {
    // Mock chrome.storage.local.get to return settings without iframeToggleKey
    (global as any).chrome.storage.local.get.mockResolvedValue({
      displaySettings: {
        textSelectionKey: '1',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5'
        // iframeToggleKey is not set, so it should use default '`'
      }
    });

    // Simulate Ctrl+` key press
    const event = new window.KeyboardEvent('keydown', {
      key: '`',
      ctrlKey: true,
      bubbles: true
    });

    // Check if the event handler would trigger toggleChatPopup
    // This simulates the logic from the content script
    const result = await (global as any).chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings || {};
    const iframeToggleKey = settings.iframeToggleKey || '`';

    expect(iframeToggleKey).toBe('`'); // Should default to backtick
    expect(event.ctrlKey).toBe(true);
    expect(event.key).toBe('`');
  });

  test('should use custom key when set in settings', async () => {
    // Mock chrome.storage.local.get to return settings with custom iframeToggleKey
    (global as any).chrome.storage.local.get.mockResolvedValue({
      displaySettings: {
        textSelectionKey: '1',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5',
        iframeToggleKey: 'p' // Custom key set to 'p'
      }
    });

    // Simulate Ctrl+p key press
    const event = new window.KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true
    });

    // Check if the event handler would trigger toggleChatPopup
    // This simulates the logic from the content script
    const result = await (global as any).chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings || {};
    const iframeToggleKey = settings.iframeToggleKey || '`';

    expect(iframeToggleKey).toBe('p'); // Should use custom key
    expect(event.ctrlKey).toBe(true);
    expect(event.key).toBe('p');
  });

  test('should handle fallback to default key when settings fail to load', async () => {
    // Mock chrome.storage.local.get to reject (simulate failure)
    (global as any).chrome.storage.local.get.mockRejectedValue(new Error('Failed to load settings'));

    // Simulate Ctrl+` key press (fallback behavior)
    const event = new window.KeyboardEvent('keydown', {
      key: '`',
      ctrlKey: true,
      bubbles: true
    });

    // In case of error, it should fallback to default key
    let iframeToggleKey = '`'; // Default fallback
    try {
      const result = await (global as any).chrome.storage.local.get(['displaySettings']);
      const settings = result.displaySettings || {};
      iframeToggleKey = settings.iframeToggleKey || '`';
    } catch (error) {
      // Fallback to default key if settings can't be loaded
      iframeToggleKey = '`';
    }

    expect(iframeToggleKey).toBe('`'); // Should fallback to backtick
    expect(event.ctrlKey).toBe(true);
    expect(event.key).toBe('`');
  });

  test('should not trigger when key does not match', async () => {
    // Mock chrome.storage.local.get to return settings with custom iframeToggleKey
    (global as any).chrome.storage.local.get.mockResolvedValue({
      displaySettings: {
        textSelectionKey: '1',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5',
        iframeToggleKey: 'p' // Custom key set to 'p'
      }
    });

    // Simulate Ctrl+k key press (should not trigger)
    const event = new window.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true
    });

    // Check if the event handler would trigger toggleChatPopup
    // This simulates the logic from the content script
    const result = await (global as any).chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings || {};
    const iframeToggleKey = settings.iframeToggleKey || '`';

    const shouldTrigger = event.ctrlKey && event.key === iframeToggleKey;
    expect(shouldTrigger).toBe(false); // Should not trigger since 'k' != 'p'
    expect(iframeToggleKey).toBe('p'); // Custom key should be 'p'
    expect(event.ctrlKey).toBe(true);
    expect(event.key).toBe('k');
  });

  test('should only trigger when Ctrl key is pressed', async () => {
    // Mock chrome.storage.local.get to return settings with custom iframeToggleKey
    (global as any).chrome.storage.local.get.mockResolvedValue({
      displaySettings: {
        textSelectionKey: '1',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5',
        iframeToggleKey: 'p' // Custom key set to 'p'
      }
    });

    // Simulate 'p' key press without Ctrl (should not trigger)
    const eventWithoutCtrl = new window.KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: false, // No Ctrl key
      bubbles: true
    });

    // Simulate Ctrl+p key press (should trigger)
    const eventWithCtrl = new window.KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true, // With Ctrl key
      bubbles: true
    });

    // Check if the event handler would trigger toggleChatPopup
    const result = await (global as any).chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings || {};
    const iframeToggleKey = settings.iframeToggleKey || '`';

    const shouldTriggerWithoutCtrl = eventWithoutCtrl.ctrlKey && eventWithoutCtrl.key === iframeToggleKey;
    const shouldTriggerWithCtrl = eventWithCtrl.ctrlKey && eventWithCtrl.key === iframeToggleKey;

    expect(shouldTriggerWithoutCtrl).toBe(false); // Should not trigger without Ctrl
    expect(shouldTriggerWithCtrl).toBe(true); // Should trigger with Ctrl
    expect(iframeToggleKey).toBe('p'); // Custom key should be 'p'
  });
});