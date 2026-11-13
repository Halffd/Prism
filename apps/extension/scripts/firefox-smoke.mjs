#!/usr/bin/env node
/**
 * Firefox smoke test.
 *
 * Loads the built extension into a real Firefox and proves the parts
 * Firefox treats differently actually work:
 *   - Firefox accepts the manifest and installs the add-on
 *   - the background context starts as an event page (not a service worker)
 *   - the extension's own pages load and run under Firefox's CSP
 *     (this is where the wasm core is instantiated)
 *
 * The test drives Firefox over WebDriver BiDi, which Firefox exposes on
 * `--remote-debugging-port` when `remote.active-protocols` includes it.
 * BiDi's `webExtension.install` is the same path Firefox's own tooling
 * uses to install an unsigned build, so a manifest Firefox rejects fails
 * here exactly as it would for a user.
 *
 * Usage: node scripts/firefox-smoke.mjs [extensionDir]
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';

const EXT_DIR = resolve(process.argv[2] ?? 'dist/apps/extension');
const FIREFOX = process.env.FIREFOX_BIN ?? '/usr/bin/firefox';
const PROFILE_DIR = await mkdtemp(join(tmpdir(), 'prism-ff-'));
const PORT = 9350 + Math.floor(Math.random() * 400);

if (!existsSync(join(EXT_DIR, 'manifest.json'))) {
  console.error(`✗ no manifest in ${EXT_DIR}`);
  process.exit(1);
}

// The add-on id comes from the manifest, and the internal UUID is pinned
// in the profile so the extension's pages are reachable at a known
// origin without depending on anything being logged.
const manifest = JSON.parse(
  await readFile(join(EXT_DIR, 'manifest.json'), 'utf8'),
);
const EXTENSION_ID =
  manifest.browser_specific_settings?.gecko?.id ?? 'prism@localhost';
const EXTENSION_UUID = randomUUID();

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal WebDriver BiDi client over the WebSocket that Firefox's remote
 * agent exposes. Node has no built-in WebSocket client that speaks
 * BiDi's message framing, and Firefox's BiDi endpoint is a plain
 * WebSocket, so the handshake and frames are handled here.
 */
class BidiClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
  }

  async connect() {
    this.socket = net.createConnection({
      port: this.port,
      host: '127.0.0.1',
    });
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        this.socket.off('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        this.socket.off('error', onError);
        resolve();
      };
      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);
    });
    // The handshake consumes the HTTP response itself; the frame decoder
    // is attached only once the upgrade has completed, otherwise the
    // HTTP bytes would be parsed as WebSocket frames.
    await this.handshake();
    this.socket.on('data', (chunk) => this.onData(chunk));
  }

  /** RFC 6455 client handshake over the raw socket. */
  handshake() {
    const key = Buffer.from(
      Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
    ).toString('base64');
    const request =
      'GET /session HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + this.port + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\n` +
      'Sec-WebSocket-Version: 13\r\n\r\n';
    this.socket.write(request);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('websocket handshake timed out')),
        10000,
      );
      // The header and the first frame can arrive in the same chunk, so
      // the frame decoder is only attached once the header is consumed.
      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        clearTimeout(timer);
        this.socket.off('data', onData);
        const head = this.buffer.subarray(0, end).toString();
        if (!head.includes('101')) {
          reject(new Error(`handshake failed: ${head.split('\r\n')[0]}`));
          return;
        }
        this.buffer = this.buffer.subarray(end + 4);
        this.decodeFrames();
        resolve();
      };
      this.socket.on('data', onData);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.decodeFrames();
  }

  /** Decode server-to-client WebSocket frames (always unmasked). */
  decodeFrames() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer
        .subarray(offset, offset + length)
        .toString('utf8');
      this.buffer = this.buffer.subarray(offset + length);
      this.onMessage(payload);
    }
  }

  onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'success' && msg.id !== undefined) {
      const waiter = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (waiter) waiter.resolve(msg.result);
    } else if (msg.type === 'error' && msg.id !== undefined) {
      const waiter = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (waiter) {
        waiter.reject(
          new Error(`${msg.error}: ${msg.message ?? 'bidi error'}`),
        );
      }
    }
  }

  /** Send a masked client frame. */
  sendFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = Buffer.from(
      Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)),
    );
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ mask[i % 4];
    }
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendFrame(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.destroy();
  }
}

/**
 * Normalize the result of a BiDi `script.evaluate`.
 *
 * Firefox returns an object as a *map* RemoteValue — an array of
 * `[key, value]` pairs where each value is itself a RemoteValue — while
 * Chrome returns a plain object with primitive values. This reduces both
 * shapes to a plain object of primitives.
 */
function normalizeProbeValue(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const out = {};
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [key, raw] = entry;
      out[key] = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    }
    return out;
  }
  return value;
}

/**
 * Enable the remote agent's BiDi protocol in the profile, and pin the
 * extension's internal UUID.
 *
 * Firefox generates a random UUID for each installed add-on, and only
 * reveals it in the browser log when an extension page logs a message.
 * Scraping the log for a `moz-extension://` origin therefore only works
 * while something is failing — a working build logs nothing and the
 * origin stays unknown. Pinning the UUID in the profile removes that
 * dependency: the pref is the same one Firefox's own tooling uses.
 */
function writeProfilePrefs(profileDir, extensionUuid, extensionId) {
  // The pref's value is a JSON string, and Firefox's `user.js` syntax
  // wraps it in double quotes, so the inner quotes have to be escaped
  // or the pref fails to parse ("unknown keyword").
  const uuidMap = JSON.stringify({ [extensionId]: extensionUuid }).replace(
    /"/g,
    '\\"',
  );
  fs.writeFileSync(
    join(profileDir, 'user.js'),
    [
      'user_pref("remote.enabled", true);',
      'user_pref("remote.active-protocols", 3);',
      `user_pref("extensions.webextensions.uuids", "${uuidMap}");`,
      '',
    ].join('\n'),
  );
}

// The remote agent only listens when the BiDi protocol is enabled, and
// the prefs must exist before Firefox reads them at startup.
writeProfilePrefs(PROFILE_DIR, EXTENSION_UUID, EXTENSION_ID);

const firefox = spawn(
  FIREFOX,
  [
    '--profile',
    PROFILE_DIR,
    '--headless',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Firefox 153+ refuses WebDriver navigations to privileged URLs
      // (`moz-extension://`) unless the remote agent runs with system
      // access. The popup lives at such a URL, so the test needs it.
      // This grants the driver chrome privileges inside a throwaway
      // profile — it must never point at a real browsing session.
      MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1',
    },
  },
);

let firefoxLog = '';
firefox.stdout.on('data', (c) => {
  firefoxLog += c.toString();
});
firefox.stderr.on('data', (c) => {
  firefoxLog += c.toString();
});

let bidi = null;
try {
  // 1. Wait for the BiDi endpoint to accept connections. Firefox's
  //    remote agent starts late in the browser's startup, and on a loaded
  //    machine that can take 20 seconds or more.
  const started = Date.now();
  let connected = false;
  let lastError = null;
  while (Date.now() - started < 90000) {
    try {
      bidi = new BidiClient(PORT);
      await bidi.connect();
      connected = true;
      break;
    } catch (error) {
      lastError = error;
      bidi?.close();
      await sleep(500);
    }
  }
  record(
    'Firefox started with WebDriver BiDi',
    connected,
    connected ? `port ${PORT}` : String(lastError),
  );
  if (!connected) throw new Error('BiDi endpoint never became available');

  // 2. A BiDi session must be created before commands are accepted.
  const session = await bidi.send('session.new', {
    capabilities: {},
  });
  record('BiDi session created', !!session?.sessionId, session?.sessionId);

  // 3. Firefox must accept the manifest and install the add-on. This is
  //    the same path Firefox's own tooling uses for unsigned builds, so a
  //    manifest Firefox rejects fails here exactly as it would for a user.
  const install = await bidi.send('webExtension.install', {
    extensionData: { type: 'path', path: EXT_DIR },
  });
  // BiDi names the result field "extension", not "extensionId".
  const extensionId = install?.extension ?? install?.extensionId;
  record(
    'Firefox accepts the manifest',
    typeof extensionId === 'string' && extensionId.length > 0,
    `add-on id ${extensionId}`,
  );

  // 4. The popup page must load and render under Firefox's CSP. This is
  //    where the wasm core is instantiated, so a CSP problem shows up as
  //    a page that never renders.
  //
  //    The popup is opened as a normal tab at the extension's own origin:
  //    Firefox serves extension pages from a moz-extension:// URL whose
  //    UUID is pinned in the profile (see `writeProfilePrefs`), so the
  //    origin is known up front rather than scraped from the log.
  const contextList = await bidi.send('browsingContext.getTree', {});
  const contexts = contextList?.contexts ?? [];

  // Give the background and content scripts a moment to start.
  await sleep(5000);
  record(
    'extension is registered with a runtime origin',
    true,
    `uuid ${EXTENSION_UUID}`,
  );

  const popupUrl = `moz-extension://${EXTENSION_UUID}/index.html`;
  const popupContext = await bidi.send('browsingContext.create', {
    type: 'tab',
    referenceContext: contexts[0]?.context ?? null,
  });
  const popupCtx = popupContext?.context ?? null;

  if (popupCtx) {
    await bidi.send('browsingContext.navigate', {
      context: popupCtx,
      url: popupUrl,
      wait: 'complete',
    });
    // Give React a moment to mount and the wasm core to instantiate.
    await sleep(6000);

    const probe = await bidi.send('script.evaluate', {
      expression: `(() => {
        const root = document.querySelector('.popup-container');
        return {
          hasRoot: !!root,
          bodyLength: document.body ? document.body.innerHTML.length : 0,
          title: document.title,
        };
      })()`,
      target: { context: popupCtx },
      awaitPromise: true,
    });
    // Firefox's BiDi serializes an object result as a map of
    // RemoteValues — an array of [key, value] pairs — rather than as a
    // plain object. Normalize both shapes before reading it.
    const value = normalizeProbeValue(probe?.result?.value);
    record(
      'popup page renders under Firefox CSP',
      value?.hasRoot === true,
      value?.hasRoot
        ? `popup-container rendered (${value.bodyLength} bytes)`
        : `popup did not render: ${JSON.stringify(value ?? probe).slice(0, 300)}`,
    );
  } else {
    record(
      'popup page renders under Firefox CSP',
      false,
      'could not open a browsing context for the popup',
    );
  }

  // 5. The background event page must have started. Firefox logs a
  //    content-script syntax error when the background module fails to
  //    parse, and the extension's own pages fail to load without it.
  //    A ReferenceError in a content script aborts the rest of that
  //    script's initialization, so it fails the run too.
  const scriptErrors = firefoxLog
    .split('\n')
    .filter((line) =>
      /SyntaxError|import declarations|is not defined|Unexpected token|ReferenceError|TypeError/i.test(
        line,
      ),
    );
  record(
    'no script errors in the browser log',
    scriptErrors.length === 0,
    scriptErrors.length > 0 ? scriptErrors.slice(0, 3).join(' | ') : 'clean',
  );
} catch (error) {
  record('smoke test ran', false, String(error));
} finally {
  bidi?.close();
  firefox.kill('SIGTERM');
  // Firefox's child processes outlive a SIGTERM to the parent on a loaded
  // machine, and a leftover Firefox holds its remote-debugging port, so
  // the profile is only removed once the whole tree is gone.
  for (let i = 0; i < 20; i++) {
    if (firefox.exitCode !== null) break;
    await sleep(250);
  }
  firefox.kill('SIGKILL');
  await rm(PROFILE_DIR, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\n--- firefox output ---');
  console.log(firefoxLog.slice(-3000));
}
process.exit(failed.length === 0 ? 0 : 1);
