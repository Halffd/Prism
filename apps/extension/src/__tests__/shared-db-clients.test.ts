import type { Message } from '@prism/shared-types';
import type * as SharedDb from '@prism/shared-db';

/**
 * The chat tables and the settings tables live in the same IndexedDB
 * database, but they are reached through two different clients: the raw
 * `idb` client and the Dexie client.
 *
 * When one of them holds the database open, the other must still be able to
 * work. These tests use both clients against the same database, so a
 * connection that blocks the other shows up as a hang.
 */
describe('Shared database clients', () => {
  const sessionId = `session_${Date.now()}`;
  const settingKey = `setting_${Date.now()}`;
  const characterId = `character_${Date.now()}`;

  const messages: Message[] = [
    {
      id: 'm1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    },
  ];

  /**
   * The database module.
   *
   * It is loaded on demand: the extension loads it lazily, and a static
   * import would break the boundary that the build enforces.
   */
  let db: typeof SharedDb;

  beforeAll(async () => {
    db = await import('@prism/shared-db');
  });

  afterAll(async () => {
    await db.clearAllData();
  });

  it('stores chat history and reads it back', async () => {
    await db.saveChatHistory(sessionId, messages);
    const history = await db.loadChatHistory(sessionId);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('hello');
  });

  it('stores a setting while the chat tables are in use', async () => {
    await db.saveChatHistory(sessionId, messages);
    await db.saveSetting(settingKey, { enabled: true });
    const value = await db.getSetting<{ enabled: boolean }>(settingKey);
    expect(value).toEqual({ enabled: true });
  });

  it('stores a character while the chat tables are in use', async () => {
    await db.saveChatHistory(sessionId, messages);
    await db.saveCharacter({
      id: characterId,
      name: 'Test Character',
      description: 'A character',
      personality: 'friendly',
      scenario: 'here',
      firstMes: 'hi',
      mesExample: '',
      creatorNotes: '',
      systemPrompt: '',
      postHistoryInstructions: '',
      alternateGreetings: [],
      tags: [],
      creator: 'test',
      characterVersion: '1',
      extensions: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const character = await db.getCharacter(characterId);
    expect(character?.name).toBe('Test Character');
  });

  it('lists the chat sessions', async () => {
    await db.saveChatHistory(sessionId, messages);
    const sessions = await db.getChatSessions();
    expect(sessions.some((session) => session.id === sessionId)).toBe(true);
  });
});
