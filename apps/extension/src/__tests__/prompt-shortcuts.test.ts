import { PromptShortcut } from '@prism/shared-types';
import { savePromptShortcut, getPromptShortcuts, deletePromptShortcut } from '@prism/shared-db';

describe('Prompt Shortcuts Functionality', () => {
  beforeEach(async () => {
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

  test('should save and retrieve a prompt shortcut', async () => {
    const prompt: PromptShortcut = {
      id: 'test-prompt-1',
      name: 'Test Prompt',
      content: 'This is a test prompt',
      category: 'Testing',
      shortcutKey: '/test',
      keyboardShortcut: 'Ctrl+Shift+T',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);
    const retrievedPrompts = await getPromptShortcuts();

    expect(retrievedPrompts).toHaveLength(1);
    expect(retrievedPrompts[0]).toEqual(prompt);
  });

  test('should find a prompt shortcut by its shortcut key', async () => {
    const prompt: PromptShortcut = {
      id: 'test-prompt-2',
      name: 'Test Prompt 2',
      content: 'This is another test prompt',
      category: 'Testing',
      shortcutKey: '/hello',
      keyboardShortcut: 'Ctrl+Shift+H',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);
    const allPrompts = await getPromptShortcuts();
    const foundPrompt = allPrompts.find(p => p.shortcutKey === '/hello');

    expect(foundPrompt).toBeDefined();
    expect(foundPrompt?.content).toBe('This is another test prompt');
  });

  test('should delete a prompt shortcut', async () => {
    const prompt: PromptShortcut = {
      id: 'test-prompt-3',
      name: 'Test Prompt 3',
      content: 'This prompt will be deleted',
      category: 'Testing',
      shortcutKey: '/delete',
      keyboardShortcut: 'Ctrl+Shift+D',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);
    let allPrompts = await getPromptShortcuts();
    expect(allPrompts).toHaveLength(1);

    await deletePromptShortcut(prompt.id);
    allPrompts = await getPromptShortcuts();
    expect(allPrompts).toHaveLength(0);
  });

  test('should update an existing prompt shortcut', async () => {
    const prompt: PromptShortcut = {
      id: 'test-prompt-4',
      name: 'Original Name',
      content: 'Original content',
      category: 'Testing',
      shortcutKey: '/update',
      keyboardShortcut: 'Ctrl+Shift+U',
      createdAt: Date.now()
    };

    await savePromptShortcut(prompt);

    // Update the prompt by saving it again with new content
    const updatedPrompt: PromptShortcut = {
      ...prompt,
      name: 'Updated Name',
      content: 'Updated content'
    };

    await savePromptShortcut(updatedPrompt);
    const allPrompts = await getPromptShortcuts();
    
    expect(allPrompts).toHaveLength(1);
    expect(allPrompts[0].name).toBe('Updated Name');
    expect(allPrompts[0].content).toBe('Updated content');
  });

  test('should handle multiple prompt shortcuts', async () => {
    const prompts: PromptShortcut[] = [
      {
        id: 'test-prompt-5',
        name: 'Prompt 1',
        content: 'Content 1',
        category: 'Testing',
        shortcutKey: '/one',
        keyboardShortcut: 'Ctrl+Shift+1',
        createdAt: Date.now()
      },
      {
        id: 'test-prompt-6',
        name: 'Prompt 2',
        content: 'Content 2',
        category: 'Testing',
        shortcutKey: '/two',
        keyboardShortcut: 'Ctrl+Shift+2',
        createdAt: Date.now()
      },
      {
        id: 'test-prompt-7',
        name: 'Prompt 3',
        content: 'Content 3',
        category: 'Other',
        shortcutKey: '/three',
        keyboardShortcut: 'Ctrl+Shift+3',
        createdAt: Date.now()
      }
    ];

    for (const prompt of prompts) {
      await savePromptShortcut(prompt);
    }

    const allPrompts = await getPromptShortcuts();
    expect(allPrompts).toHaveLength(3);

    const testingCategoryPrompts = await getPromptShortcuts('Testing');
    expect(testingCategoryPrompts).toHaveLength(2);
  });
});