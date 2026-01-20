// Type definitions for Chrome Extension APIs
declare global {
  interface Window {
    chrome: typeof chrome;
  }

  var chrome: {
    storage: {
      local: {
        get: (keys: string | string[] | null) => Promise<any>;
        set: (items: { [key: string]: any }) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
        clear: () => Promise<void>;
      };
    };
    runtime: {
      onMessage: {
        addListener: (callback: (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void) => void;
        removeListener: (callback: Function) => void;
      };
      sendMessage: (message: any) => Promise<any>;
      openPopup: () => void;
    };
    tabs: {
      query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
      sendMessage: (tabId: number, message: any) => Promise<any>;
      captureVisibleTab: (windowId?: number, options?: chrome.tabs.CaptureVisibleTabOptions) => Promise<string>;
    };
    contextMenus: {
      create: (createProperties: chrome.contextMenus.CreateProperties) => void;
      onClicked: {
        addListener: (callback: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) => void;
      };
    };
    action: {
      openPopup: () => void;
      onClicked: {
        addListener: (callback: () => void) => void;
      };
    };
    commands: {
      onCommand: {
        addListener: (callback: (command: string) => void) => void;
      };
    };
  };
}

export {};