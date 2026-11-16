import 'fake-indexeddb/auto';
import {
  DEFAULT_BACKUP_SETTINGS,
  clearSnapshots,
  getBackupSnapshots,
  loadBackupSettings,
  restoreSnapshot,
  runBackupNow,
  saveBackupSettings,
} from '../popup/auto-backup';
import {
  getChatSessionsDetailed,
  getDatabase,
  saveChatHistory,
} from '@prism/shared-db';

/**
 * The local auto-backup: the settings, the snapshots and the restore.
 */
describe('Automatic local backup', () => {
  beforeEach(async () => {
    const db = await getDatabase();
    const tx = db.transaction(['chatSessions', 'chatHistory', 'cache'], 'readwrite');
    await tx.objectStore('chatSessions').clear();
    await tx.objectStore('chatHistory').clear();
    await tx.objectStore('cache').clear();
    await tx.done;
  });

  test('the defaults are off with a retention of five', async () => {
    const settings = await loadBackupSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.retention).toBe(DEFAULT_BACKUP_SETTINGS.retention);
  });

  test('the settings roundtrip through storage', async () => {
    await saveBackupSettings({ enabled: true, retention: 3, intervalMs: 60000 });
    const settings = await loadBackupSettings();
    expect(settings).toEqual({
      enabled: true,
      retention: 3,
      intervalMs: 60000,
    });
  });

  test('a snapshot carries every session', async () => {
    await saveChatHistory('s1', [
      { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
    ]);

    const snapshot = await runBackupNow(3);
    expect(snapshot.conversationCount).toBe(1);
    expect(snapshot.envelope.app).toBe('prism');

    const stored = await getBackupSnapshots();
    expect(stored).toHaveLength(1);
  });

  test('the retention count keeps only the newest snapshots', async () => {
    await runBackupNow(2);
    await runBackupNow(2);
    await runBackupNow(2);

    const snapshots = await getBackupSnapshots();
    expect(snapshots).toHaveLength(2);
  });

  test('a snapshot can be restored', async () => {
    await saveChatHistory('restore-me', [
      { id: 'm1', role: 'user', content: 'kept', timestamp: 1 },
    ]);
    const snapshot = await runBackupNow(3);

    const db = await getDatabase();
    const tx = db.transaction('chatSessions', 'readwrite');
    await tx.objectStore('chatSessions').delete('restore-me');
    await tx.done;

    const restored = await restoreSnapshot(snapshot);
    expect(restored).toBe(1);

    const { sessions } = await getChatSessionsDetailed();
    expect(sessions.map((session) => session.id)).toContain('restore-me');
  });

  test('every snapshot can be deleted', async () => {
    await runBackupNow(3);
    await runBackupNow(3);
    expect((await getBackupSnapshots()).length).toBeGreaterThan(0);

    await clearSnapshots();
    expect(await getBackupSnapshots()).toHaveLength(0);
  });
});
