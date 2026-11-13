import {
  hasHostAccess,
  isFirefox,
  originPatternFor,
  requestHostAccess,
} from '../browser-compat/host-permissions';

/**
 * Firefox MV3 treats manifest host permissions as opt-in. These tests pin
 * the detection and request behaviour that the popup banner depends on.
 */

/** Replace the global scope's extension namespaces for one test. */
function withPermissions(
  api: { contains?: unknown; request?: unknown } | undefined,
  run: () => Promise<void>,
): Promise<void> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previousBrowser = scope.browser;
  const previousChrome = scope.chrome;

  if (api === undefined) {
    delete scope.browser;
    delete scope.chrome;
  } else {
    scope.browser = { permissions: api };
    scope.chrome = { permissions: api };
  }

  return run().finally(() => {
    if (previousBrowser === undefined) delete scope.browser;
    else scope.browser = previousBrowser;
    if (previousChrome === undefined) delete scope.chrome;
    else scope.chrome = previousChrome;
  });
}

describe('host permissions', () => {
  const originalUserAgent = navigator.userAgent;

  const setUserAgent = (value: string) => {
    Object.defineProperty(navigator, 'userAgent', {
      value,
      configurable: true,
    });
  };

  afterEach(() => {
    setUserAgent(originalUserAgent);
  });

  describe('isFirefox', () => {
    it('detects Firefox', () => {
      setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0',
      );
      expect(isFirefox()).toBe(true);
    });

    it('detects Firefox on iOS', () => {
      setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
      );
      expect(isFirefox()).toBe(true);
    });

    it('does not claim Chrome is Firefox', () => {
      setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );
      expect(isFirefox()).toBe(false);
    });

    it('does not claim Edge is Firefox', () => {
      setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      );
      expect(isFirefox()).toBe(false);
    });
  });

  describe('originPatternFor', () => {
    it('maps an https page to its origin pattern', () => {
      expect(originPatternFor('https://example.com/a/b?q=1')).toBe(
        'https://example.com/*',
      );
    });

    it('keeps a non-default port in the host', () => {
      expect(originPatternFor('http://localhost:3000/page')).toBe(
        'http://localhost:3000/*',
      );
    });

    it('refuses privileged pages that can never be granted', () => {
      expect(originPatternFor('about:blank')).toBeNull();
      expect(originPatternFor('about:addons')).toBeNull();
      expect(originPatternFor('moz-extension://abc/page.html')).toBeNull();
      expect(originPatternFor('file:///tmp/page.html')).toBeNull();
      expect(originPatternFor('chrome://extensions')).toBeNull();
    });

    it('refuses a missing or malformed url', () => {
      expect(originPatternFor(undefined)).toBeNull();
      expect(originPatternFor('not a url')).toBeNull();
    });
  });

  describe('hasHostAccess', () => {
    it('is true when the permissions API reports the origin granted', async () => {
      await withPermissions(
        { contains: jest.fn().mockResolvedValue(true) },
        async () => {
          await expect(hasHostAccess('https://example.com')).resolves.toBe(
            true,
          );
        },
      );
    });

    it('is false when the origin is not granted', async () => {
      await withPermissions(
        { contains: jest.fn().mockResolvedValue(false) },
        async () => {
          await expect(hasHostAccess('https://example.com')).resolves.toBe(
            false,
          );
        },
      );
    });

    it('checks the specific origin, not the whole set', async () => {
      const contains = jest.fn().mockResolvedValue(true);
      await withPermissions({ contains }, async () => {
        await hasHostAccess('https://example.com');
      });
      expect(contains).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
    });

    it('is true without a permissions API: the manifest grant is the grant', async () => {
      await withPermissions(undefined, async () => {
        await expect(hasHostAccess('https://example.com')).resolves.toBe(true);
      });
    });

    it('is false when the API throws', async () => {
      await withPermissions(
        { contains: jest.fn().mockRejectedValue(new Error('nope')) },
        async () => {
          await expect(hasHostAccess('https://example.com')).resolves.toBe(
            false,
          );
        },
      );
    });
  });

  describe('requestHostAccess', () => {
    it('reports the user granting access', async () => {
      await withPermissions(
        { request: jest.fn().mockResolvedValue(true) },
        async () => {
          await expect(
            requestHostAccess('https://example.com/*'),
          ).resolves.toBe(true);
        },
      );
    });

    it('reports the user refusing access', async () => {
      await withPermissions(
        { request: jest.fn().mockResolvedValue(false) },
        async () => {
          await expect(
            requestHostAccess('https://example.com/*'),
          ).resolves.toBe(false);
        },
      );
    });

    it('requests the given origin pattern', async () => {
      const request = jest.fn().mockResolvedValue(true);
      await withPermissions({ request }, async () => {
        await requestHostAccess('https://example.com/*');
      });
      expect(request).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
    });

    it('is false when the request throws', async () => {
      await withPermissions(
        { request: jest.fn().mockRejectedValue(new Error('denied')) },
        async () => {
          await expect(
            requestHostAccess('https://example.com/*'),
          ).resolves.toBe(false);
        },
      );
    });

    it('is true without a permissions API', async () => {
      await withPermissions(undefined, async () => {
        await expect(
          requestHostAccess('https://example.com/*'),
        ).resolves.toBe(true);
      });
    });
  });
});
