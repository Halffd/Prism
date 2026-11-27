import { useCallback, useEffect, useRef } from 'react';
import { loadBackupSettings, runBackupNow } from '../popup/auto-backup';

/**
 * Automatic local backup for a surface that owns chat history.
 *
 * The chat page, the chat tab and the side panel all keep transcripts in
 * IndexedDB. A snapshot follows every committed transcript change, so a
 * restore does not lose a conversation after a crash or an accidental
 * delete.
 *
 * @param historyKey Change this value when a new snapshot should be due.
 */
export function useAutoBackup(historyKey: string): void {
  const lastBackupAtRef = useRef(0);

  const writeBackupSnapshot = useCallback(async () => {
    try {
      const settings = await loadBackupSettings();
      if (!settings.enabled) {
        return;
      }
      // A history key changes per committed transcript, not per keystroke, so
      // the snapshot follows the conversation instead of lagging a minute
      // behind the first message after a reload.
      lastBackupAtRef.current = Date.now();
      await runBackupNow(settings.retention);
    } catch (error) {
      console.warn('Automatic backup failed:', error);
    }
  }, []);

  useEffect(() => {
    void writeBackupSnapshot();
  }, [historyKey, writeBackupSnapshot]);

  // A snapshot on a timer too, so the backup follows the sessions even
  // when the surface is left open without a new message.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void loadBackupSettings().then((settings) => {
      if (cancelled || !settings.enabled) {
        return;
      }
      timer = setInterval(
        () => void writeBackupSnapshot(),
        settings.intervalMs,
      );
    });

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [writeBackupSnapshot]);
}
