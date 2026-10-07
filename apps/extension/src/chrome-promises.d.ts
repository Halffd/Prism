/**
 * Promise-style overloads for the installed @types/chrome (0.0.114), which
 * predates MV3 promise support. Manifest V3 returns promises when the callback
 * argument is omitted; these merged overloads restore that behavior for the
 * APIs used by this extension.
 *
 * Declaration merging appends these signatures to the existing callback
 * signatures, so callback-style calls keep working unchanged.
 */
declare namespace chrome.storage {
  interface StorageArea {
    get(
      keys?: string | string[] | { [key: string]: any } | null,
    ): Promise<{ [key: string]: any }>;
    set(items: { [key: string]: any }): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    clear(): Promise<void>;
  }
}

declare namespace chrome.tabs {
  function query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  function sendMessage(
    tabId: number,
    message: any,
    options?: chrome.tabs.MessageSendOptions,
  ): Promise<any>;
  function create(
    createProperties: chrome.tabs.CreateProperties,
  ): Promise<chrome.tabs.Tab>;
  function update(
    tabId: number,
    updateProperties: chrome.tabs.UpdateProperties,
  ): Promise<chrome.tabs.Tab>;
  function remove(tabIds: number | number[]): Promise<void>;
  function captureVisibleTab(
    windowId?: number,
    options?: chrome.tabs.CaptureVisibleTabOptions,
  ): Promise<string>;
}

declare namespace chrome.runtime {
  function sendMessage(
    message: any,
    options?: chrome.runtime.MessageOptions,
  ): Promise<any>;
}

declare namespace chrome.windows {
  function create(
    createData: chrome.windows.CreateData,
  ): Promise<chrome.windows.Window>;
  function get(
    windowId: number,
    getInfo?: chrome.windows.GetInfo,
  ): Promise<chrome.windows.Window>;
  function update(
    windowId: number,
    updateInfo: chrome.windows.UpdateInfo,
  ): Promise<chrome.windows.Window>;
}

/**
 * MV3 action namespace (this extension uses chrome.action.openPopup; the
 * installed typings only provide the MV2 browserAction namespace).
 */
declare namespace chrome.action {
  interface OnClickedData {
    modifiers: string[];
  }

  type OnClickedCallback = (tab: chrome.tabs.Tab, data?: OnClickedData) => void;

  function openPopup(): Promise<void>;
  function setTitle(details: { title: string | null }): Promise<void>;
  function getTitle(details: { windowId?: number }): Promise<string>;
  function setBadgeText(details: {
    text: string | null;
    tabId?: number;
  }): Promise<void>;
  function setBadgeBackgroundColor(details: {
    color: string;
    tabId?: number;
  }): Promise<void>;
  function setPopup(details: {
    popup: string | null;
    tabId?: number;
  }): Promise<void>;
  function getPopup(details: { tabId?: number }): Promise<string>;
  function enable(tabId?: number): Promise<void>;
  function disable(tabId?: number): Promise<void>;
  const onClicked: {
    addListener(callback: OnClickedCallback): void;
    removeListener(callback: OnClickedCallback): void;
  };
}
