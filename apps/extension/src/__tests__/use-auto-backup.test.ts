import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutoBackup } from '../chat/use-auto-backup';
import { loadBackupSettings, runBackupNow } from '../popup/auto-backup';

jest.mock('../popup/auto-backup', () => ({
  loadBackupSettings: jest.fn(),
  runBackupNow: jest
    .fn()
    .mockResolvedValue({ id: 'snapshot', conversationCount: 0 }),
}));

const mockedLoad = loadBackupSettings as jest.Mock;
const mockedRun = runBackupNow as jest.Mock;

describe('useAutoBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoad.mockResolvedValue({
      enabled: true,
      retention: 3,
      intervalMs: 60000,
    });
  });

  it('writes a snapshot when backups are enabled', async () => {
    const { unmount } = renderHook(() => useAutoBackup('session-a:1'));

    await waitFor(() => expect(mockedRun).toHaveBeenCalledWith(3));
    unmount();
  });

  it('does not write a snapshot when backups are off', async () => {
    mockedLoad.mockResolvedValue({
      enabled: false,
      retention: 3,
      intervalMs: 60000,
    });
    const { unmount } = renderHook(() => useAutoBackup('session-a:1'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRun).not.toHaveBeenCalled();
    unmount();
  });
});
