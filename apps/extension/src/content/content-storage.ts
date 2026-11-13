/**
 * Per-origin persistence for the content script.
 *
 * The content script used to read and write the *page's* `localStorage`.
 * That is wrong for two reasons:
 *
 *   - It throws a SecurityError on pages with an opaque origin (sandboxed
 *     iframes, `data:` and `blob:` documents). Firefox surfaces that as an
 *     uncaught exception in the content script, which aborts the rest of
 *     the script's initialization.
 *   - It writes the extension's state into the host page's storage, where
 *     the page can read it and the user cannot clear it from the
 *     extension's settings.
 *
 * `chrome.storage.local` is the extension's own store: it is available in
 * content scripts, is per-extension rather than per-origin, and does not
 * throw on opaque origins. A single key holds the per-origin map so the
 * number of storage writes stays bounded.
 */

/** The extension-local key holding the per-origin state map. */
const STORAGE_KEY = 'prismContentState';

/** The origin the current page belongs to, or a stable fallback. */
function currentOrigin(): string {
  try {
    // A sandboxed iframe can throw on `location.origin` access too, so
    // the whole read is guarded.
    return window.location.origin || window.location.href;
  } catch {
    return 'unknown';
  }
}

type OriginState = Record<string, boolean>;

async function readState(): Promise<OriginState> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY];
    return value && typeof value === 'object' ? (value as OriginState) : {};
  } catch {
    // A storage failure must not take the content script down with it.
    return {};
  }
}

/**
 * Whether the user dismissed the floating button on this origin.
 *
 * Defaults to false when the state cannot be read: showing the button is
 * the safe outcome, hiding it forever because storage failed is not.
 */
export async function isButtonRemoved(): Promise<boolean> {
  const state = await readState();
  return state[currentOrigin()] === true;
}

/** Remember that the user dismissed the floating button on this origin. */
export async function setButtonRemoved(removed: boolean): Promise<void> {
  try {
    const state = await readState();
    state[currentOrigin()] = removed;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    // Losing the preference is acceptable; breaking the page is not.
  }
}
