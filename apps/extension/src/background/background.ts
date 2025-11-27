import { PrismClient } from '@prism/api-client';
import type { Message, ContextData } from '@prism/shared-types';

const client = new PrismClient('http://localhost:3000/api');

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEND_MESSAGE') {
    handleSendMessage(request.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.type === 'GET_CONTEXT') {
    handleGetContext(sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.type === 'OPEN_CHAT') {
    chrome.action.openPopup();
    return;
  }
});

async function handleSendMessage(data: {
  content: string;
  context?: ContextData;
}) {
  try {
    const response = await client.sendMessage(data.content, data.context);
    
    // Store in chrome.storage for history
    if (response.success && response.data) {
      const history = await getHistory();
      history.push(response.data);
      await chrome.storage.local.set({ history });
    }

    return response;
  } catch (error) {
    console.error('Error in background:', error);
    throw error;
  }
}

async function handleGetContext(tabId?: number) {
  if (!tabId) return { error: 'No active tab' };

  try {
    // Inject content script if not already injected
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EXTRACT_CONTEXT'
    });

    return response;
  } catch (error) {
    console.error('Error getting context:', error);
    throw error;
  }
}

async function getHistory(): Promise<Message[]> {
  const result = await chrome.storage.local.get('history');
  return result.history || [];
}

// Context menu (right-click)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'prism-explain',
    title: 'Ask Prism about "%s"',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'prism-explain' && info.selectionText) {
    // Open popup or sidebar with selected text
    chrome.storage.local.set({ 
      pendingQuery: info.selectionText,
      contextUrl: tab?.url,
      contextTitle: tab?.title
    });
    
    // Open popup
    chrome.action.openPopup();
  }
});

console.log('Prism background service worker loaded! 🔥');