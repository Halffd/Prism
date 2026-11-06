import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store, setOpenTabs, setCurrentSessionId } from '@prism/redux-store';
import { Popup } from '../popup/Popup';

jest.mock('../auth-provider', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    loading: false,
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    updateProfile: jest.fn(),
  }),
}));

// The popup asks the API client for the provider's model list on mount.
// Without a stub the client makes a real HTTP request, which hangs the
// test on a machine that has no backend running.
jest.mock('@prism/api-client', () => {
  class UnifiedAIClient {
    updateAIConfig = jest.fn();
    sendMessage = jest.fn();
    getAvailableModels = jest.fn().mockResolvedValue([]);
  }
  return {
    UnifiedAIClient,
    networkStatusService: {
      isCurrentlyOnline: jest.fn().mockReturnValue(true),
      addNetworkStatusListener: jest.fn(),
      removeNetworkStatusListener: jest.fn(),
      updateApiUrl: jest.fn(),
      destroy: jest.fn(),
    },
  };
});

/**
 * An in-memory stand-in for `chrome.storage.local`.
 *
 * The real storage is a promise-based key/value store; the popup only uses
 * `get` and `set`, so a plain map reproduces the behaviour it depends on.
 */
class FakeStorage {
  /** @type {Map<string, unknown> */
  private data = new Map();

  get(keys?: string | string[] | null) {
    if (keys === undefined || keys === null) {
      return Promise.resolve(Object.fromEntries(this.data));
    }
    const names = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const name of names) {
      if (this.data.has(name)) {
        result[name] = this.data.get(name);
      }
    }
    return Promise.resolve(result);
  }

  set(values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) {
      this.data.set(key, value);
    }
    return Promise.resolve();
  }

  remove(keys: string | string[]) {
    const names = Array.isArray(keys) ? keys : [keys];
    for (const name of names) {
      this.data.delete(name);
    }
    return Promise.resolve();
  }

  /** The raw stored value, for assertions. */
  peek(key: string) {
    return this.data.get(key);
  }
}

describe('Popup chat tabs', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    (chrome.storage.local.get as jest.Mock).mockImplementation(
      (keys?: string | string[] | null) => storage.get(keys),
    );
    (chrome.storage.local.set as jest.Mock).mockImplementation(
      (values: Record<string, unknown>) => storage.set(values),
    );
    (chrome.storage.local.remove as jest.Mock).mockImplementation(
      (keys: string | string[]) => storage.remove(keys),
    );

    // The store is a module singleton, so the open tabs of one test would
    // still be there in the next one.
    store.dispatch(setOpenTabs([]));
    store.dispatch(setCurrentSessionId(''));
  });

  it('shows a tab strip and keeps the open tabs across a remount', async () => {
    const first = render(
      <Provider store={store}>
        <Popup />
      </Provider>,
    );

    // The popup opens on a tab, even before any chat exists.
    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBeGreaterThan(
        0,
      );
    });

    fireEvent.click(screen.getByLabelText('New chat'));

    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBe(2);
    });

    const stored = storage.peek('chatTabs') as {
      openTabs: string[];
      activeTabId: string;
    };
    expect(stored.openTabs).toHaveLength(2);
    expect(stored.activeTabId).toBe(stored.openTabs[1]);

    first.unmount();

    // A fresh mount of the popup restores the same tabs, which is what
    // happens when the user closes and reopens the popup.
    render(
      <Provider store={store}>
        <Popup />
      </Provider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBe(2);
    });

    const afterReload = storage.peek('chatTabs') as {
      openTabs: string[];
    };
    expect(afterReload.openTabs).toEqual(stored.openTabs);
  });

  it('closes a tab and keeps the remaining one', async () => {
    render(
      <Provider store={store}>
        <Popup />
      </Provider>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBeGreaterThan(
        0,
      );
    });

    fireEvent.click(screen.getByLabelText('New chat'));

    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBe(2);
    });

    // Close the tab that was just opened.
    const closeButtons = document.querySelectorAll('.chat-tab-close');
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    await waitFor(() => {
      expect(document.querySelectorAll('.chat-tab').length).toBe(1);
    });

    const stored = storage.peek('chatTabs') as { openTabs: string[] };
    expect(stored.openTabs).toHaveLength(1);
  });
});
