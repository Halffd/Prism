/**
 * Host-permission state across browsers.
 *
 * Chrome MV3 grants the manifest's `host_permissions` at install time, so
 * the content script is present on every page from the first load. Firefox
 * MV3 treats the same declarations as *optional*: the user must grant
 * them, and until they do the content script never runs on that origin.
 *
 * The extension therefore has to detect the gap and ask for access rather
 * than silently behaving as if context capture works.
 */

/** The extension's declared host patterns, mirrored from the manifest. */
const REQUESTABLE_ORIGINS = ['<all_urls>'] as const;

/** Firefox exposes `browser`; Chrome only has `chrome` (until Chrome 148). */
type PermissionApi = {
  contains: (request: {
    origins?: string[];
    permissions?: string[];
  }) => Promise<boolean>;
  request: (request: {
    origins?: string[];
    permissions?: string[];
  }) => Promise<boolean>;
  getAll?: () => Promise<{ origins?: string[] }>;
};

/**
 * Firefox's `permissions` API. Guarded because Chrome only gained the
 * namespace recently and the jest mock does not provide it.
 */
function permissionApi(): PermissionApi | null {
  // globalThis is a well-known host object whose extension namespaces are
  // not in the DOM lib's types, so the shape is narrowed at runtime.
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const namespace of ['browser', 'chrome']) {
    const candidate = scope[namespace];
    if (!candidate || typeof candidate !== 'object') continue;
    if (!('permissions' in candidate)) continue;
    const perms = candidate.permissions;
    if (perms && typeof perms === 'object') {
      return perms as PermissionApi;
    }
  }
  return null;
}

/**
 * True on Firefox, where manifest host permissions are opt-in.
 *
 * `navigator.userAgent` is the only signal available in a content script
 * or popup without asking the user anything.
 */
export function isFirefox(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /firefox|fxios/i.test(navigator.userAgent)
  );
}

/**
 * Whether the extension may inject into the given tab's origin.
 *
 * On Chrome this is always true for the manifest's declared hosts. On
 * Firefox it reports the user's actual grant.
 *
 * `url` is the page URL, not a match pattern: the permissions API wants a
 * pattern, so the URL is normalized here.
 */
export async function hasHostAccess(url?: string): Promise<boolean> {
  const api = permissionApi();
  if (!api) {
    // No permissions API at all (Chrome before the namespace existed):
    // the manifest grant is the only grant there can be.
    return true;
  }

  const origins = requestableOrigins(url);
  if (origins.length === 0) {
    // A page the extension can never be granted access to.
    return false;
  }
  try {
    return await api.contains({ origins });
  } catch {
    // A malformed origin is not a reason to claim access.
    return false;
  }
}

/**
 * Ask the user to grant host access for the given page.
 *
 * Must be called from a user gesture: Firefox (like Chrome) only shows
 * the permission prompt for requests made in response to a click.
 *
 * Returns true when the grant was granted, false when the user refused.
 */
export async function requestHostAccess(url?: string): Promise<boolean> {
  const api = permissionApi();
  if (!api) {
    return true;
  }
  const origins = requestableOrigins(url);
  if (origins.length === 0) {
    return false;
  }
  try {
    return await api.request({ origins });
  } catch {
    // Firefox rejects a request for an origin the user already refused.
    return false;
  }
}

/**
 * The origin patterns to check or request for a page URL.
 *
 * The permissions API takes match patterns, not page URLs: an origin is
 * only covered by a pattern when the pattern includes its path wildcard.
 */
function requestableOrigins(url?: string): string[] {
  if (!url) return [...REQUESTABLE_ORIGINS];
  const pattern = originPatternFor(url);
  return pattern ? [pattern] : [];
}

/**
 * The origin pattern to request for a page URL.
 *
 * Firefox rejects permission requests for privileged pages (about:, moz-extension:)
 * and for origins it will never grant, so those return null rather than a
 * pattern that is guaranteed to fail.
 */
export function originPatternFor(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Privileged pages cannot be granted; requesting them always fails.
  if (!/^https?:$/.test(parsed.protocol)) return null;
  return `${parsed.protocol}//${parsed.host}/*`;
}
