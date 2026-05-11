import { UnifiedAIClient } from '@prism/api-client';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';

const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: 'http://localhost:3000/api'
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEND_MESSAGE') {
    handleSendMessage(request.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
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
    chrome.storage.local.get(['displaySettings']).then((result) => {
      const settings = result.displaySettings;
      const displayMode = settings?.popupDisplayMode || 'popup';

      if (displayMode === 'iframe') {
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'INJECT_IFRAME_CHAT' })
              .catch(() => {
                openChatInNewTab();
              });
          } else {
            openChatInNewTab();
          }
        });
      } else if (displayMode === 'newtab') {
        openChatInNewTab();
      } else {
        chrome.action.openPopup().catch(() => {
          openChatInNewTab();
        });
      }
    }).catch(() => {
      openChatInNewTab();
    });
    return;
  }

  if (request.type === 'INSERT_PROMPT_SHORTCUT') {
    chrome.runtime.sendMessage({
      type: 'INSERT_PROMPT_CONTENT',
      content: request.content
    }).catch(() => {
      chrome.storage.local.set({ pendingPromptContent: request.content });
      openChatInNewTab();
    });
    return;
  }

  if (request.type === 'TOGGLE_MODE') {
    const modeStateKey = `mode_${request.mode}`;
    chrome.storage.local.set({ [modeStateKey]: request.value });
    chrome.runtime.sendMessage({
      type: 'MODE_TOGGLED',
      mode: request.mode,
      value: request.value
    }).catch(() => {});
    return;
  }
});

function openChatInNewTab(query?: string) {
  const chatUrl = query
    ? chrome.runtime.getURL(`chat.html?q=${encodeURIComponent(query)}`)
    : chrome.runtime.getURL('chat.html');
  chrome.tabs.create({ url: chatUrl });
}

async function handleSendMessage(data: {
  content: string;
  context?: ContextData;
  images?: string[];
  conversationHistory?: Message[];
  aiConfig?: AIConfig;
}) {
  try {
    if (data.aiConfig) {
      client = new UnifiedAIClient({
        aiConfig: data.aiConfig,
        prismApiUrl: data.aiConfig.apiUrl
      });
    }

    const response = await client.sendMessage(data.content, data.context, undefined, data.images, data.conversationHistory);

    if (response.success && response.data) {
      const history = await getHistory();
      history.push(response.data);
      await chrome.storage.local.set({ history });
    }

    return response;
  } catch (error) {
    console.error('Error in background:', error);
    return {
      success: false,
      error: (error as Error).message || 'Failed to send message'
    };
  }
}

async function handleGetContext(tabId?: number) {
  if (!tabId) return { error: 'No active tab' };

  try {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'prism-main',
    title: 'Prism AI Assistant',
    contexts: ['all']
  });

  chrome.contextMenus.create({
    id: 'prism-new-chat',
    parentId: 'prism-main',
    title: 'Open New Chat Window',
    contexts: ['page', 'selection']
  });

  chrome.contextMenus.create({
    id: 'prism-separator-1',
    parentId: 'prism-main',
    type: 'separator',
    contexts: ['page', 'selection']
  });

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

  if (info.menuItemId === 'prism-new-chat') {
    if (info.selectionText) {
      prompt = info.selectionText;
    }
    chrome.storage.local.set({
      pendingQuery: prompt || '',
      contextUrl: tab?.url,
      contextTitle: tab?.title
    });
    openChatInNewTab(prompt || undefined);
    return;
  }

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
    chrome.storage.local.set({
      pendingQuery: prompt,
      contextUrl: tab?.url,
      contextTitle: tab?.title
    });

    chrome.action.openPopup().catch(() => {
      openChatInNewTab(prompt);
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-chat-tab') {
    openChatInNewTab();
  }
});

console.log('Prism background service worker loaded!');
