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
    // Check the current display mode to determine how to open the chat
    chrome.storage.local.get(['displaySettings']).then((result) => {
      const settings = result.displaySettings;
      const displayMode = settings?.popupDisplayMode || 'popup';

      if (displayMode === 'iframe') {
        // For iframe mode, send a message to the content script to inject the iframe
        chrome.tabs.query({active: true, currentWindow: true}).then((tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'INJECT_IFRAME_CHAT' })
              .catch(error => {
                console.error('Error sending message to content script:', error);
                // Fallback to opening the popup if content script communication fails
                chrome.action.openPopup();
              });
          } else {
            // If no active tab, open the popup as fallback
            chrome.action.openPopup();
          }
        });
      } else {
        // For other modes, open the default popup
        chrome.action.openPopup();
      }
    }).catch(error => {
      console.error('Error getting display settings:', error);
      // Fallback to opening the popup if settings retrieval fails
      chrome.action.openPopup();
    });
    return;
  }

  if (request.type === 'INSERT_PROMPT_SHORTCUT') {
    // Relay the message to the popup
    chrome.runtime.sendMessage({
      type: 'INSERT_PROMPT_CONTENT',
      content: request.content
    }).catch(error => {
      // If sending to popup fails, open the popup and send it after it loads
      chrome.action.openPopup();
      // Store the content temporarily to be used when popup opens
      chrome.storage.local.set({ pendingPromptContent: request.content });
    });
    return;
  }

  if (request.type === 'TOGGLE_MODE') {
    // Store the mode state in chrome storage so the popup can access it
    const modeStateKey = `mode_${request.mode}`;
    chrome.storage.local.set({ [modeStateKey]: request.value });

    // Also send a message to the popup if it's open
    chrome.runtime.sendMessage({
      type: 'MODE_TOGGLED',
      mode: request.mode,
      value: request.value
    }).catch(error => {
      // Popup might not be open, that's OK
    });
    return;
  }
});

async function handleSendMessage(data: {
  content: string;
  context?: ContextData;
  images?: string[];
  conversationHistory?: Message[];
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
    const response = await client.sendMessage(data.content, data.context, undefined, data.images, data.conversationHistory);

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
    // Return an error response instead of throwing
    return {
      success: false,
      error: (error as Error).message || 'Failed to send message'
    };
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
  // Main context menu parent item
  chrome.contextMenus.create({
    id: 'prism-main',
    title: 'Prism AI Assistant',
    contexts: ['all']
  });

  // Submenu items
  chrome.contextMenus.create({
    id: 'prism-explain',
    parentId: 'prism-main',
    title: 'Explain "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'prism-summarize',
    parentId: 'prism-main',
    title: 'Summarize this page',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'prism-analyze',
    parentId: 'prism-main',
    title: 'Analyze this content',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'prism-translate',
    parentId: 'prism-main',
    title: 'Translate selection',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'prism-fix-grammar',
    parentId: 'prism-main',
    title: 'Fix grammar/spelling',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'prism-code-explain',
    parentId: 'prism-main',
    title: 'Explain this code',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  let prompt = '';

  if (info.menuItemId === 'prism-explain' && info.selectionText) {
    prompt = `Explain the following text:\n\n${info.selectionText}`;
  } else if (info.menuItemId === 'prism-summarize') {
    prompt = `Please summarize the content of this page: ${tab?.url}`;
  } else if (info.menuItemId === 'prism-analyze' && info.selectionText) {
    prompt = `Analyze the following content:\n\n${info.selectionText}`;
  } else if (info.menuItemId === 'prism-analyze' && !info.selectionText) {
    prompt = `Analyze the content of this page: ${tab?.url}`;
  } else if (info.menuItemId === 'prism-translate' && info.selectionText) {
    prompt = `Translate the following text to English:\n\n${info.selectionText}`;
  } else if (info.menuItemId === 'prism-fix-grammar' && info.selectionText) {
    prompt = `Fix grammar and spelling in the following text:\n\n${info.selectionText}`;
  } else if (info.menuItemId === 'prism-code-explain' && info.selectionText) {
    prompt = `Explain the following code:\n\n${info.selectionText}`;
  }

  if (prompt) {
    // Open popup or sidebar with the constructed prompt
    chrome.storage.local.set({
      pendingQuery: prompt,
      contextUrl: tab?.url,
      contextTitle: tab?.title
    });

    // Open popup
    chrome.action.openPopup();
  }
});

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === '_execute_action') {
    // Open the popup when the keyboard shortcut is triggered
    chrome.action.openPopup();
  }
});

// Also listen for the extension icon click to open the popup
chrome.action.onClicked.addListener(() => {
  chrome.action.openPopup();
});

console.log('Prism background service worker loaded! 🔥');