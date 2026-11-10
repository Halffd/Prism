import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  conversationsDir,
  deleteConversation,
  deriveTitle,
  isValidId,
  listConversations,
  loadConversation,
  newConversationId,
  persistChat,
  saveConversation,
  toStoredMessages,
  type StoredConversation,
} from '../core-store';

describe('tui conversation vault (core-compatible store)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-vault-test-'));
    delete process.env.PRISM_CONVERSATIONS_DIR;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('produces ids the core accepts (hex only, <= 32 chars)', () => {
    const id = newConversationId();
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBeLessThanOrEqual(32);
    expect(isValidId(id)).toBe(true);
    expect(isValidId('tui_session_123')).toBe(false);
    expect(isValidId('../escape')).toBe(false);
    expect(isValidId('')).toBe(false);
  });

  it('saves and lists with atomic writes (no tmp litter)', () => {
    const conv: StoredConversation = {
      id: newConversationId(),
      title: 'hello',
      created_at: 1,
      updated_at: 2,
      messages: [{ role: 'user', content: 'hello' }],
    };
    expect(saveConversation(dir, conv)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(dir, `${conv.id}.json`), 'utf-8')).toContain(
      '"title": "hello"',
    );
    expect(fs.readdirSync(dir).some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(listConversations(dir)).toEqual([
      { id: conv.id, title: 'hello', updated_at: 2 },
    ]);
  });

  it('lists corrupt files as skipped, newest first', () => {
    fs.writeFileSync(path.join(dir, 'a.json'), '{not json');
    fs.writeFileSync(path.join(dir, 'b.json'), '[]');
    const conv: StoredConversation = {
      id: 'cafe',
      title: 't',
      created_at: 1,
      updated_at: 999,
      messages: [],
    };
    expect(saveConversation(dir, conv)).toEqual({ ok: true });
    const metas = listConversations(dir);
    expect(metas).toEqual([{ id: 'cafe', title: 't', updated_at: 999 }]);
  });

  it('refuses to save an invalid id and reports the reason', () => {
    const res = saveConversation(dir, {
      id: 'bad id!',
      title: 'x',
      created_at: 0,
      updated_at: 0,
      messages: [],
    });
    expect(res.ok).toBe(false);
  });

  it('loads back exactly what was saved and rejects bad ids', () => {
    const conv: StoredConversation = {
      id: newConversationId(),
      title: 'roundtrip',
      created_at: 5,
      updated_at: 6,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a', thinking: 'why' },
      ],
    };
    saveConversation(dir, conv);
    expect(loadConversation(dir, conv.id)).toEqual(conv);
    expect(loadConversation(dir, 'zz')).toBeNull();
    expect(loadConversation(dir, '../escape')).toBeNull();
  });

  it('delete treats missing as removed and removes existing', () => {
    const conv: StoredConversation = {
      id: 'ab12',
      title: 'd',
      created_at: 0,
      updated_at: 0,
      messages: [],
    };
    saveConversation(dir, conv);
    expect(deleteConversation(dir, 'ab12')).toBe(true);
    expect(deleteConversation(dir, 'ab12')).toBe(true); // ENOENT ok
    expect(deleteConversation(dir, 'no $$')).toBe(false);
  });

  it('persistChat derives the title, keeps the id, and updates touched time', () => {
    const first = persistChat(dir, null, [
      { role: 'user', content: 'who built this vault' },
      { role: 'assistant', content: 'the shared core store' },
    ]);
    expect(first.error).toBeUndefined();
    expect(isValidId(first.id)).toBe(true);
    const loaded = loadConversation(dir, first.id)!;
    expect(loaded.title).toBe('who built this vault');
    const second = persistChat(dir, first.id, [
      ...loaded.messages,
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'another turn' },
    ]);
    expect(second.id).toBe(first.id);
    expect(loadConversation(dir, first.id)!.messages).toHaveLength(4);
  });

  it('persistChat keeps the longer store over a stale prefix snapshot', () => {
    const first = persistChat(dir, null, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    const second = persistChat(dir, first.id, [
      { role: 'user', content: 'a' },
    ]);
    expect(second.id).toBe(first.id);
    expect(loadConversation(dir, first.id)!.messages).toHaveLength(2);
    // a genuinely new content path replaces the store
    const third = persistChat(dir, first.id, [
      { role: 'user', content: 'z' },
    ]);
    expect(loadConversation(dir, third.id)!.messages).toHaveLength(1);
  });

  it('persistChat drops roleplay-only messages instead of writing junk', () => {
    const res = persistChat(dir, null, [
      { role: 'character', content: 'stays local' },
      { role: 'tool', content: 'stays local' },
    ]);
    expect(res.error).toContain('nothing storable');
  });

  it('toStoredMessages maps the friendly roles only', () => {
    expect(
      toStoredMessages([
        { role: 'user', content: 'a' },
        { role: 'system', content: 'b' },
        { role: 'assistant', content: 'c' },
        { role: 'character', content: 'd' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('deriveTitle truncates on a char boundary like the core', () => {
    const long = Array.from({ length: 60 }, (_, i) => String.fromCharCode(0x4e00 + i % 50)).join('');
    expect(Array.from(deriveTitle([{ role: 'user', content: long }]))).toHaveLength(49);
    expect(deriveTitle([{ role: 'assistant', content: 'sparse' }])).toBe('New chat');
  });

  it('falls back to the core config root when no override', () => {
    const dir2 = conversationsDir();
    if (dir2) {
      expect(dir2).toContain(path.join('prism', 'conversations'));
    }
    process.env.PRISM_CONVERSATIONS_DIR = '/tmp/whatever';
    expect(conversationsDir()).toBe('/tmp/whatever');
    delete process.env.PRISM_CONVERSATIONS_DIR;
  });
});
