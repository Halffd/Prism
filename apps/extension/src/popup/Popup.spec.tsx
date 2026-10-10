import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '@prism/redux-store';
import { Popup } from './Popup';

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

// Mock the chrome API
jest.mock('chrome', () => ({
  runtime: {
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: jest.fn(),
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 123 }])),
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  },
  storage: {
    local: {
      get: jest.fn((...args: unknown[]) => {
        const callback = args.find((arg) => typeof arg === 'function');
        return callback ? undefined : Promise.resolve({});
      }),
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
}));

describe('Popup', () => {
  it('should render successfully', () => {
    render(
      <Provider store={store}>
        <Popup />
      </Provider>,
    );
    expect(screen.getByText('💎 Prism')).toBeTruthy();
  });
});
