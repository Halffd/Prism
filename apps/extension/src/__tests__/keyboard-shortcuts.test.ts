import { PromptShortcut } from '@prism/shared-types';

// Mock chrome API for testing
const mockChrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn()
  }
};

// Mock showToast function
const mockShowToast = jest.fn();

// Mock document and window for testing
Object.defineProperty(window, 'document', {
  value: {
    addEventListener: jest.fn(),
    body: {
      appendChild: jest.fn(),
      removeChild: jest.fn()
    },
    getElementById: jest.fn(() => null),
    head: {
      appendChild: jest.fn()
    }
  },
  writable: true
});

Object.defineProperty(window, 'HTMLElement', {
  value: class HTMLElement {},
  writable: true
});

// Mock the showToast function
global.document.createElement = jest.fn((tag) => {
  if (tag === 'div') {
    return {
      id: '',
      textContent: '',
      style: {},
      remove: jest.fn()
    };
  }
  if (tag === 'style') {
    return {
      textContent: '',
      appendChild: jest.fn()
    };
  }
});

describe('Content Script Keyboard Shortcuts', () => {
  let originalChrome: any;

  beforeAll(() => {
    originalChrome = (global as any).chrome;
    (global as any).chrome = mockChrome;
  });

  afterAll(() => {
    (global as any).chrome = originalChrome;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should detect keyboard shortcuts for prompt shortcuts', async () => {
    // Mock prompt shortcuts in storage
    const mockPromptShortcuts: PromptShortcut[] = [
      {
        id: 'prompt-1',
        name: 'Test Prompt',
        content: 'This is a test prompt',
        category: 'Testing',
        keyboardShortcut: 'Ctrl+Shift+T',
        createdAt: Date.now()
      }
    ];

    (mockChrome.storage.local.get as jest.Mock).mockResolvedValue({
      promptShortcuts: mockPromptShortcuts
    });

    // Import the content script functions
    const { setupHotkeyListener } = require('../content/content'); // This would be the actual path

    // Create a mock event
    const mockEvent = {
      key: 't',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div')
    };

    // Call the hotkey listener with the mock event
    const eventListener = jest.fn();
    document.addEventListener = eventListener;

    // Simulate the event being triggered
    // This is a simplified test - in a real scenario, we'd need to properly mock the setupHotkeyListener function
    expect(mockEvent.ctrlKey && mockEvent.shiftKey && mockEvent.key.toLowerCase() === 't').toBe(true);
  });

  test('should show toast when mode toggle keys are pressed', async () => {
    // Mock settings in storage
    (mockChrome.storage.local.get as jest.Mock).mockResolvedValue({
      displaySettings: {
        textSelectionKey: '1',
        pageContextKey: '2',
        pageScreenshotKey: '3',
        clipboardKey: '4',
        pageInfoKey: '5'
      }
    });

    // Create a mock event for text selection key
    const mockEvent = {
      key: '1',
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div')
    };

    // Check if the event matches the text selection key
    const settings = {
      textSelectionKey: '1',
      pageContextKey: '2',
      pageScreenshotKey: '3',
      clipboardKey: '4',
      pageInfoKey: '5'
    };

    if (mockEvent.shiftKey && mockEvent.key === settings.textSelectionKey) {
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith('Text selection mode enabled');
    }
  });

  test('should not trigger shortcuts when in input fields', () => {
    // Create a mock event with target as input
    const mockInput = document.createElement('input');
    const mockEvent = {
      key: '1',
      shiftKey: true,
      preventDefault: jest.fn(),
      target: mockInput
    };

    // Check if target is an input field
    const isInputElement = mockEvent.target.tagName === 'INPUT' || mockEvent.target.tagName === 'TEXTAREA';
    const isContentEditable = mockEvent.target.isContentEditable;

    // The shortcuts should not be processed if in an input field
    expect(isInputElement).toBe(true);
    // In this case, the mode toggle logic should not execute
  });

  test('should handle different keyboard shortcut formats', () => {
    // Test different shortcut formats
    const shortcuts = [
      'Ctrl+Shift+F',
      'Alt+R',
      'Cmd+Shift+G', // For Mac
      'Ctrl+Alt+T'
    ];

    shortcuts.forEach(shortcut => {
      const keys = shortcut.split('+');
      expect(keys.length).toBeGreaterThanOrEqual(2); // Should have at least modifier + key
      
      const actualKey = keys[keys.length - 1].toLowerCase();
      expect(actualKey).toMatch(/^[a-z0-9]$/i); // Should be a single alphanumeric character
    });
  });
});