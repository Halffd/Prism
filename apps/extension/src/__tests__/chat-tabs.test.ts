import {
  CHAT_TABS_STORAGE_KEY,
  MAX_OPEN_TABS,
  closeTab,
  focusTab,
  initialTabState,
  loadTabState,
  normalizeTabState,
  openTab,
  pruneMissingSessions,
  restoreTabState,
  restoredTabState,
  saveTabState,
} from '../chat/chat-tabs';

describe('Chat tabs', () => {
  beforeEach(() => {
    (chrome.storage.local.get as jest.Mock).mockReset();
    (chrome.storage.local.set as jest.Mock).mockReset();
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
    (chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined);
  });

  describe('normalizeTabState', () => {
    it('rejects a missing value', () => {
      expect(normalizeTabState(undefined)).toBeNull();
      expect(normalizeTabState(null)).toBeNull();
      expect(normalizeTabState('not-an-object')).toBeNull();
    });

    it('rejects a value without an open tab list', () => {
      expect(normalizeTabState({ activeTabId: 'a' })).toBeNull();
      expect(normalizeTabState({ openTabs: 'a' })).toBeNull();
    });

    it('rejects a tab list that is empty after cleaning', () => {
      expect(normalizeTabState({ openTabs: [], activeTabId: 'a' })).toBeNull();
      expect(normalizeTabState({ openTabs: ['', 3], activeTabId: 'a' })).toBeNull();
    });

    it('drops duplicate tabs, keeping the first occurrence', () => {
      const state = normalizeTabState({
        openTabs: ['a', 'b', 'a'],
        activeTabId: 'a',
      });
      expect(state?.openTabs).toEqual(['a', 'b']);
    });

    it('falls back to the first tab when the active tab is not open', () => {
      const state = normalizeTabState({
        openTabs: ['a', 'b'],
        activeTabId: 'missing',
      });
      expect(state?.activeTabId).toBe('a');
    });

    it('keeps the active tab when it is open', () => {
      const state = normalizeTabState({
        openTabs: ['a', 'b'],
        activeTabId: 'b',
      });
      expect(state?.activeTabId).toBe('b');
    });
  });

  describe('openTab', () => {
    it('adds a tab and focuses it', () => {
      const state = openTab(initialTabState('a'), 'b');
      expect(state.openTabs).toEqual(['a', 'b']);
      expect(state.activeTabId).toBe('b');
    });

    it('focuses an already open tab instead of duplicating it', () => {
      const state = openTab({ openTabs: ['a', 'b'], activeTabId: 'a' }, 'b');
      expect(state.openTabs).toEqual(['a', 'b']);
      expect(state.activeTabId).toBe('b');
    });

    it('does not open more tabs than the limit allows', () => {
      let state = initialTabState('a');
      for (let i = 0; i < MAX_OPEN_TABS + 5; i++) {
        state = openTab(state, `session-${i}`);
      }
      expect(state.openTabs.length).toBe(MAX_OPEN_TABS);
    });
  });

  describe('focusTab', () => {
    it('focuses an open tab', () => {
      const state = focusTab({ openTabs: ['a', 'b'], activeTabId: 'a' }, 'b');
      expect(state.activeTabId).toBe('b');
    });

    it('ignores a tab that is not open', () => {
      const before = { openTabs: ['a', 'b'], activeTabId: 'a' };
      expect(focusTab(before, 'z')).toBe(before);
    });
  });

  describe('closeTab', () => {
    it('closes a tab that is not focused', () => {
      const state = closeTab(
        { openTabs: ['a', 'b', 'c'], activeTabId: 'b' },
        'c',
      );
      expect(state.openTabs).toEqual(['a', 'b']);
      expect(state.activeTabId).toBe('b');
    });

    it('focuses the tab before the closed one when the closed tab was focused', () => {
      const state = closeTab(
        { openTabs: ['a', 'b', 'c'], activeTabId: 'b' },
        'b',
      );
      expect(state.openTabs).toEqual(['a', 'c']);
      expect(state.activeTabId).toBe('a');
    });

    it('refuses to close the last remaining tab', () => {
      const before = { openTabs: ['a'], activeTabId: 'a' };
      expect(closeTab(before, 'a')).toBe(before);
    });

    it('ignores a tab that is not open', () => {
      const before = { openTabs: ['a', 'b'], activeTabId: 'a' };
      expect(closeTab(before, 'z')).toBe(before);
    });
  });

  describe('pruneMissingSessions', () => {
    it('drops tabs whose session no longer exists', () => {
      const state = pruneMissingSessions(
        { openTabs: ['a', 'gone'], activeTabId: 'a' },
        ['a'],
      );
      expect(state.openTabs).toEqual(['a']);
      expect(state.activeTabId).toBe('a');
    });

    it('focuses the first remaining tab when the focused one is gone', () => {
      const state = pruneMissingSessions(
        { openTabs: ['gone', 'b'], activeTabId: 'gone' },
        ['b'],
      );
      expect(state.activeTabId).toBe('b');
    });

    it('drops every tab when no session exists any more', () => {
      const state = pruneMissingSessions(
        { openTabs: ['a', 'b'], activeTabId: 'a' },
        [],
      );
      expect(state.openTabs).toEqual([]);
    });
  });

  describe('restoredTabState', () => {
    it('opens on a single fresh chat when nothing was stored', () => {
      const state = restoredTabState(null, []);
      expect(state.openTabs).toHaveLength(1);
      expect(state.activeTabId).toBe(state.openTabs[0]);
    });

    it('restores the stored tabs when the sessions still exist', () => {
      const state = restoredTabState(
        { openTabs: ['a', 'b'], activeTabId: 'b' },
        ['a', 'b'],
      );
      expect(state.openTabs).toEqual(['a', 'b']);
      expect(state.activeTabId).toBe('b');
    });

    it('opens on a single fresh chat when every stored session is gone', () => {
      const state = restoredTabState(
        { openTabs: ['a', 'b'], activeTabId: 'a' },
        [],
      );
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs).not.toContain('a');
    });
  });

  describe('persistence', () => {
    it('stores the tab state under the chat tabs key', async () => {
      await saveTabState({ openTabs: ['a', 'b'], activeTabId: 'b' });
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [CHAT_TABS_STORAGE_KEY]: { openTabs: ['a', 'b'], activeTabId: 'b' },
      });
    });

    it('reads the tab state back from storage', async () => {
      (chrome.storage.local.get as jest.Mock).mockResolvedValue({
        [CHAT_TABS_STORAGE_KEY]: { openTabs: ['a'], activeTabId: 'a' },
      });
      const state = await loadTabState();
      expect(state?.openTabs).toEqual(['a']);
    });

    it('returns null when there is no stored state', async () => {
      (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
      expect(await loadTabState()).toBeNull();
    });

    it('stores the restored state so a deleted session does not come back', async () => {
      (chrome.storage.local.get as jest.Mock).mockResolvedValue({
        [CHAT_TABS_STORAGE_KEY]: { openTabs: ['gone'], activeTabId: 'gone' },
      });
      const state = await restoreTabState(['other']);
      expect(state.openTabs).not.toContain('gone');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [CHAT_TABS_STORAGE_KEY]: {
          openTabs: state.openTabs,
          activeTabId: state.activeTabId,
        },
      });
    });
  });
});
