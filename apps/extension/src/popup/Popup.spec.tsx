import React from 'react';
import { render, screen } from '@testing-library/react';
import { Popup } from './Popup';

// Mock the chrome API
jest.mock('chrome', () => ({
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
    sendMessage: jest.fn(),
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  },
  storage: {
    local: {
      get: jest.fn(),
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
    render(<Popup />);
    expect(screen.getByText('💎 Prism')).toBeTruthy();
  });
});
