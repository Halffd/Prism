import { deserialize, serialize } from 'node:v8';
import { TextDecoder, TextEncoder } from 'node:util';
import {
  ReadableStream,
  TransformStream,
  WritableStream,
  CompressionStream,
  DecompressionStream,
} from 'node:stream/web';
import 'fake-indexeddb/auto';

// jsdom does not provide these globals, but jsdom itself (whatwg-url) and
// several dependencies (undici via firebase/auth) require them at import time.
const webStreamGlobals = {
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  CompressionStream,
  DecompressionStream,
} as unknown as Record<string, unknown>;

for (const [name, implementation] of Object.entries(webStreamGlobals)) {
  if (!global[name]) {
    global[name] = implementation;
  }
}

// jsdom also omits structuredClone, which fake-indexeddb relies on. Node's
// global implementation is not reachable from the jsdom sandbox; v8
// serialize/deserialize gives the same synchronous deep-copy semantics.
if (!global.structuredClone) {
  global.structuredClone = <T>(value: T): T =>
    deserialize(serialize(value)) as T;
}

const chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: jest.fn(),
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 123 }])), // Mock to return an array with a tab object
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({ history: [] })), // Mock to return an object with history
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
  action: {
    openPopup: jest.fn(),
  },
  contextMenus: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
};

// configurable: tests delete this global in afterEach hooks
Object.defineProperty(global, 'chrome', {
  value: chrome,
  writable: true,
  configurable: true,
});

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();
