import { UnifiedAIClient } from '@prism/api-client';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: 'http://localhost:3000/api'
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

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

  if (request.type === 'UPDATE_AI_CONFIG') {
    updateAIConfig(request.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (request.type === 'GET_AI_CONFIG') {
    getAIConfig()
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
  images?: string[];
  conversationHistory?: any[];
  aiConfig?: AIConfig;
}) {
  try {
    // Update client if new AI config is provided
    if (data.aiConfig) {
      client = new UnifiedAIClient({
        aiConfig: data.aiConfig,
        prismApiUrl: data.aiConfig.apiUrl
      });
    }

    // Pass the conversation history to the AI client
    const response = await client.sendMessage(data.content, data.context, data.conversationHistory, data.images);

    // Store in chrome.storage for history
    if (response.success && response.data) {
      const history = await getHistory();
      // Make sure we're not duplicating the response
      // The response.data is already the assistant message, so we just need to add it
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
    // Get extension settings to pass token limits
    const result = await chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings;
    const pageContentTokenLimit = settings?.pageContentTokenLimit || 20000;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'EXTRACT_CONTEXT',
      pageContentTokenLimit
    });

    return response;
  } catch (error) {
    console.error('Error getting context:', error);
    throw error;
  }
}

async function getAIConfig() {
  const result = await chrome.storage.local.get('aiConfig');
  return result.aiConfig || defaultAIConfig;
}

async function updateAIConfig(config: AIConfig) {
  await chrome.storage.local.set({ aiConfig: config });
  client = new UnifiedAIClient({
    aiConfig: config,
    prismApiUrl: config.apiUrl
  });
  return { success: true };
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