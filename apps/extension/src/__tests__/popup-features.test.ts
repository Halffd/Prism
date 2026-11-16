import 'fake-indexeddb/auto';
import {
  applyBackupEnvelope,
  buildBackupEnvelope,
  collectSessionTags,
  createBackupSnapshot,
  filterSessions,
  listBackupSnapshots,
  parseBackupEnvelope,
  pruneBackupSnapshots,
  restoreBackupSnapshot,
  defaultSessionFilters,
} from '../popup/session-data';
import {
  getChatSessionsDetailed,
  getDatabase,
  saveChatHistory,
  updateChatSessionMeta,
  type DBChatSession,
} from '@prism/shared-db';

/**
 * The popup's session features: the backup envelope validation, the
 * backup snapshots with their retention, and the migration of sessions
 * written by an older schema.
 */
describe('Popup session backup and migration', () => {
  beforeEach(async () => {
    const db = await getDatabase();
    const tx = db.transaction(['chatSessions', 'chatHistory', 'cache'], 'readwrite');
    await tx.objectStore('chatSessions').clear();
    await tx.objectStore('chatHistory').clear();
    await tx.objectStore('cache').clear();
    await tx.done;
  });

  describe('import validation', () => {
    const validEnvelope = {
      app: 'prism',
      version: 1,
      exported_at: 1_700_000_000_000,
      conversations: [
        {
          id: 'session_1',
          title: 'First chat',
          created_at: 1,
          updated_at: 2,
          messages: [{ role: 'user', content: 'hello' }],
        },
      ],
    };

    test('accepts a valid Prism envelope', () => {
      const parsed = parseBackupEnvelope(JSON.stringify(validEnvelope));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.envelope.app).toBe('prism');
      expect(parsed.envelope.conversations).toHaveLength(1);
      expect(parsed.migrated).toBe(false);
    });

    test('rejects a document that is not a Prism envelope', () => {
      const parsed = parseBackupEnvelope(
        JSON.stringify({ hello: 'world', conversations: [] }),
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.failure.kind).toBe('not-envelope');
      expect(parsed.failure.reason).toMatch(/not a Prism backup/i);
    });

    test('rejects a corrupt file with a readable reason', () => {
      const parsed = parseBackupEnvelope('{ this is not json');
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.failure.kind).toBe('corrupt');
      expect(parsed.failure.reason.length).toBeGreaterThan(0);
    });

    test('rejects a backup written by a newer Prism', () => {
      const parsed = parseBackupEnvelope(
        JSON.stringify({ ...validEnvelope, version: 99 }),
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.failure.kind).toBe('unsupported');
      if (parsed.failure.kind !== 'unsupported') return;
      expect(parsed.failure.version).toBe(99);
      expect(parsed.failure.reason).toMatch(/newer Prism/i);
    });

    test('imports a valid file into storage', async () => {
      const parsed = parseBackupEnvelope(JSON.stringify(validEnvelope));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const count = await applyBackupEnvelope(parsed.envelope);
      expect(count).toBe(1);

      const { sessions } = await getChatSessionsDetailed();
      expect(sessions.map((session) => session.id)).toContain('session_1');
      expect(sessions[0].title).toBe('First chat');
    });
  });

  describe('backup snapshots', () => {
    const session = (id: string): DBChatSession => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 2,
    });

    test('writes snapshots and honours the retention count', async () => {
      await createBackupSnapshot([session('a')], 2, 1000);
      await createBackupSnapshot([session('a'), session('b')], 2, 2000);
      await createBackupSnapshot([session('a')], 2, 3000);

      const snapshots = await listBackupSnapshots();
      expect(snapshots).toHaveLength(2);
      // The newest snapshots are the ones that are kept.
      expect(snapshots[0].createdAt).toBe(3000);
      expect(snapshots[1].createdAt).toBe(2000);
    });

    test('restores a snapshot', async () => {
      await saveChatHistory('restored', [
        {
          id: 'm1',
          role: 'user',
          content: 'kept',
          timestamp: 1,
        },
      ]);
      const snapshot = await createBackupSnapshot(
        [
          {
            id: 'restored',
            title: 'Restored chat',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        3,
        1000,
      );

      // Remove the session, then restore it from the snapshot.
      const db = await getDatabase();
      const tx = db.transaction('chatSessions', 'readwrite');
      await tx.objectStore('chatSessions').delete('restored');
      await tx.done;

      const restored = await restoreBackupSnapshot(snapshot);
      expect(restored).toBe(1);

      const { sessions } = await getChatSessionsDetailed();
      expect(sessions.map((entry) => entry.id)).toContain('restored');
    });

    test('prunes the snapshots above the retention count', async () => {
      await createBackupSnapshot([], 10, 1000);
      await createBackupSnapshot([], 10, 2000);
      await createBackupSnapshot([], 10, 3000);

      await pruneBackupSnapshots(1);
      const snapshots = await listBackupSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].createdAt).toBe(3000);
    });
  });

  describe('migration of old records', () => {
    test('migrates an old-shaped session row on read', async () => {
      const db = await getDatabase();
      const tx = db.transaction('chatSessions', 'readwrite');
      // A row written by the old schema: no tags, read or archive fields.
      await tx.objectStore('chatSessions').put({
        id: 'legacy',
        title: 'Legacy chat',
        createdAt: 10,
        updatedAt: 20,
      });
      await tx.done;

      const { sessions, corrupt } = await getChatSessionsDetailed();
      expect(corrupt).toHaveLength(0);
      const legacy = sessions.find((entry) => entry.id === 'legacy');
      expect(legacy).toBeDefined();
      expect(legacy?.tags).toEqual([]);
      expect(legacy?.read).toBe(true);
      expect(legacy?.archived).toBe(false);

      // The migration is written back, so the row is repaired in place.
      const readBack = await getDatabase();
      const readTx = readBack.transaction('chatSessions', 'readonly');
      const row = await readTx.objectStore('chatSessions').get('legacy');
      await readTx.done;
      expect(row.tags).toEqual([]);
      expect(row.read).toBe(true);
      expect(row.archived).toBe(false);
    });

    test('reports a corrupt row instead of failing the whole list', async () => {
      const db = await getDatabase();
      const tx = db.transaction('chatSessions', 'readwrite');
      await tx.objectStore('chatSessions').put({
        id: 'broken',
        title: 'Broken chat',
        createdAt: 10,
        updatedAt: 20,
      });
      // A row without a usable id cannot be shown or acted on, so it is
      // reported as corrupt instead of breaking the whole list.
      await tx.objectStore('chatSessions').put({
        id: '',
        title: 'Nameless',
      });
      await tx.done;

      const { sessions, corrupt } = await getChatSessionsDetailed();
      expect(sessions.map((entry) => entry.id)).toContain('broken');
      expect(corrupt.length).toBeGreaterThan(0);
      expect(corrupt[0].reason.length).toBeGreaterThan(0);
    });
  });

  describe('session filters', () => {
    const sessions: DBChatSession[] = [
      {
        id: 'a',
        title: 'Alpha',
        createdAt: 1,
        updatedAt: 1,
        tags: ['work'],
        read: true,
        archived: false,
      },
      {
        id: 'b',
        title: 'Beta',
        createdAt: 1,
        updatedAt: 2,
        tags: ['fun'],
        read: false,
        archived: true,
      },
    ];

    test('filters by title, tag, read state and archive state', () => {
      const filters = defaultSessionFilters();
      // The default archive filter hides the archived session.
      expect(filterSessions(sessions, filters)).toHaveLength(1);

      expect(
        filterSessions(sessions, { ...filters, archived: 'all' }),
      ).toHaveLength(2);
      expect(
        filterSessions(sessions, { ...filters, archived: 'archived' }).map(
          (session) => session.id,
        ),
      ).toEqual(['b']);
      // The filters combine: an unread, archived session is found by the
      // unread filter once the archive filter includes archived rows.
      expect(
        filterSessions(sessions, {
          ...filters,
          archived: 'all',
          read: 'unread',
        }).map((session) => session.id),
      ).toEqual(['b']);
      expect(
        filterSessions(sessions, {
          ...filters,
          archived: 'all',
          read: 'read',
        }).map((session) => session.id),
      ).toEqual(['a']);
      expect(
        filterSessions(sessions, { ...filters, tag: 'work' }).map(
          (session) => session.id,
        ),
      ).toEqual(['a']);
      expect(
        filterSessions(sessions, {
          ...filters,
          archived: 'all',
          text: 'bet',
        }).map((session) => session.id),
      ).toEqual(['b']);
    });

    test('collects the tags of the sessions', () => {
      expect(collectSessionTags(sessions)).toEqual(['fun', 'work']);
    });
  });

  test('a backup envelope roundtrips through storage', async () => {
    await saveChatHistory('roundtrip', [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        timestamp: 1,
        tags: ['important'],
      },
    ]);
    await updateChatSessionMeta('roundtrip', {
      title: 'Roundtrip chat',
      tags: ['keep'],
    });

    const { sessions } = await getChatSessionsDetailed();
    const envelope = await buildBackupEnvelope(sessions);
    expect(envelope.app).toBe('prism');
    expect(envelope.version).toBe(1);
    expect(envelope.conversations).toHaveLength(1);
    expect(envelope.conversations[0].messages[0].tags).toEqual(['important']);
    expect(envelope.conversations[0].tags).toEqual(['keep']);
  });
});
