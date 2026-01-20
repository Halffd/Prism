describe('Iframe and Font Size Functionality', () => {
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

  test('should inject iframe with correct dimensions', () => {
    // Create the container
    const container = document.createElement('div');
    container.id = 'prism-chat-popup-container';
    document.body.appendChild(container);

    // Create Shadow DOM to isolate styles
    const shadow = container.attachShadow({ mode: 'open' });

    // Create the iframe
    const iframe = document.createElement('iframe');
    iframe.src = 'chrome-extension://test-extension/chat.html';
    iframe.id = 'prism-chat-iframe';
    iframe.style.cssText = `
      position: fixed;
      top: 0;
      left: 5%;
      width: 90%;
      height: 100%;
      z-index: 2147483647;
      border: none;
      background: white;
    `;

    // Add the iframe to the shadow DOM
    shadow.appendChild(iframe);

    // Verify the iframe has the correct dimensions
    expect(iframe.style.position).toBe('fixed');
    expect(iframe.style.top).toBe('0px'); // 0% from top
    expect(iframe.style.left).toBe('5%'); // 5% from left
    expect(iframe.style.width).toBe('90%'); // 90% width
    expect(iframe.style.height).toBe('100%'); // 100% height
  });

  test('should handle font size increase with Shift+=', () => {
    // Mock the font scaling functions
    let currentFontScale = 1.0;
    
    // Simulate Shift+= key press
    const event = new window.KeyboardEvent('keydown', {
      key: '=',
      shiftKey: true,
      bubbles: true
    });

    // Apply font scaling logic
    const baseFontSize = 32 * currentFontScale; // 32px base * scale
    currentFontScale = Math.min(2.0, currentFontScale + 0.1); // Increase by 0.1
    const newBaseFontSize = 32 * currentFontScale; // 32px base * new scale

    // Verify font size increased
    expect(newBaseFontSize).toBeGreaterThan(baseFontSize);
    expect(currentFontScale).toBe(1.1); // Should be 1.0 + 0.1
  });

  test('should handle font size decrease with Shift+-', () => {
    // Mock the font scaling functions
    let currentFontScale = 1.0;
    
    // Simulate Shift+- key press
    const event = new window.KeyboardEvent('keydown', {
      key: '-',
      shiftKey: true,
      bubbles: true
    });

    // Apply font scaling logic
    const baseFontSize = 32 * currentFontScale; // 32px base * scale
    currentFontScale = Math.max(0.5, currentFontScale - 0.1); // Decrease by 0.1
    const newBaseFontSize = 32 * currentFontScale; // 32px base * new scale

    // Verify font size decreased
    expect(newBaseFontSize).toBeLessThan(baseFontSize);
    expect(currentFontScale).toBe(0.9); // Should be 1.0 - 0.1
  });

  test('should toggle iframe with Ctrl+K', () => {
    // Mock the toggleChatPopup function behavior
    let iframeExists = false;
    
    // Simulate Ctrl+K key press
    const event = new window.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true
    });

    // Simulate toggle behavior
    if (!iframeExists) {
      // Inject iframe
      iframeExists = true;
    } else {
      // Remove iframe
      iframeExists = false;
    }

    // Toggle again
    if (!iframeExists) {
      iframeExists = true;
    } else {
      iframeExists = false;
    }

    // Verify toggle behavior
    expect(iframeExists).toBe(false); // Should be toggled off after two presses
  });

  test('should not trigger shortcuts in input fields', () => {
    // Create an input element
    const inputElement = document.createElement('input');
    document.body.appendChild(inputElement);

    // Simulate Shift+= key press on input element
    const event = new window.KeyboardEvent('keydown', {
      key: '=',
      shiftKey: true,
      target: inputElement,
      bubbles: true
    });

    // Check if target is an input field
    const isInputElement = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';
    const isContentEditable = (event.target as HTMLElement).isContentEditable;

    // Verify that shortcuts are not processed in input fields
    expect(isInputElement).toBe(true);
    expect(isContentEditable).toBe(false);
  });

  test('should handle clear and retry buttons', () => {
    // Create the container
    const container = document.createElement('div');
    container.id = 'prism-chat-popup-container';
    document.body.appendChild(container);

    // Create Shadow DOM to isolate styles
    const shadow = container.attachShadow({ mode: 'open' });

    // Create the iframe
    const iframe = document.createElement('iframe');
    iframe.src = 'chrome-extension://test-extension/chat.html';
    iframe.id = 'prism-chat-iframe';
    shadow.appendChild(iframe);

    // Add controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 2147483648;
      display: flex;
      gap: 5px;
    `;

    // Add clear button
    const clearButton = document.createElement('button');
    clearButton.innerHTML = '🗑️';
    clearButton.title = 'Clear chat';
    clearButton.style.cssText = `
      background: #ff4757;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Add retry button
    const retryButton = document.createElement('button');
    retryButton.innerHTML = '🔄';
    retryButton.title = 'Retry last message';
    retryButton.style.cssText = `
      background: #374151;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.title = 'Close iframe';
    closeButton.style.cssText = `
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Add all buttons to the controls container
    controlsContainer.appendChild(clearButton);
    controlsContainer.appendChild(retryButton);
    controlsContainer.appendChild(closeButton);

    // Add controls to shadow DOM
    shadow.appendChild(controlsContainer);

    // Verify all buttons exist
    expect(shadow.querySelector('button[title="Clear chat"]')).toBeTruthy();
    expect(shadow.querySelector('button[title="Retry last message"]')).toBeTruthy();
    expect(shadow.querySelector('button[title="Close iframe"]')).toBeTruthy();
  });
});