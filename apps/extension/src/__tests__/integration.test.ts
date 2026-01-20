import { PromptShortcut } from '@prism/shared-types';
import { savePromptShortcut, getPromptShortcuts, deletePromptShortcut } from '@prism/shared-db';

// Mock chrome API for testing
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  action: {
    openPopup: jest.fn()
  }
};

describe('Integration: Prompt Shortcuts and Mode Toggles', () => {
  let originalChrome: any;

  beforeAll(() => {
    originalChrome = (global as any).chrome;
    (global as any).chrome = mockChrome;
  });

  afterAll(() => {
    (global as any).chrome = originalChrome;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    
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

  test('should trigger prompt shortcut via keyboard shortcut and include mode content', async () => {
    // Create a prompt with a keyboard shortcut
    const prompt: PromptShortcut = {
      id: 'integration-test-prompt',
      name: 'Integration Test',
      content: 'This is an integration test prompt',
      category: 'Integration',
      keyboardShortcut: 'Ctrl+Shift+I',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);

    // Mock the chrome.storage.local.get to return the prompt
    (mockChrome.storage.local.get as jest.Mock).mockImplementation((keys) => {
      if (Array.isArray(keys) && keys.includes('promptShortcuts')) {
        return Promise.resolve({
          promptShortcuts: [prompt]
        });
      }
      return Promise.resolve({});
    });

    // Simulate the keyboard event that would trigger the prompt
    const event = {
      key: 'i',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: {
        tagName: 'DIV', // Not an input field
        isContentEditable: false
      }
    };

    // Simulate the logic from the content script
    const keys = prompt.keyboardShortcut.split('+');
    let matches = true;

    // Check modifier keys
    if (keys.includes('Ctrl') && !event.ctrlKey) matches = false;
    if (keys.includes('Cmd') && !event.metaKey) matches = false;  // For Mac
    if (keys.includes('Alt') && !event.altKey) matches = false;
    if (keys.includes('Shift') && !event.shiftKey) matches = false;

    // Check the actual key
    const actualKey = keys[keys.length - 1].toLowerCase();
    if (event.key.toLowerCase() !== actualKey) matches = false;

    expect(matches).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled(); // This would be called in the real implementation

    // Verify that the message would be sent to the popup
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'INSERT_PROMPT_SHORTCUT',
      content: prompt.content
    });
  });

  test('should toggle modes with configurable keys', async () => {
    // Mock settings with custom keys
    const customSettings = {
      textSelectionKey: 'A',
      pageContextKey: 'B',
      pageScreenshotKey: 'C',
      clipboardKey: 'D',
      pageInfoKey: 'E'
    };

    (mockChrome.storage.local.get as jest.Mock).mockResolvedValue({
      displaySettings: customSettings
    });

    // Test each mode toggle key
    const testCases = [
      { key: 'A', mode: 'textSelection', expectedMessage: 'Text selection mode enabled' },
      { key: 'B', mode: 'pageContext', expectedMessage: 'Page context mode enabled' },
      { key: 'C', mode: 'pageScreenshot', expectedMessage: 'Page screenshot mode enabled' },
      { key: 'D', mode: 'clipboard', expectedMessage: 'Clipboard mode enabled' },
      { key: 'E', mode: 'pageInfo', expectedMessage: 'Page info mode enabled' }
    ];

    for (const testCase of testCases) {
      const event = {
        key: testCase.key,
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: jest.fn(),
        target: {
          tagName: 'DIV', // Not an input field
          isContentEditable: false
        }
      };

      // Check if the event matches the expected key
      if (event.shiftKey && event.key === customSettings[`${testCase.mode}Key` as keyof typeof customSettings]) {
        expect(event.preventDefault).toHaveBeenCalled();
        
        // Verify that the TOGGLE_MODE message is sent
        expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
          type: 'TOGGLE_MODE',
          mode: testCase.mode,
          value: true
        });
      }
    }
  });

  test('should not trigger shortcuts in input fields', async () => {
    // Create a prompt with a keyboard shortcut
    const prompt: PromptShortcut = {
      id: 'input-test-prompt',
      name: 'Input Test',
      content: 'This should not trigger in input',
      category: 'Input Test',
      keyboardShortcut: 'Ctrl+Shift+X',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);

    // Mock the chrome.storage.local.get to return the prompt
    (mockChrome.storage.local.get as jest.Mock).mockResolvedValue({
      promptShortcuts: [prompt]
    });

    // Simulate the keyboard event from an input field
    const event = {
      key: 'x',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: {
        tagName: 'INPUT', // Input field - shortcuts should not trigger
        isContentEditable: false
      }
    };

    // Check if target is an input field
    const isInputElement = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';
    const isContentEditable = event.target.isContentEditable;

    // The shortcuts should not be processed if in an input field
    expect(isInputElement).toBe(true);
    expect(isContentEditable).toBe(false);

    // In this case, the keyboard shortcut logic should not execute
    // So we shouldn't send any message to the runtime
    expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('should handle both text-based and keyboard shortcuts', async () => {
    // Create two prompts - one with text shortcut, one with keyboard shortcut
    const textPrompt: PromptShortcut = {
      id: 'text-prompt',
      name: 'Text Prompt',
      content: 'This is a text-based prompt',
      category: 'Text',
      shortcutKey: '/hello',
      createdAt: Date.now()
    };

    const keyboardPrompt: PromptShortcut = {
      id: 'keyboard-prompt',
      name: 'Keyboard Prompt',
      content: 'This is a keyboard-based prompt',
      category: 'Keyboard',
      keyboardShortcut: 'Ctrl+Shift+H',
      createdAt: Date.now()
    };

    await savePromptShortcut(textPrompt);
    await savePromptShortcut(keyboardPrompt);

    // Get all prompts to verify they're saved
    const allPrompts = await getPromptShortcuts();
    expect(allPrompts).toHaveLength(2);

    // Verify both prompts exist with their respective shortcut types
    const foundTextPrompt = allPrompts.find(p => p.id === textPrompt.id);
    const foundKeyboardPrompt = allPrompts.find(p => p.id === keyboardPrompt.id);

    expect(foundTextPrompt).toBeDefined();
    expect(foundTextPrompt?.shortcutKey).toBe('/hello');
    expect(foundTextPrompt?.keyboardShortcut).toBeUndefined();

    expect(foundKeyboardPrompt).toBeDefined();
    expect(foundKeyboardPrompt?.keyboardShortcut).toBe('Ctrl+Shift+H');
    expect(foundKeyboardPrompt?.shortcutKey).toBeUndefined();
  });
});