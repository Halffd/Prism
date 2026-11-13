import React, { useCallback, useEffect, useState } from 'react';
import {
  hasHostAccess,
  isFirefox,
  originPatternFor,
  requestHostAccess,
} from '../browser-compat/host-permissions';

/**
 * Firefox MV3 treats the manifest's host permissions as opt-in. Until the
 * user grants access to the current page, the content script does not run
 * there and Prism has no page context, no selection capture and no inline
 * chat. This banner makes that state visible and gives the user the one
 * action that resolves it.
 *
 * On Chrome the grant is implicit, so the banner never appears.
 */
export function PermissionBanner(): React.ReactElement | null {
  const [needsAccess, setNeedsAccess] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [granted, setGranted] = useState(false);
  const [pageUrl, setPageUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Chrome grants the manifest hosts at install time; only Firefox needs
    // the check, and asking on Chrome would add a round trip for nothing.
    if (!isFirefox()) return;

    let cancelled = false;
    const check = async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = tab?.url;
        if (cancelled) return;
        setPageUrl(url);

        // A page the extension can never be granted (about:, the add-ons
        // store, the browser UI) needs no banner: there is no origin to
        // ask for and no context to capture.
        if (!originPatternFor(url)) {
          setNeedsAccess(false);
          return;
        }
        const access = await hasHostAccess(url);
        if (cancelled) return;
        setNeedsAccess(!access);
      } catch {
        // If the check itself fails, do not block the user with a banner
        // whose action may also fail.
        if (!cancelled) setNeedsAccess(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const grant = useCallback(async () => {
    setRequesting(true);
    try {
      const ok = await requestHostAccess(pageUrl);
      if (ok) {
        setGranted(true);
        setNeedsAccess(false);
      }
    } finally {
      setRequesting(false);
    }
  }, [pageUrl]);

  if (!needsAccess) return null;

  if (granted) {
    return (
      <div className="permission-banner granted" role="status">
        <span className="permission-banner-text">
          Access granted. Reload this page to let Prism read it.
        </span>
        <button
          type="button"
          className="permission-banner-reload"
          onClick={() => {
            void chrome.tabs.reload({});
          }}
        >
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="permission-banner" role="alert">
      <span className="permission-banner-text">
        Prism needs access to this page to read its content and selection.
      </span>
      <button
        type="button"
        className="permission-banner-button"
        disabled={requesting}
        onClick={() => void grant()}
      >
        {requesting ? 'Requesting…' : 'Grant access'}
      </button>
    </div>
  );
}

export default PermissionBanner;
