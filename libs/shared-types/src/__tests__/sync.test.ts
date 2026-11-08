// Sync envelope roundtrip tests. Exercises the extension-side wrapper over
// the shared envelope: export shape, import application, clear.

import {
  parseEnvelope,
  makeEnvelope,
  messageToSync,
  syncToMessage,
  type SyncEnvelope,
} from '@prism/shared-types';

describe('sync envelope', () => {
  const envelope: SyncEnvelope = {
    app: 'prism',
    version: 1,
    exportedAt: 1_700_000_000_000,
    conversations: [
      {
        id: 'c1',
        title: 'Chat 1',
        created_at: 1,
        updated_at: 2,
        messages: [
          { role: 'user', content: 'hi', id: 'm1', timestamp: 10 },
          { role: 'assistant', content: 'hello', thinking: 'reasoning', id: 'm2' },
        ],
      },
    ],
    prompts: [{ id: 'p1', name: 'review', content: 'review this', category: 'code' }],
    settings: { provider: 'openai', model: 'gpt-4o' },
  };

  it('roundtrips through JSON unchanged', () => {
    const back = parseEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(back).not.toBeNull();
    expect(back!.conversations).toHaveLength(1);
    expect(back!.conversations[0].messages[1].content).toBe('hello');
    expect(back!.conversations[0].messages[1].thinking).toBe('reasoning');
    expect(back!.prompts[0].content).toBe('review this');
    expect(back!.settings.provider).toBe('openai');
  });

  it('rejects non-prism documents', () => {
    expect(parseEnvelope({ app: 'other' })).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope('string')).toBeNull();
  });

  it('tolerates missing optional fields', () => {
    const back = parseEnvelope({
      app: 'prism',
      version: 1,
      conversations: [{ id: 'x', messages: [{ role: 'user', content: 'hi' }] }],
    });
    expect(back!.conversations[0].messages[0].content).toBe('hi');
    expect(back!.conversations[0].title).toBeFalsy();
    expect(back!.prompts).toEqual([]);
    expect(back!.settings).toEqual({});
  });

  it('maps extension Message to SyncMessage and back', () => {
    const sync = messageToSync({
      id: 'm9',
      role: 'user',
      content: 'text',
      timestamp: 42,
    });
    expect(sync).toEqual({
      role: 'user',
      content: 'text',
      id: 'm9',
      timestamp: 42,
    });

    const msg = syncToMessage(sync, 'c1', 1000);
    expect(msg.id).toBe('m9');
    expect(msg.sessionId).toBe('c1');
    expect(msg.timestamp).toBe(42);
    expect(msg.role).toBe('user');
  });

  it('generates ids and timestamps on import when absent', () => {
    const msg = syncToMessage({ role: 'assistant', content: 'x' }, 'c1', 55);
    expect(msg.id).toMatch(/^msg_55_/);
    expect(msg.timestamp).toBe(55);
  });

  it('builds an envelope with makeEnvelope', () => {
    const env = makeEnvelope(
      [
        {
          id: 'c1',
          title: 'T',
          created_at: 1,
          updated_at: 2,
          messages: [{ role: 'user', content: 'hi' }],
        },
      ],
      [],
      { provider: 'groq' },
      777,
    );
    expect(env.app).toBe('prism');
    expect(env.version).toBe(1);
    expect(env.exportedAt).toBe(777);
    expect(env.conversations[0].messages[0].role).toBe('user');
    expect(env.prompts).toEqual([]);
  });

  it('drops entries with missing required fields', () => {
    const back = parseEnvelope({
      app: 'prism',
      version: 1,
      conversations: [{ noId: true }, { id: 'ok', messages: [] }],
      prompts: [{ noContent: true }, { id: 'p', content: 'c' }],
    });
    expect(back!.conversations).toHaveLength(1);
    expect(back!.conversations[0].id).toBe('ok');
    expect(back!.prompts).toHaveLength(1);
    expect(back!.prompts[0].id).toBe('p');
  });
});
