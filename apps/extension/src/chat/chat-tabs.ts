/**
 * Persistent state of the open chat tabs.
 *
 * The popup and the chat page both show several conversations at once, as
 * tabs. Which tabs are open and which one is focused is part of the user's
 * workspace, not part of a single page view, so it is kept in
 * `chrome.storage.local`: it survives the popup being closed, the service
 * worker being torn down, and the browser being restarted.
 *
 * The module owns the shape of the stored state and every rule that changes
 * it, so that the popup and the chat page cannot drift apart.
 */

/** Storage key holding the open-tab state. */
export const CHAT_TABS_STORAGE_KEY = 'chatTabs';

/** Maximum number of tabs that can be open at once. */
export const MAX_OPEN_TABS = 12;

/** The open tabs and which one is focused. */
export interface ChatTabState {
  /** Session ids of the open tabs, in the order they are shown. */
  openTabs: string[];
  /** Session id of the focused tab. */
  activeTabId: string;
}

/**
 * Builds the state for a single freshly opened chat.
 *
 * @param sessionId The session the new tab shows.
 * @returns The initial tab state.
 */
export function initialTabState(sessionId: string): ChatTabState {
  return { openTabs: [sessionId], activeTabId: sessionId };
}

/**
 * Normalises a stored value into a valid tab state.
 *
 * The stored value is untrusted: it may be missing, malformed, or hold
 * session ids that no longer exist. Anything unusable is dropped rather
 * than propagated.
 *
 * @param value The raw stored value.
 * @returns A tab state that is safe to render.
 */
export function normalizeTabState(value: unknown): ChatTabState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ChatTabState>;
  if (!Array.isArray(candidate.openTabs)) {
    return null;
  }

  const openTabs = candidate.openTabs.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  // A tab that is listed twice would render twice and fight over the
  // session's messages, so duplicates are collapsed keeping the first.
  const uniqueTabs = openTabs.filter(
    (id, index) => openTabs.indexOf(id) === index,
  );

  if (uniqueTabs.length === 0) {
    return null;
  }

  const activeTabId =
    typeof candidate.activeTabId === 'string' &&
    uniqueTabs.includes(candidate.activeTabId)
      ? candidate.activeTabId
      : uniqueTabs[0];

  return { openTabs: uniqueTabs, activeTabId };
}

/**
 * Reads the stored tab state.
 *
 * @returns The stored state, or `null` when there is none.
 */
export async function loadTabState(): Promise<ChatTabState | null> {
  const stored = await chrome.storage.local.get(CHAT_TABS_STORAGE_KEY);
  return normalizeTabState(stored?.[CHAT_TABS_STORAGE_KEY]);
}

/**
 * Writes the tab state.
 *
 * @param state The state to store.
 * @returns A promise that resolves once the state is stored.
 */
export async function saveTabState(state: ChatTabState): Promise<void> {
  await chrome.storage.local.set({
    [CHAT_TABS_STORAGE_KEY]: {
      openTabs: state.openTabs,
      activeTabId: state.activeTabId,
    },
  });
}

/**
 * Adds a session as a tab and focuses it.
 *
 * A session that is already open is only focused, so opening the same
 * chat twice does not duplicate its tab.
 *
 * @param state The current state.
 * @param sessionId The session to open.
 * @returns The new state.
 */
export function openTab(
  state: ChatTabState,
  sessionId: string,
): ChatTabState {
  if (state.openTabs.includes(sessionId)) {
    return { ...state, activeTabId: sessionId };
  }
  if (state.openTabs.length >= MAX_OPEN_TABS) {
    return state;
  }
  return {
    openTabs: [...state.openTabs, sessionId],
    activeTabId: sessionId,
  };
}

/**
 * Focuses a tab that is already open.
 *
 * @param state The current state.
 * @param sessionId The session to focus.
 * @returns The new state; unchanged when the session is not open.
 */
export function focusTab(
  state: ChatTabState,
  sessionId: string,
): ChatTabState {
  if (!state.openTabs.includes(sessionId)) {
    return state;
  }
  return { ...state, activeTabId: sessionId };
}

/**
 * Closes a tab.
 *
 * The last remaining tab cannot be closed: there must always be somewhere
 * to type. Closing the focused tab focuses the one before it.
 *
 * @param state The current state.
 * @param sessionId The session to close.
 * @returns The new state; unchanged when the session is not open.
 */
export function closeTab(
  state: ChatTabState,
  sessionId: string,
): ChatTabState {
  const index = state.openTabs.indexOf(sessionId);
  if (index < 0 || state.openTabs.length === 1) {
    return state;
  }

  const openTabs = state.openTabs.filter((id) => id !== sessionId);
  const activeTabId =
    state.activeTabId === sessionId
      ? openTabs[Math.max(0, index - 1)]
      : state.activeTabId;

  return { openTabs, activeTabId };
}

/**
 * Drops tabs whose session no longer exists.
 *
 * A session can disappear because it was deleted, or because it was stored
 * by an older version of the extension. Such a tab would render an empty
 * conversation that can never be recovered, so it is removed.
 *
 * @param state The current state.
 * @param existingSessionIds The ids of the sessions that exist.
 * @returns The new state; the tab list is empty when every session is gone.
 */
export function pruneMissingSessions(
  state: ChatTabState,
  existingSessionIds: string[],
): ChatTabState {
  const openTabs = state.openTabs.filter((id) =>
    existingSessionIds.includes(id),
  );
  if (openTabs.length === 0) {
    return { openTabs: [], activeTabId: '' };
  }
  const activeTabId = openTabs.includes(state.activeTabId)
    ? state.activeTabId
    : openTabs[0];
  return { openTabs, activeTabId };
}

/**
 * Builds the tab state to open the extension with.
 *
 * The stored state is restored when it still refers to conversations that
 * exist. Otherwise the extension opens on a single fresh chat, so that
 * there is always somewhere to type.
 *
 * @param stored The stored state, or `null` when there is none.
 * @param existingSessionIds The ids of the sessions that exist.
 * @returns The state to open with.
 */
export function restoredTabState(
  stored: ChatTabState | null,
  existingSessionIds: string[],
): ChatTabState {
  if (!stored) {
    return initialTabState(`session_${Date.now()}`);
  }

  const pruned = pruneMissingSessions(stored, existingSessionIds);
  if (pruned.openTabs.length === 0) {
    return initialTabState(`session_${Date.now()}`);
  }
  return pruned;
}

/**
 * Reads the stored tabs and restores them against the sessions that exist.
 *
 * The result is stored back, so that a tab referring to a conversation that
 * has since been deleted does not come back on the next load.
 *
 * @param existingSessionIds The ids of the sessions that exist.
 * @returns The restored state.
 */
export async function restoreTabState(
  existingSessionIds: string[],
): Promise<ChatTabState> {
  const stored = await loadTabState();
  const state = restoredTabState(stored, existingSessionIds);
  await saveTabState(state);
  return state;
}
