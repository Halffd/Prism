
const chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
    sendMessage: jest.fn(),
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 123 }])), // Mock to return an array with a tab object
    sendMessage: jest.fn(),
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

Object.defineProperty(global, 'chrome', {
  value: chrome,
  writable: true,
});

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();
