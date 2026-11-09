// Extension sync wrapper tests: export shape, import application, clear.

import {
  exportData,
  importData,
  clearData,
  parseImport,
  downloadEnvelope,
} from '../chat/sync';
import {
  getChatSessions,
  loadChatHistory,
  saveChatHistory,
  getPromptShortcuts,
  savePromptShortcut,
  deleteChatSession,
  deletePromptShortcut,
} from '@prism/shared-db';

jest.mock('@prism/shared-db', () => ({
  getChatSessions: jest.fn(),
  loadChatHistory: jest.fn(),
  saveChatHistory: jest.fn(),
  getPromptShortcuts: jest.fn(),
  savePromptShortcut: jest.fn(),
  deleteChatSession: jest.fn(),
  deletePromptShortcut: jest.fn(),
}));

const mockDb = {
  getChatSessions: getChatSessions as jest.Mock,
  loadChatHistory: loadChatHistory as jest.Mock,
  saveChatHistory: saveChatHistory as jest.Mock,
  getPromptShortcuts: getPromptShortcuts as jest.Mock,
  savePromptShortcut: savePromptShortcut as jest.Mock,
  deleteChatSession: deleteChatSession as jest.Mock,
  deletePromptShortcut: deletePromptShortcut as jest.Mock,
};

describe('extension sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exportData', () => {
    it('builds an envelope from sessions + prompts + settings', async () => {
      mockDb.getChatSessions.mockResolvedValue([
        { id: 'c1', title: 'Chat 1', createdAt: 1, updatedAt: 2 },
      ]);
      mockDb.loadChatHistory.mockResolvedValue([
        { id: 'm1', role: 'user', content: 'hi', timestamp: 10 },
        { id: 'm2', role: 'assistant', content: 'hello', timestamp: 20 },
      ]);
      mockDb.getPromptShortcuts.mockResolvedValue([
        { id: 'p1', name: 'review', content: 'review this', category: 'code', createdAt: 5 },
      ]);

      const env = await exportData(() => ({ defaultProvider: 'openai', model: 'gpt-4o' }));

      expect(env.app).toBe('prism');
      expect(env.conversations).toHaveLength(1);
      expect(env.conversations[0].id).toBe('c1');
      expect(env.conversations[0].messages).toHaveLength(2);
      expect(env.conversations[0].messages[0]).toEqual({
        role: 'user',
        content: 'hi',
        id: 'm1',
        timestamp: 10,
      });
      expect(env.prompts[0]).toEqual({
        id: 'p1',
        name: 'review',
        content: 'review this',
        category: 'code',
        created_at: 5,
      });
      expect(env.settings.defaultProvider).toBe('openai');
    });

    it('handles empty storage', async () => {
      mockDb.getChatSessions.mockResolvedValue([]);
      mockDb.getPromptShortcuts.mockResolvedValue([]);
      const env = await exportData(() => ({}));
      expect(env.conversations).toEqual([]);
      expect(env.prompts).toEqual([]);
    });
  });

  describe('importData', () => {
    it('writes sessions and prompts, returns counts', async () => {
      mockDb.saveChatHistory.mockResolvedValue(undefined);
      mockDb.savePromptShortcut.mockResolvedValue(undefined);

      const env = {
        app: 'prism' as const,
        version: 1,
        exportedAt: 0,
        conversations: [
          {
            id: 'c1',
            title: 'T',
            created_at: 1,
            updated_at: 2,
            messages: [
              { role: 'user' as const, content: 'hi', id: 'm1', timestamp: 10 },
              { role: 'assistant' as const, content: 'yo' },
            ],
          },
        ],
        prompts: [{ id: 'p1', name: 'n', content: 'c' }],
        settings: {},
      };

      const result = await importData(env);

      expect(result).toEqual({ conversations: 1, prompts: 1 });
      expect(mockDb.saveChatHistory).toHaveBeenCalledTimes(1);
      const [sid, msgs] = mockDb.saveChatHistory.mock.calls[0];
      expect(sid).toBe('c1');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('m1');
      expect(msgs[1].id).toMatch(/^msg_/); // generated
      expect(msgs[0].sessionId).toBe('c1');
      expect(mockDb.savePromptShortcut).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseImport', () => {
    it('parses valid prism envelopes', () => {
      const text = JSON.stringify({ app: 'prism', version: 1, conversations: [] });
      const env = parseImport(text);
      expect(env).not.toBeNull();
      expect(env!.app).toBe('prism');
    });

    it('rejects invalid json and non-prism docs', () => {
      expect(parseImport('not json')).toBeNull();
      expect(parseImport('{"app":"other"}')).toBeNull();
    });
  });

  describe('clearData', () => {
    it('deletes every session and prompt, returns counts', async () => {
      mockDb.getChatSessions.mockResolvedValue([
        { id: 'c1' },
        { id: 'c2' },
      ]);
      mockDb.getPromptShortcuts.mockResolvedValue([{ id: 'p1' }]);
      mockDb.deleteChatSession.mockResolvedValue(undefined);
      mockDb.deletePromptShortcut.mockResolvedValue(undefined);

      const result = await clearData();

      expect(result).toEqual({ sessions: 2, prompts: 1 });
      expect(mockDb.deleteChatSession).toHaveBeenCalledWith('c1');
      expect(mockDb.deleteChatSession).toHaveBeenCalledWith('c2');
      expect(mockDb.deletePromptShortcut).toHaveBeenCalledWith('p1');
    });
  });

  describe('downloadEnvelope', () => {
    it('creates a blob URL and clicks a link', () => {
      const click = jest.fn();
      const createElement = jest.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        click,
      } as unknown as HTMLAnchorElement);
      const url = 'blob:fake';
      global.URL.createObjectURL = jest.fn(() => url);
      global.URL.revokeObjectURL = jest.fn();

      downloadEnvelope(
        {
          app: 'prism',
          version: 1,
          exportedAt: 0,
          conversations: [],
          prompts: [],
          settings: {},
        },
        'prism-data.json',
      );

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(createElement).toHaveBeenCalledWith('a');
      createElement.mockRestore();
    });
  });
});
