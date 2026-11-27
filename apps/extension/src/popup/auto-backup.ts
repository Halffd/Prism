import { getSetting, saveSetting } from '@prism/shared-db';
import { getChatSessionsDetailed } from '@prism/shared-db';
import {
  createBackupSnapshot,
  deleteAllBackupSnapshots,
  listBackupSnapshots,
  restoreBackupSnapshot,
  type StoredBackup,
} from './session-data';

/**
 * Automatic local backup.
 *
 * A snapshot of every session is written to IndexedDB after a change (or
 * on a timer when the popup is open). Only the newest `retention`
 * snapshots are kept.
 */

export interface BackupSettings {
  enabled: boolean;
  /** How many snapshots to keep. */
  retention: number;
  /** How often a snapshot is written, in milliseconds. */
  intervalMs: number;
}

export const BACKUP_SETTING_KEY = 'autoBackup';

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  retention: 5,
  intervalMs: 15 * 60 * 1000,
};

/** Read the backup settings. */
export async function loadBackupSettings(): Promise<BackupSettings> {
  try {
    const stored = await getSetting<Partial<BackupSettings>>(
      BACKUP_SETTING_KEY,
    );
    if (!stored) return { ...DEFAULT_BACKUP_SETTINGS };
    return {
      enabled: stored.enabled === true,
      retention:
        typeof stored.retention === 'number' && stored.retention > 0
          ? Math.floor(stored.retention)
          : DEFAULT_BACKUP_SETTINGS.retention,
      intervalMs:
        typeof stored.intervalMs === 'number' && stored.intervalMs > 0
          ? stored.intervalMs
          : DEFAULT_BACKUP_SETTINGS.intervalMs,
    };
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

/** Store the backup settings. */
export async function saveBackupSettings(
  settings: BackupSettings,
): Promise<void> {
  await saveSetting(BACKUP_SETTING_KEY, settings);
}

/** Write one snapshot now, honouring the retention count. */
export async function runBackupNow(
  retention: number,
): Promise<StoredBackup> {
  const { sessions } = await getChatSessionsDetailed();
  return createBackupSnapshot(sessions, retention);
}

/** The stored snapshots, newest first. */
export async function getBackupSnapshots(): Promise<StoredBackup[]> {
  return listBackupSnapshots();
}

/** Restore a snapshot, returning the number of sessions restored. */
export async function restoreSnapshot(
  snapshot: StoredBackup,
): Promise<number> {
  return restoreBackupSnapshot(snapshot);
}

/** Delete every stored snapshot. */
export async function clearSnapshots(): Promise<void> {
  await deleteAllBackupSnapshots();
}
