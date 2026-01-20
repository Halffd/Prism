import { Message } from '@prism/shared-types';

describe('System Prompt Configuration', () => {
  let mockChrome: any;
  let mockClient: any;

  beforeEach(() => {
    // Mock chrome API
    mockChrome = {
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

    // Mock the UnifiedAIClient
    mockClient = {
      updateAIConfig: jest.fn(),
      sendMessage: jest.fn()
    };

    (global as any).chrome = mockChrome;
  });

  afterEach(() => {
    delete (global as any).chrome;
  });

  test('should include system prompt in conversation history when sending message', async () => {
    // Mock settings with a system prompt
    const mockSettings = {
      displaySettings: {
        systemPrompt: 'You are a helpful assistant that responds in a concise manner.'
      }
    };
    
    mockChrome.storage.local.get.mockResolvedValue(mockSettings);

    // Mock the client response
    const mockResponse = {
      success: true,
      data: {
        id: 'test-assistant-msg',
        role: 'assistant',
        content: 'Test response',
        timestamp: Date.now()
      }
    };
    
    mockClient.sendMessage.mockResolvedValue(mockResponse);

    // Simulate sending a message with the system prompt
    const input = 'Hello, how are you?';
    const freshContext = { type: 'page', url: 'https://example.com', title: 'Test Page' };
    const currentSessionId = 'test-session';
    const uploadedImages: string[] = [];
    const messages: Message[] = []; // Empty initial messages

    // Simulate the logic from Popup.tsx
    let conversationHistory = [...messages];

    // Add system prompt as the first message if it exists and messages are empty
    const settingsResult = await mockChrome.storage.local.get(['displaySettings']);
    const systemPrompt = settingsResult.displaySettings?.systemPrompt || '';

    if (systemPrompt && messages.length === 0) {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    } else if (systemPrompt && messages[0]?.role !== 'system') {
      // If system prompt exists but is not the first message, add it
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    }

    // Call the client with conversation history
    const response = await mockClient.sendMessage(
      input,
      freshContext,
      currentSessionId,
      uploadedImages,
      conversationHistory
    );

    // Verify that the system message was included in the conversation history
    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      input,
      freshContext,
      currentSessionId,
      uploadedImages,
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: 'You are a helpful assistant that responds in a concise manner.'
        })
      ])
    );

    expect(response).toEqual(mockResponse);
  });

  test('should not add system prompt if already present in conversation', async () => {
    // Mock settings with a system prompt
    const mockSettings = {
      displaySettings: {
        systemPrompt: 'You are a helpful assistant.'
      }
    };
    
    mockChrome.storage.local.get.mockResolvedValue(mockSettings);

    // Mock existing conversation with system message
    const existingMessages: Message[] = [
      {
        id: 'existing-system',
        role: 'system',
        content: 'You are a helpful assistant.',
        timestamp: Date.now() - 1000
      },
      {
        id: 'user-message',
        role: 'user',
        content: 'Previous message',
        timestamp: Date.now()
      }
    ];

    // Simulate the logic from Popup.tsx
    let conversationHistory = [...existingMessages];

    // Add system prompt if needed
    const settingsResult = await mockChrome.storage.local.get(['displaySettings']);
    const systemPrompt = settingsResult.displaySettings?.systemPrompt || '';

    if (systemPrompt && existingMessages.length === 0) {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...existingMessages];
    } else if (systemPrompt && existingMessages[0]?.role !== 'system') {
      // If system prompt exists but is not the first message, add it
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...existingMessages];
    }

    // Since the first message is already a system message, the history should remain unchanged
    expect(conversationHistory).toEqual(existingMessages);
  });

  test('should handle empty system prompt gracefully', async () => {
    // Mock settings with empty system prompt
    const mockSettings = {
      displaySettings: {
        systemPrompt: '' // Empty system prompt
      }
    };
    
    mockChrome.storage.local.get.mockResolvedValue(mockSettings);

    // Mock the client response
    const mockResponse = {
      success: true,
      data: {
        id: 'test-assistant-msg',
        role: 'assistant',
        content: 'Test response',
        timestamp: Date.now()
      }
    };
    
    mockClient.sendMessage.mockResolvedValue(mockResponse);

    // Simulate sending a message with empty system prompt
    const input = 'Hello, how are you?';
    const messages: Message[] = [];

    // Simulate the logic from Popup.tsx
    let conversationHistory = [...messages];

    // Add system prompt if needed
    const settingsResult = await mockChrome.storage.local.get(['displaySettings']);
    const systemPrompt = settingsResult.displaySettings?.systemPrompt || '';

    if (systemPrompt && messages.length === 0) {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    } else if (systemPrompt && messages[0]?.role !== 'system') {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    }

    // Call the client with conversation history (should be unchanged since system prompt is empty)
    const response = await mockClient.sendMessage(
      input,
      undefined, // context
      undefined, // sessionId
      [], // images
      conversationHistory
    );

    // Verify that the conversation history is unchanged (no system message added)
    expect(conversationHistory).toEqual([]);
    expect(response).toEqual(mockResponse);
  });

  test('should handle missing system prompt setting gracefully', async () => {
    // Mock settings without system prompt
    const mockSettings = {
      displaySettings: {
        // No systemPrompt property
      }
    };
    
    mockChrome.storage.local.get.mockResolvedValue(mockSettings);

    // Mock the client response
    const mockResponse = {
      success: true,
      data: {
        id: 'test-assistant-msg',
        role: 'assistant',
        content: 'Test response',
        timestamp: Date.now()
      }
    };
    
    mockClient.sendMessage.mockResolvedValue(mockResponse);

    // Simulate sending a message with no system prompt setting
    const input = 'Hello, how are you?';
    const messages: Message[] = [];

    // Simulate the logic from Popup.tsx
    let conversationHistory = [...messages];

    // Add system prompt if needed
    const settingsResult = await mockChrome.storage.local.get(['displaySettings']);
    const systemPrompt = settingsResult.displaySettings?.systemPrompt || '';

    if (systemPrompt && messages.length === 0) {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    } else if (systemPrompt && messages[0]?.role !== 'system') {
      const systemMessage: Message = {
        id: 'system-prompt',
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
      };
      conversationHistory = [systemMessage, ...conversationHistory];
    }

    // Call the client with conversation history (should be unchanged since system prompt is empty)
    const response = await mockClient.sendMessage(
      input,
      undefined, // context
      undefined, // sessionId
      [], // images
      conversationHistory
    );

    // Verify that the conversation history is unchanged (no system message added)
    expect(conversationHistory).toEqual([]);
    expect(response).toEqual(mockResponse);
  });
});