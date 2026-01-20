import { saveChatHistory, loadChatHistory, getChatSessions, deleteChatSession, savePromptShortcut, getPromptShortcuts, deletePromptShortcut } from '@prism/shared-db';
import { Message, ChatSession, PromptShortcut } from '@prism/shared-types';

describe('Local IndexedDB as Primary Storage', () => {
  const testSessionId = 'test-session-' + Date.now();

  beforeEach(async () => {
    // Clean up any existing test data
    try {
      await deleteChatSession(testSessionId);
    } catch (e) {
      // Session might not exist, which is fine
    }
  });

  test('should save and load chat history using IndexedDB', async () => {
    const testMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now()
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now() + 1000
      }
    ];

    // Save to IndexedDB
    await saveChatHistory(testSessionId, testMessages);

    // Load from IndexedDB
    const loadedMessages = await loadChatHistory(testSessionId);

    expect(loadedMessages).toHaveLength(2);
    expect(loadedMessages[0].content).toBe('Hello');
    expect(loadedMessages[1].content).toBe('Hi there!');
  });

  test('should save and retrieve chat sessions using IndexedDB', async () => {
    const testMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Test message',
        timestamp: Date.now()
      }
    ];

    // Save to IndexedDB
    await saveChatHistory(testSessionId, testMessages);

    // Get chat sessions
    const sessions = await getChatSessions();

    // Check if our session exists
    const testSession = sessions.find(session => session.id === testSessionId);
    expect(testSession).toBeDefined();
    expect(testSession?.id).toBe(testSessionId);
  });

  test('should save and load prompt shortcuts using IndexedDB', async () => {
    const testPrompt: PromptShortcut = {
      id: 'test-prompt-' + Date.now(),
      name: 'Test Prompt',
      content: 'This is a test prompt',
      category: 'Testing',
      createdAt: Date.now()
    };

    // Save to IndexedDB
    await savePromptShortcut(testPrompt);

    // Load from IndexedDB
    const loadedPrompts = await getPromptShortcuts();

    expect(loadedPrompts).toHaveLength(1);
    expect(loadedPrompts[0].name).toBe('Test Prompt');
    expect(loadedPrompts[0].content).toBe('This is a test prompt');
  });

  test('should delete chat sessions using IndexedDB', async () => {
    const testMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'To be deleted',
        timestamp: Date.now()
      }
    ];

    // Save to IndexedDB
    await saveChatHistory(testSessionId, testMessages);

    // Verify it exists
    let loadedMessages = await loadChatHistory(testSessionId);
    expect(loadedMessages).toHaveLength(1);

    // Delete the session
    await deleteChatSession(testSessionId);

    // Verify it's gone
    loadedMessages = await loadChatHistory(testSessionId);
    expect(loadedMessages).toHaveLength(0);
  });

  test('should delete prompt shortcuts using IndexedDB', async () => {
    const testPrompt: PromptShortcut = {
      id: 'delete-test-prompt-' + Date.now(),
      name: 'Delete Test',
      content: 'This will be deleted',
      category: 'Testing',
      createdAt: Date.now()
    };

    // Save to IndexedDB
    await savePromptShortcut(testPrompt);

    // Verify it exists
    let loadedPrompts = await getPromptShortcuts();
    expect(loadedPrompts).toHaveLength(1);

    // Delete the prompt
    await deletePromptShortcut(testPrompt.id);

    // Verify it's gone
    loadedPrompts = await getPromptShortcuts();
    expect(loadedPrompts).toHaveLength(0);
  });

  test('should handle multiple concurrent operations on IndexedDB', async () => {
    // Create multiple test prompts
    const prompts: PromptShortcut[] = [
      {
        id: 'concurrent-prompt-1-' + Date.now(),
        name: 'Concurrent 1',
        content: 'Content 1',
        category: 'Concurrent',
        createdAt: Date.now()
      },
      {
        id: 'concurrent-prompt-2-' + Date.now(),
        name: 'Concurrent 2',
        content: 'Content 2',
        category: 'Concurrent',
        createdAt: Date.now() + 1000
      },
      {
        id: 'concurrent-prompt-3-' + Date.now(),
        name: 'Concurrent 3',
        content: 'Content 3',
        category: 'Concurrent',
        createdAt: Date.now() + 2000
      }
    ];

    // Save all prompts concurrently
    await Promise.all(prompts.map(prompt => savePromptShortcut(prompt)));

    // Load all prompts
    const loadedPrompts = await getPromptShortcuts();
    expect(loadedPrompts).toHaveLength(3);

    // Verify all prompts exist
    const promptNames = loadedPrompts.map(p => p.name);
    expect(promptNames).toContain('Concurrent 1');
    expect(promptNames).toContain('Concurrent 2');
    expect(promptNames).toContain('Concurrent 3');
  });
});