import React, { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_BACKUP_SETTINGS,
  clearSnapshots,
  getBackupSnapshots,
  loadBackupSettings,
  restoreSnapshot,
  runBackupNow,
  saveBackupSettings,
  type BackupSettings,
} from '../popup/auto-backup';
import type { StoredBackup } from '../popup/session-data';

/**
 * The local-backup settings.
 *
 * The user can turn automatic backups on, choose how many snapshots are
 * kept, see when the last snapshot was written, restore one and delete
 * them all.
 */
export function BackupSettingsPanel(): React.ReactElement {
  const [settings, setSettings] = useState<BackupSettings>(
    DEFAULT_BACKUP_SETTINGS,
  );
  const [snapshots, setSnapshots] = useState<StoredBackup[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [loaded, stored] = await Promise.all([
      loadBackupSettings(),
      getBackupSnapshots(),
    ]);
    setSettings(loaded);
    setSnapshots(stored);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (patch: Partial<BackupSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveBackupSettings(next);
  }, [settings]);

  const backupNow = useCallback(async () => {
    setBusy(true);
    setStatus('');
    try {
      const snapshot = await runBackupNow(settings.retention);
      setStatus(
        `Wrote a snapshot with ${snapshot.conversationCount} session${
          snapshot.conversationCount === 1 ? '' : 's'
        }.`,
      );
      await refresh();
    } catch (error) {
      setStatus(`Backup failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [settings.retention, refresh]);

  const restore = useCallback(
    async (snapshot: StoredBackup) => {
      setBusy(true);
      setStatus('');
      try {
        const count = await restoreSnapshot(snapshot);
        setStatus(`Restored ${count} session${count === 1 ? '' : 's'}.`);
        await refresh();
      } catch (error) {
        setStatus(`Restore failed: ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const removeAll = useCallback(async () => {
    setBusy(true);
    setStatus('');
    try {
      await clearSnapshots();
      setStatus('Deleted every backup snapshot.');
      await refresh();
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const lastSnapshot = snapshots[0];

  return (
    <div className="settings-section backup-settings">
      <h3>Local Backup</h3>
      <small className="form-hint">
        Backups are snapshots of every session, written to IndexedDB on this
        device. They never leave the browser.
      </small>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void update({ enabled: event.target.checked })}
          />
          Automatic local backup
        </label>
        <small className="form-hint">
          When enabled, a snapshot is written after sessions change and
          periodically while Prism is open.
        </small>
      </div>

      <div className="form-group">
        <label>Snapshots to keep</label>
        <input
          type="number"
          min={1}
          max={100}
          value={settings.retention}
          onChange={(event) =>
            void update({ retention: Math.max(1, Number(event.target.value) || 1) })
          }
          className="form-control"
        />
        <small className="form-hint">
          Only the newest snapshots are kept; older ones are removed.
        </small>
      </div>

      <div className="form-group">
        <label>Backup interval (minutes)</label>
        <input
          type="number"
          min={1}
          max={1440}
          value={Math.round(settings.intervalMs / 60000)}
          onChange={(event) =>
            void update({
              intervalMs:
                Math.max(1, Number(event.target.value) || 1) * 60 * 1000,
            })
          }
          className="form-control"
        />
      </div>

      <div className="form-group" style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void backupNow()}
          disabled={busy}
        >
          Back up now
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void removeAll()}
          disabled={busy || snapshots.length === 0}
        >
          Delete backups
        </button>
      </div>

      <div className="form-group">
        <label>Backup status</label>
        <p className="form-hint">
          {snapshots.length === 0
            ? 'No backups yet.'
            : `${snapshots.length} snapshot${
                snapshots.length === 1 ? '' : 's'
              } stored. Last one: ${new Date(
                lastSnapshot.createdAt,
              ).toLocaleString()}.`}
        </p>
        {snapshots.length > 0 && (
          <div className="backup-snapshot-list">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="backup-snapshot-item">
                <span>
                  {new Date(snapshot.createdAt).toLocaleString()} ·{' '}
                  {snapshot.conversationCount} session
                  {snapshot.conversationCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void restore(snapshot)}
                  disabled={busy}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {status && <small className="form-hint">{status}</small>}
    </div>
  );
}

export default BackupSettingsPanel;
