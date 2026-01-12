import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useAuth } from '../auth-provider';
import { supabaseAuthService } from '@prism/supabase-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  saveChatHistory,
  loadChatHistory,
  getChatSessions,
  deleteChatSession,
  ChatSession,
  savePromptShortcut,
  getPromptShortcuts,
  deletePromptShortcut,
  PromptShortcut
} from '@prism/shared-db';
import { UnifiedAIClient, networkStatusService } from '@prism/api-client';
import { ImageGenerationService } from '@prism/image-gen';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';
import {
  setMessages,
  addMessage,
  setLoading,
  setCurrentSessionId,
  setSessions,
  setSelectedProvider,
  setAIConfig,
  updateAIConfig,
  setContext,
  updateSession,
  removeSession,
  RootState
} from '@prism/redux-store';
import './Popup.scss';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: 'http://localhost:3000/api',
  providerKeys: {
    'openai': '',
    'gemini': '',
    'qwen': '',
    'prism-api': ''
  }
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

export function Popup() {
  const dispatch = useDispatch();
  const { messages, loading, currentSessionId, sessions } = useSelector((state: RootState) => state.chat);
  const { config: reduxAIConfig, availableModels, fetchingModels } = useSelector((state: RootState) => state.aiConfig);
  const { context: reduxContext } = useSelector((state: RootState) => state.context);
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle, signOut } = useAuth();

  const [input, setInput] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string>('');
  const [isIframeInjected, setIsIframeInjected] = useState<boolean>(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncIntervalId, setAutoSyncIntervalId] = useState<NodeJS.Timeout | null>(null);
  const [promptShortcuts, setPromptShortcuts] = useState<PromptShortcut[]>([]);
  const [isOnline, setIsOnline] = useState(true); // Track network status

  // Monitor network status
  useEffect(() => {
    const handleNetworkStatus = (status: { online: boolean }) => {
      setIsOnline(status.online);
    };

    networkStatusService.addNetworkStatusListener(handleNetworkStatus);

    // Set initial status
    setIsOnline(networkStatusService.isCurrentlyOnline());

    return () => {
      networkStatusService.removeNetworkStatusListener(handleNetworkStatus);
    };
  }, []);

  // Auto-sync functionality
  useEffect(() => {
    if (autoSyncEnabled) {
      // Sync every 30 seconds but only when online
      const interval = setInterval(() => {
        if (networkStatusService.isCurrentlyOnline()) {
          syncFromAPI().catch(console.error);
        }
      }, 30000);

      setAutoSyncIntervalId(interval);

      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    } else if (autoSyncIntervalId) {
      clearInterval(autoSyncIntervalId);
      setAutoSyncIntervalId(null);
    }
  }, [autoSyncEnabled, messages]);

  const toggleAutoSync = () => {
    setAutoSyncEnabled(!autoSyncEnabled);
  };

  const [showPrompts, setShowPrompts] = useState(false);
  const [newPrompt, setNewPrompt] = useState({
    name: '',
    content: '',
    category: '',
    shortcutKey: ''  // Adding shortcut key field
  });
  const [editingKeyboardShortcut, setEditingKeyboardShortcut] = useState<string | null>(null);
  const [currentKeyboardShortcut, setCurrentKeyboardShortcut] = useState<string>('');

  // Content sending options
  const [sendSelectedText, setSendSelectedText] = useState<boolean>(true);
  const [sendPageContents, setSendPageContents] = useState<boolean>(false);
  const [sendScreenshot, setSendScreenshot] = useState<boolean>(false);
  const [textSelectionMode, setTextSelectionMode] = useState<boolean>(false);
  const [pageContextMode, setPageContextMode] = useState<boolean>(false);
  const [pageScreenshotMode, setPageScreenshotMode] = useState<boolean>(false);
  const [clipboardMode, setClipboardMode] = useState<boolean>(false);
  const [pageInfoMode, setPageInfoMode] = useState<boolean>(false);

  // Image file upload state
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Image generation state
  const [imageGenerationPrompt, setImageGenerationPrompt] = useState<string>('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [imageGenerationModel, setImageGenerationModel] = useState<string>('stabilityai/stable-diffusion-2-1');
  const [imageGenerationApiKey, setImageGenerationApiKey] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load AI configuration from chrome storage
    chrome.storage.local.get(['aiConfig'], (result) => {
      if (result.aiConfig) {
        try {
          let config = result.aiConfig as AIConfig;

          // Ensure providerKeys exists and has all providers
          if (!config.providerKeys) {
            config.providerKeys = {
              'openai': config.apiKey || '',
              'gemini': config.apiKey || '',
              'qwen': config.apiKey || '',
              'prism-api': config.apiKey || config.apiUrl || ''
            };
          } else {
            // Ensure all provider keys exist
            config.providerKeys = {
              'openai': config.providerKeys['openai'] || '',
              'gemini': config.providerKeys['gemini'] || '',
              'qwen': config.providerKeys['qwen'] || '',
              'prism-api': config.providerKeys['prism-api'] || config.apiUrl || ''
            };
          }

          dispatch(setAIConfig(config));
          // Update the current provider's API key in the config before creating the client
          const updatedConfig = { ...config };
          if (updatedConfig.providerKeys) {
            updatedConfig.apiKey = updatedConfig.providerKeys[updatedConfig.provider] || '';
            if (updatedConfig.provider === 'prism-api') {
              updatedConfig.apiUrl = updatedConfig.providerKeys['prism-api'] || updatedConfig.apiUrl;
            }
          }

          dispatch(setAIConfig(updatedConfig));
          client = new UnifiedAIClient({
            aiConfig: updatedConfig,
            prismApiUrl: updatedConfig.apiUrl
          });

          // Fetch available models for the current provider
          fetchAvailableModels(updatedConfig);
        } catch (error) {
          console.error('Failed to load AI config, using default:', error);
          dispatch(setAIConfig(defaultAIConfig));
          client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
        }
      } else {
        dispatch(setAIConfig(defaultAIConfig));
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    });

    // Load history from local IndexedDB
    loadChatHistoryFromDB();

    // Load chat sessions from local IndexedDB
    loadChatSessionsFromDB();

    // Load prompt shortcuts from local IndexedDB
    loadPromptShortcuts();

    // Initialize image generation
    initializeImageGeneration();

    // Check for pending query (from context menu)
    checkPendingQuery();

    // Check for pending prompt content (from keyboard shortcut)
    checkPendingPromptContent();

    // Get current page context
    getCurrentContext();

    // Listen for messages from content script or background
    const handleMessage = (request: any, sender: any, sendResponse: (response: any) => void) => {
      if (request.type === 'INSERT_PROMPT_CONTENT') {
        setInput(request.content);
        return true; // Keep the message channel open for async response if needed
      }
      if (request.type === 'MODE_TOGGLED') {
        switch (request.mode) {
          case 'textSelection':
            setTextSelectionMode(request.value);
            break;
          case 'pageContext':
            setPageContextMode(request.value);
            break;
          case 'pageScreenshot':
            setPageScreenshotMode(request.value);
            break;
          case 'clipboard':
            setClipboardMode(request.value);
            break;
          case 'pageInfo':
            setPageInfoMode(request.value);
            break;
        }
        return true;
      }
      return true;
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Cleanup function to remove the listener
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [dispatch]);

  // Auto-sync functionality moved to a separate effect
  useEffect(() => {
    if (autoSyncEnabled) {
      // Sync every 30 seconds but only when online
      const interval = setInterval(() => {
        if (networkStatusService.isCurrentlyOnline()) {
          syncFromAPI().catch(console.error);
        }
      }, 30000);

      setAutoSyncIntervalId(interval);

      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    } else if (autoSyncIntervalId) {
      clearInterval(autoSyncIntervalId);
      setAutoSyncIntervalId(null);
    }
  }, [autoSyncEnabled, messages]);

  const checkPendingPromptContent = async () => {
    const result = await chrome.storage.local.get('pendingPromptContent');
    if (result.pendingPromptContent) {
      setInput(result.pendingPromptContent);
      await chrome.storage.local.remove('pendingPromptContent');
    }
  };

  // Initialize font scaling and command prefix
  useEffect(() => {
    const initConfig = async () => {
      try {
        const result = await chrome.storage.local.get(['fontScale', 'displaySettings']);
        let currentFontScale = 1.0;
        if (result.fontScale) {
          currentFontScale = Math.max(0.5, Math.min(2.0, result.fontScale)); // Clamp between 0.5 and 2.0
        }

        // Apply font scale to the document root (for the popup)
        document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());

        // Removed command prefix initialization as we're using individual prompt shortcuts instead of global prefix
      } catch (error) {
        console.warn('Could not load configuration, using defaults:', error);
      }
    };

    initConfig();
  }, []);

  // Update models when AI configuration changes
  useEffect(() => {
    fetchAvailableModels(reduxAIConfig);
  }, [reduxAIConfig.provider]); // Only re-fetch when provider changes

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Listen for tab updates to refresh context when switching between tabs
  useEffect(() => {
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Update context when the active tab changes
      if (changeInfo.status === 'complete' && tab.active) {
        getCurrentContext();
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    // Cleanup function to remove the listener
    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
    };
  }, []);

  // Listen for AI configuration updates from the background script
  useEffect(() => {
    const handleConfigUpdate = (request: any, sender: any, sendResponse: (response: any) => void) => {
      if (request.type === 'UPDATE_AI_CONFIG' && request.data) {
        const config = request.data as AIConfig;

        // Ensure providerKeys exists and has all providers
        if (!config.providerKeys) {
          config.providerKeys = {
            'openai': config.apiKey || '',
            'gemini': config.apiKey || '',
            'qwen': config.apiKey || '',
            'prism-api': config.apiKey || config.apiUrl || ''
          };
        } else {
          // Ensure all provider keys exist
          config.providerKeys = {
            'openai': config.providerKeys['openai'] || '',
            'gemini': config.providerKeys['gemini'] || '',
            'qwen': config.providerKeys['qwen'] || '',
            'prism-api': config.providerKeys['prism-api'] || config.apiUrl || ''
          };
        }

        dispatch(setAIConfig(config));

        // Update the client with the new configuration
        const updatedConfig = { ...config };
        if (updatedConfig.providerKeys) {
          updatedConfig.apiKey = updatedConfig.providerKeys[updatedConfig.provider] || '';
          if (updatedConfig.provider === 'prism-api') {
            updatedConfig.apiUrl = updatedConfig.providerKeys['prism-api'] || updatedConfig.apiUrl;
          }
        }

        client = new UnifiedAIClient({
          aiConfig: updatedConfig,
          prismApiUrl: updatedConfig.apiUrl
        });
      }
      return true; // Keep the message channel open for async response if needed
    };

    // Add the message listener
    chrome.runtime.onMessage.addListener(handleConfigUpdate);

    // Cleanup function to remove the listener
    return () => {
      chrome.runtime.onMessage.removeListener(handleConfigUpdate);
    };
  }, [dispatch]);

  const loadChatHistoryFromDB = async () => {
    try {
      const history = await loadChatHistory(currentSessionId);
      dispatch(setMessages(history));
    } catch (error) {
      console.error('Failed to load chat history from database:', error);
      // Fallback to chrome storage if database fails
      const result = await chrome.storage.local.get('history');
      if (result.history) {
        dispatch(setMessages(result.history));
      }
    }
  };

  const loadChatSessionsFromDB = async () => {
    try {
      const sessionsList = await getChatSessions();
      dispatch(setSessions(sessionsList));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  };

  const saveCurrentChatToDB = async (newMessages: Message[]) => {
    try {
      await saveChatHistory(currentSessionId, newMessages);
      // Refresh sessions list after saving
      loadChatSessionsFromDB();
    } catch (error) {
      console.error('Failed to save chat to database:', error);
    }
  };

  const switchToSession = async (sessionId: string) => {
    dispatch(setCurrentSessionId(sessionId));
    try {
      const history = await loadChatHistory(sessionId);
      dispatch(setMessages(history));
    } catch (error) {
      console.error('Failed to load session:', error);
      dispatch(setMessages([]));
    }
  };

  const createNewSession = () => {
    const newSessionId = `session_${Date.now()}`;
    dispatch(setCurrentSessionId(newSessionId));
    dispatch(setMessages([]));
  };

  const deleteSession = async (sessionId: string) => {
    if (window.confirm('Are you sure you want to delete this chat session?')) {
      try {
        await deleteChatSession(sessionId);
        loadChatSessionsFromDB();
        // If we're deleting the current session, create a new one
        if (sessionId === currentSessionId) {
          createNewSession();
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  };

  const loadPromptShortcuts = async () => {
    try {
      const prompts = await getPromptShortcuts();
      setPromptShortcuts(prompts);

      // Also sync to chrome.storage.local for content script access
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          await chrome.storage.local.set({ promptShortcuts: prompts });
        } catch (error) {
          console.warn('Could not sync prompt shortcuts to chrome.storage.local:', error);
        }
      }
    } catch (error) {
      console.error('Failed to load prompt shortcuts:', error);
    }
  };

  const savePromptShortcutToDB = async (prompt: PromptShortcut) => {
    try {
      await savePromptShortcut(prompt);
      loadPromptShortcuts(); // Refresh the list
    } catch (error) {
      console.error('Failed to save prompt shortcut:', error);
    }
  };

  const deletePromptShortcutFromDB = async (promptId: string) => {
    if (window.confirm('Are you sure you want to delete this prompt shortcut?')) {
      try {
        await deletePromptShortcut(promptId);
        loadPromptShortcuts(); // Refresh the list
      } catch (error) {
        console.error('Failed to delete prompt shortcut:', error);
      }
    }
  };

  const addNewPrompt = () => {
    if (newPrompt.name && newPrompt.content) {
      const prompt: PromptShortcut = {
        id: `prompt_${Date.now()}`,
        name: newPrompt.name,
        content: newPrompt.content,
        category: newPrompt.category || 'General',
        shortcutKey: newPrompt.shortcutKey || undefined,
        createdAt: Date.now()
      };
      savePromptShortcutToDB(prompt);
      setNewPrompt({ name: '', content: '', category: '', shortcutKey: '' });
    }
  };

  const updatePromptShortcut = async (id: string, updates: Partial<PromptShortcut>) => {
    try {
      // Get the current prompt
      const currentPrompt = promptShortcuts.find(p => p.id === id);
      if (!currentPrompt) return;

      const updatedPrompt = { ...currentPrompt, ...updates };
      await savePromptShortcutToDB(updatedPrompt);
    } catch (error) {
      console.error('Failed to update prompt shortcut:', error);
    }
  };

  const assignKeyboardShortcut = (promptId: string) => {
    setEditingKeyboardShortcut(promptId);
    setCurrentKeyboardShortcut('');
  };

  const saveKeyboardShortcut = () => {
    if (editingKeyboardShortcut && currentKeyboardShortcut) {
      updatePromptShortcut(editingKeyboardShortcut, { keyboardShortcut: currentKeyboardShortcut });
      setEditingKeyboardShortcut(null);
      setCurrentKeyboardShortcut('');
    }
  };

  // Content sending functions
  const getSelectedText = async (): Promise<string> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' });
        return result.text || '';
      }
      return '';
    } catch (error) {
      console.error('Error getting selected text:', error);
      return '';
    }
  };

  const getPageContents = async (): Promise<string> => {
    try {
      // Load extension settings to get token limits
      const result = await chrome.storage.local.get(['displaySettings']);
      const settings = result.displaySettings;
      const pageContentTokenLimit = settings?.pageContentTokenLimit || 20000;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_PAGE_CONTENTS_WITH_LIMIT',
          tokenLimit: pageContentTokenLimit
        });
        return result.content || '';
      }
      return '';
    } catch (error) {
      console.error('Error getting page contents:', error);
      return '';
    }
  };

  const getScreenshot = async (): Promise<string> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        // Capture the visible part of the current tab
        const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        return screenshot;
      }
      return '';
    } catch (error) {
      console.error('Error getting screenshot:', error);
      return '';
    }
  };

  // Image generation functions
  const initializeImageGeneration = () => {
    // Load image generation config from storage
    chrome.storage.local.get(['imageGenApiKey', 'imageGenModel'], (result) => {
      if (result.imageGenApiKey) {
        setImageGenerationApiKey(result.imageGenApiKey);
      }
      if (result.imageGenModel) {
        setImageGenerationModel(result.imageGenModel);
      }
    });
  };

  const generateImage = async () => {
    if (!imageGenerationPrompt.trim() || !imageGenerationApiKey) {
      alert('Please enter a prompt and API key');
      return;
    }

    setIsGeneratingImage(true);
    setGeneratedImage(null);

    try {
      const service = new ImageGenerationService({
        model: imageGenerationModel,
        apiKey: imageGenerationApiKey
      });

      const result = await service.generateImage(imageGenerationPrompt);
      setGeneratedImage(result.imageUrl);

      // Add the generated image to the chat as a message
      const imageMessage: Message = {
        id: `img_${Date.now()}`,
        role: 'assistant',
        content: `Generated image for: "${imageGenerationPrompt}"`,
        timestamp: Date.now(),
        context
      };

      // Add the image as a new message in the chat
      const newMessages = [...messages, imageMessage];
      setMessages(newMessages);
      await saveCurrentChatToDB(newMessages);

      // Save the image generation config
      await chrome.storage.local.set({
        imageGenApiKey: imageGenerationApiKey,
        imageGenModel: imageGenerationModel
      });
    } catch (error) {
      console.error('Error generating image:', error);
      alert('Error generating image: ' + (error as Error).message);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const saveImageGenerationConfig = async () => {
    await chrome.storage.local.set({
      imageGenApiKey: imageGenerationApiKey,
      imageGenModel: imageGenerationModel
    });
  };

  const usePrompt = (content: string) => {
    setInput(content);
    setShowPrompts(false);
  };

  // Handle keyboard shortcuts for commands and prompts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If we're assigning a shortcut, capture the key combination
      if (editingKeyboardShortcut) {
        e.preventDefault();
        e.stopPropagation();

        let keys: string[] = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.metaKey) keys.push('Cmd'); // For Mac
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');

        // Only add the key if it's not already in the array and it's a valid key
        if (e.key && !['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
          keys.push(e.key);
        }

        setCurrentKeyboardShortcut(keys.join('+'));
        return;
      }

      // Check for keyboard shortcuts for prompt shortcuts first
      const activeShortcut = promptShortcuts.find(prompt =>
        prompt.keyboardShortcut &&
        e.key.toLowerCase() === prompt.keyboardShortcut.split('+').pop()?.toLowerCase() &&
        (e.ctrlKey || e.metaKey) === prompt.keyboardShortcut.includes('Ctrl') &&
        e.shiftKey === prompt.keyboardShortcut.includes('Shift') &&
        e.altKey === prompt.keyboardShortcut.includes('Alt')
      );

      if (activeShortcut) {
        e.preventDefault();
        setInput(activeShortcut.content);
        return;
      }

      // Check for content sending option toggles
      if (e.ctrlKey && e.shiftKey) {
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          setSendSelectedText(prev => !prev);
        } else if (e.key.toLowerCase() === 'p') {
          e.preventDefault();
          setSendPageContents(prev => !prev);
        } else if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          setSendScreenshot(prev => !prev);
        }
      }

      // Check for slash commands (e.g., /fix) - updated to use individual prompt shortcuts
      if (e.key === 'Enter') {
        const trimmedInput = input.trim();

        // Look for a prompt with shortcutKey that matches the entire input
        const prompt = promptShortcuts.find(p => p.shortcutKey === trimmedInput);

        if (prompt) {
          e.preventDefault(); // Prevent sending the message

          // Replace the command with the prompt content
          const newInput = prompt.content;
          setInput(newInput);

          // After updating the input, send the message
          setTimeout(() => {
            sendMessage();
          }, 0);
        }
      }

      // Check for font size adjustment with + and - keys
      if (e.key === '+' || e.key === '=' || e.key === 'Add') {
        e.preventDefault();
        adjustFontSize(0.1);
      } else if (e.key === '-' || e.key === 'Subtract') {
        e.preventDefault();
        adjustFontSize(-0.1);
      }
    };

    // Function to adjust font size
    const adjustFontSize = async (delta: number) => {
      try {
        const result = await chrome.storage.local.get(['fontScale']);
        let currentFontScale = result.fontScale || 1.0;

        // Calculate new scale and clamp between 0.5 and 2.0
        currentFontScale = Math.max(0.5, Math.min(2.0, currentFontScale + delta));

        // Apply font scale to the document root (for the popup)
        document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());

        // Save the new font scale to storage
        await chrome.storage.local.set({ fontScale: currentFontScale });

        // Also update the content script if possible
        try {
          // Send message to content script to update font scale on the page
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'UPDATE_FONT_SCALE',
              scale: currentFontScale
            });
          }
        } catch (contentError) {
          // If content script communication fails, just update the popup
          console.warn('Could not update content script font scale:', contentError);
        }
      } catch (error) {
        console.error('Error adjusting font size:', error);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [input, promptShortcuts, editingKeyboardShortcut]);

  // Image upload handling
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target?.result as string;
        setUploadedImages(prev => [...prev, imageData]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const addImageToInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = handleImageUpload;
    input.click();
  };

  const checkPendingQuery = async () => {
    const result = await chrome.storage.local.get('pendingQuery');
    if (result.pendingQuery) {
      setInput(result.pendingQuery);
      await chrome.storage.local.remove('pendingQuery');
    }
  };

  const getCurrentContext = async (): Promise<ContextData | null> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab.id) {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_CONTEXT'
        });

        if (response && !response.error) {
          setContext(response);
          return response;
        }
      }
      return context; // Return current context if couldn't get fresh one
    } catch (error) {
      console.error('Error getting context:', error);
      return context; // Return current context on error
    }
  };

  const fetchAvailableModels = async (config: AIConfig) => {
    setFetchingModels(true);
    try {
      // Create a temporary client with the current AI config
      const tempClient = new UnifiedAIClient({
        aiConfig: config,
        prismApiUrl: config.apiUrl
      });
      const models = await tempClient.getAvailableModels();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error fetching available models:', error);
      // Set some default models based on the provider
      switch(config.provider) {
        case 'openai':
          setAvailableModels(['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo']);
          break;
        case 'gemini':
          setAvailableModels(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro']);
          break;
        case 'claude':
          setAvailableModels(['claude-3-5-sonnet-20241022', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']);
          break;
        default:
          setAvailableModels([]);
      }
    } finally {
      setFetchingModels(false);
    }
  };

  const updateModel = (model: string) => {
    const updatedConfig = { ...reduxAIConfig, model };
    dispatch(updateAIConfig(updatedConfig));
    client.updateAIConfig(updatedConfig);

    // Save the updated config to chrome storage
    chrome.storage.local.set({ aiConfig: updatedConfig });
  };

  const injectIframe = async () => {
    if (!iframeUrl.trim()) {
      setIframeError('Please enter a URL');
      return;
    }

    try {
      // Validate URL
      let url;
      try {
        url = new URL(iframeUrl);
      } catch {
        // If not a full URL, try adding https://
        url = new URL(`https://${iframeUrl}`);
      }

      // Check if iframe already exists
      const existingIframe = document.getElementById('prism-injected-iframe');
      if (existingIframe) {
        existingIframe.remove();
      }

      // Create iframe container if it doesn't exist
      let iframeContainer = document.getElementById('prism-iframe-container');
      if (!iframeContainer) {
        iframeContainer = document.createElement('div');
        iframeContainer.id = 'prism-iframe-container';
        iframeContainer.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 80vw;
          height: 80vh;
          z-index: 999999;
          background: white;
          border: 2px solid #8b5cf6;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        `;

        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
          position: absolute;
          top: 10px;
          right: 10px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          cursor: pointer;
          z-index: 1000000;
        `;
        closeBtn.onclick = () => removeIframe();
        iframeContainer.appendChild(closeBtn);

        // Add iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'prism-injected-iframe';
        iframe.src = url.toString();
        iframe.style.cssText = `
          width: 100%;
          height: 100%;
          border: none;
          border-radius: 8px;
        `;

        iframeContainer.appendChild(iframe);
        document.body.appendChild(iframeContainer);

        setIsIframeInjected(true);
        setIframeError(null);
      } else {
        // If container exists, just update the iframe src
        const iframe = document.getElementById('prism-injected-iframe') as HTMLIframeElement;
        if (iframe) {
          iframe.src = url.toString();
        }
        setIsIframeInjected(true);
        setIframeError(null);
      }
    } catch (error) {
      console.error('Error injecting iframe:', error);
      setIframeError('Invalid URL. Please check the URL and try again.');
    }
  };

  const removeIframe = () => {
    const iframeContainer = document.getElementById('prism-iframe-container');
    if (iframeContainer) {
      iframeContainer.remove();
    }
    setIsIframeInjected(false);
    setIframeError(null);
  };

  // Simple token estimation function (roughly 1 token = 4 characters or 1 word)
  const estimateTokenCount = (text: string): number => {
    if (!text || text.length === 0) return 0;

    // Simple estimation: split by whitespace
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    // Rough estimation: about 1 token per word, but longer words might be multiple tokens
    let tokenCount = 0;
    for (const word of words) {
      // For longer words, count as multiple tokens (common in tokenizers)
      if (word.length <= 4) {
        tokenCount += 1;
      } else {
        // Estimate: 1 token per 4-5 characters
        tokenCount += Math.ceil(word.length / 4);
      }
    }
    return Math.max(1, tokenCount);
  };

  const sendMessage = async () => {
    if (!input.trim() && uploadedImages.length === 0) return;

    // Get fresh context before sending the message
    const freshContext = await getCurrentContext();

    // Load extension settings to get token limits
    const result = await chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings;
    const totalMessageTokenLimit = settings?.totalMessageTokenLimit || 20000;

    // Construct the content based on selected options
    let fullInput = input;
    let additionalContext = '';

    let selectedText = '';
    let pageContents = '';

    // Check if any mode is active and include the appropriate content
    if (sendSelectedText || textSelectionMode) {
      selectedText = await getSelectedText();
      if (selectedText) {
        additionalContext += `\n--- Selected Text ---\n${selectedText}\n`;
      }
    }

    if (sendPageContents || pageContextMode) {
      pageContents = await getPageContents();
      if (pageContents) {
        additionalContext += `\n--- Page Contents ---\n${pageContents}\n`;
      }
    }

    if (sendScreenshot || pageScreenshotMode) {
      const screenshot = await getScreenshot();
      if (screenshot) {
        // For now, we'll just add a note that a screenshot was taken
        // In a real implementation, you'd send the image data to the AI
        additionalContext += `\n--- Screenshot Attached ---\n`;
      }
    }

    if (clipboardMode) {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          additionalContext += `\n--- Clipboard Content ---\n${clipboardText}\n`;
        }
      } catch (error) {
        console.warn('Could not read clipboard content:', error);
      }
    }

    if (pageInfoMode) {
      additionalContext += `\n--- Page Info ---\nURL: ${window.location.href}\nTitle: ${document.title}\n`;
    }

    // Combine input and context
    if (additionalContext.trim()) {
      fullInput = `${input}\n${additionalContext}`;
    }

    // Calculate total tokens to ensure we're within the limit
    const totalTokens = estimateTokenCount(fullInput);

    if (totalTokens > totalMessageTokenLimit) {
      alert(`Message exceeds token limit. Current: ${totalTokens} tokens, Limit: ${totalMessageTokenLimit} tokens. Please reduce the message size.`);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: fullInput,
      images: uploadedImages.length > 0 ? [...uploadedImages] : undefined,
      timestamp: Date.now(),
      tokens: totalTokens, // Include token count
      context: freshContext
    };

    dispatch(addMessage(userMessage));
    setInput('');
    setUploadedImages([]); // Clear uploaded images after sending
    // Reset all mode states after sending
    setTextSelectionMode(false);
    setPageContextMode(false);
    setPageScreenshotMode(false);
    setClipboardMode(false);
    setPageInfoMode(false);
    // Save to database before attempting to send, ensuring offline persistence
    await saveCurrentChatToDB([...messages, userMessage]);

    try {
      // Update the client with the current AI config (including model)
      client.updateAIConfig(reduxAIConfig);

      // Try to send the message using the client (which handles online/offline)
      const response = await client.sendMessage(fullInput, freshContext, currentSessionId, uploadedImages.length > 0 ? [...uploadedImages] : undefined);

      if (response && response.success && response.data) {
        dispatch(addMessage(response.data));

        // Save to local IndexedDB to ensure persistence
        await saveCurrentChatToDB([...messages, userMessage, response.data]);
      } else {
        // Handle error response
        console.error('Message failed:', response?.error || 'Unknown error');
        // Add an error message to the chat
        const errorMessage: Message = {
          id: `error_${Date.now()}`,
          role: 'assistant',
          content: `Error: ${response?.error || 'Failed to get response from AI'}`,
          timestamp: Date.now(),
          context: freshContext
        };
        dispatch(addMessage(errorMessage));
        await saveCurrentChatToDB([...messages, userMessage, errorMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Add an error message to the chat
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${(error as Error).message || 'Failed to send message to AI'}`,
        timestamp: Date.now(),
        context: freshContext
      };
      dispatch(addMessage(errorMessage));
      await saveCurrentChatToDB([...messages, userMessage, errorMessage]);
    } finally {
      dispatch(setLoading(false));
    }
  };

  const clearHistory = async () => {
    dispatch(setMessages([]));
    await saveCurrentChatToDB([]);
  };

  const syncToAPI = async () => {
    try {
      // Get API configuration
      const result = await chrome.storage.local.get(['aiConfig']);
      const aiConfig = result.aiConfig;

      // Set up API client
      const apiClient = new UnifiedAIClient({
        aiConfig: aiConfig,
        prismApiUrl: aiConfig?.apiUrl || process.env.NEXT_PUBLIC_API_URL
      });

      // Sync messages
      const syncMessagesResult = await apiClient.syncMessages(messages);
      if (!syncMessagesResult.success) {
        console.error('Failed to sync messages:', syncMessagesResult.error);
        alert(`Failed to sync messages: ${syncMessagesResult.error}`);
        return;
      }

      // Sync sessions (get all sessions from Redux state)
      // For now, we'll just sync the current session info and all messages
      const syncSessionsResult = await apiClient.syncSessions([
        {
          id: currentSessionId,
          userId: '', // This will be set by the server
          messages: messages,
          createdAt: Date.now(), // This will also be set by the server
          updatedAt: Date.now()
        }
      ]);
      if (!syncSessionsResult.success) {
        console.error('Failed to sync sessions:', syncSessionsResult.error);
        alert(`Failed to sync sessions: ${syncSessionsResult.error}`);
        return;
      }

      // Sync prompts (get from Redux state or local state)
      // For now, we'll get them from chrome storage
      const promptShortcutsResult = await getPromptShortcuts();
      const syncPromptsResult = await apiClient.syncPrompts(promptShortcutsResult);
      if (!syncPromptsResult.success) {
        console.error('Failed to sync prompts:', syncPromptsResult.error);
        alert(`Failed to sync prompts: ${syncPromptsResult.error}`);
        return;
      }

      alert('Successfully synced to API!');
    } catch (error) {
      console.error('Error syncing to API:', error);
      alert(`Error syncing to API: ${error}`);
    }
  };

  const syncFromAPI = async () => {
    try {
      // Get API configuration
      const result = await chrome.storage.local.get(['aiConfig']);
      const aiConfig = result.aiConfig;

      // Set up API client
      const apiClient = new UnifiedAIClient({
        aiConfig: aiConfig,
        prismApiUrl: aiConfig?.apiUrl || process.env.NEXT_PUBLIC_API_URL
      });

      // Get synced data from API
      const syncedDataResult = await apiClient.getSyncedData();
      if (!syncedDataResult.success) {
        console.error('Failed to get synced data:', syncedDataResult.error);
        alert(`Failed to get synced data: ${syncedDataResult.error}`);
        return;
      }

      // Update messages
      if (syncedDataResult.data?.messages) {
        dispatch(setMessages(syncedDataResult.data.messages));
      }

      // Update sessions
      if (syncedDataResult.data?.sessions) {
        dispatch(setSessions(syncedDataResult.data.sessions));
      }

      // Update prompt shortcuts if available
      if (syncedDataResult.data?.prompts) {
        // Process and save prompts to local storage
        for (const prompt of syncedDataResult.data.prompts) {
          await savePromptShortcut(prompt);
        }
      }

      alert('Successfully synced from API!');
    } catch (error) {
      console.error('Error syncing from API:', error);
      alert(`Error syncing from API: ${error}`);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };


  const renderMenu = () => (
    <div className="menu-overlay">
      <div className="menu-panel">
        <div className="menu-header">
          <h2>Navigation Menu</h2>
          <button onClick={() => setShowMenu(false)} className="close-btn">✕</button>
        </div>

        <div className="menu-content">
          <div className="menu-section">
            <h3>Chat Sessions</h3>
            <div className="session-list">
              <button className="session-item new-session-btn" onClick={() => {
                createNewSession();
                setShowMenu(false);
              }}>
                + New Chat
              </button>
              {sessions.map(session => (
                <div key={session.id} className="session-item">
                  <button
                    onClick={() => {
                      switchToSession(session.id);
                      setShowMenu(false);
                    }}
                    className={session.id === currentSessionId ? 'active' : ''}
                  >
                    {session.title}
                  </button>
                  <button
                    onClick={() => deleteSession(session.id)}
                    className="delete-session-btn"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="menu-section">
            <h3>Quick Actions</h3>
            <button className="menu-action-btn" onClick={clearHistory}>
              Clear Current Chat
            </button>
            <button className="menu-action-btn" onClick={() => {
              setShowPrompts(true);
              setShowMenu(false);
            }}>
              Prompt Shortcuts
            </button>
            <button className="menu-action-btn" onClick={() => {
              setShowSettings(true);
              setShowMenu(false);
            }}>
              Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPromptShortcuts = () => (
    <div className="menu-overlay">
      <div className="menu-panel">
        <div className="menu-header">
          <h2>Prompt Shortcuts</h2>
          <button onClick={() => setShowPrompts(false)} className="close-btn">✕</button>
        </div>

        <div className="menu-content">
          <div className="menu-section">
            <h3>Add New Prompt</h3>
            <div className="prompt-form">
              <input
                type="text"
                placeholder="Prompt name"
                value={newPrompt.name}
                onChange={(e) => setNewPrompt({...newPrompt, name: e.target.value})}
                className="prompt-input"
              />
              <input
                type="text"
                placeholder="Slash command (e.g. /fix)"
                value={newPrompt.shortcutKey}
                onChange={(e) => setNewPrompt({...newPrompt, shortcutKey: e.target.value})}
                className="prompt-input"
              />
              <textarea
                placeholder="Prompt content"
                value={newPrompt.content}
                onChange={(e) => setNewPrompt({...newPrompt, content: e.target.value})}
                className="prompt-textarea"
                rows={3}
              />
              <input
                type="text"
                placeholder="Category (optional)"
                value={newPrompt.category}
                onChange={(e) => setNewPrompt({...newPrompt, category: e.target.value})}
                className="prompt-input"
              />
              <button onClick={addNewPrompt} className="prompt-add-btn">
                Add Prompt
              </button>
            </div>
          </div>

          <div className="menu-section">
            <h3>Saved Prompts</h3>
            <div className="prompt-list">
              {promptShortcuts.map(prompt => (
                <div key={prompt.id} className="prompt-item">
                  <div className="prompt-content">
                    <div className="prompt-name">{prompt.name}</div>
                    <div className="prompt-info">
                      {prompt.shortcutKey && <span className="shortcut-tag">{prompt.shortcutKey}</span>}
                      {prompt.keyboardShortcut && <span className="shortcut-tag">{prompt.keyboardShortcut}</span>}
                    </div>
                    <div className="prompt-text">{prompt.content.substring(0, 50)}{prompt.content.length > 50 ? '...' : ''}</div>
                  </div>
                  <div className="prompt-actions">
                    <button
                      onClick={() => usePrompt(prompt.content)}
                      className="prompt-use-btn"
                      title="Use this prompt"
                    >
                      ✅
                    </button>
                    <button
                      onClick={() => assignKeyboardShortcut(prompt.id)}
                      className="prompt-keyboard-btn"
                      title="Assign keyboard shortcut"
                    >
                      ⌨️
                    </button>
                    <button
                      onClick={() => deletePromptShortcutFromDB(prompt.id)}
                      className="prompt-delete-btn"
                      title="Delete this prompt"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              {promptShortcuts.length === 0 && (
                <div className="no-prompts">No prompt shortcuts saved yet</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcut Assignment Modal */}
      {editingKeyboardShortcut && (
        <div className="menu-overlay" onClick={() => setEditingKeyboardShortcut(null)}>
          <div className="menu-panel" onClick={(e) => e.stopPropagation()}>
            <div className="menu-header">
              <h2>Assign Keyboard Shortcut</h2>
              <button onClick={() => setEditingKeyboardShortcut(null)} className="close-btn">✕</button>
            </div>

            <div className="menu-content">
              <div className="menu-section">
                <p>Press the key combination you want to assign:</p>
                <div className="keyboard-shortcut-display">
                  {currentKeyboardShortcut || 'Press keys...'}
                </div>
                <div className="keyboard-shortcut-help">
                  <p>Example: Ctrl+Shift+F, Alt+R, Cmd+Shift+G</p>
                </div>
                <div className="menu-actions">
                  <button
                    onClick={() => {
                      setCurrentKeyboardShortcut('');
                    }}
                    className="menu-action-btn"
                  >
                    Clear
                  </button>
                  <button
                    onClick={saveKeyboardShortcut}
                    className="menu-action-btn"
                    disabled={!currentKeyboardShortcut}
                  >
                    Save Shortcut
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );



  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1>💎 Prism</h1>
        <div className="header-actions">
          <button onClick={() => setShowMenu(true)} className="menu-btn">☰</button>
          {/* Close button for popup when in browser action mode */}
          <button
            onClick={() => {
              if (typeof window !== 'undefined' && window.close) {
                window.close();
              }
            }}
            className="close-btn"
            title="Close popup"
            style={{ display: typeof window !== 'undefined' && window.location?.pathname?.includes('index.html') ? 'block' : 'none' }}
          >
            ✕
          </button>
          {reduxContext && (
            <span className="context-indicator" title={reduxContext.title}>
              📄 {reduxContext.type}
            </span>
          )}
          <select
            value={reduxAIConfig.provider}
            onChange={(e) => {
              const newProvider = e.target.value as AIConfig['provider'];
              const updatedConfig = { ...reduxAIConfig, provider: newProvider };
              dispatch(updateAIConfig(updatedConfig));
              client.updateAIConfig(updatedConfig);
            }}
            className="provider-selector"
            title="Select AI provider"
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="qwen">Qwen</option>
            <option value="prism-api">Prism API</option>
            <option value="koboldcpp">KoboldCPP</option>
            <option value="llamacpp">Llama.cpp</option>
            <option value="ollama">Ollama</option>
            <option value="sglang">SGLang</option>
            <option value="transformers">Transformers</option>
            <option value="deepseek">DeepSeek</option>
            <option value="grok">Grok</option>
            <option value="openrouter">OpenRouter</option>
            <option value="poe">Poe</option>
          </select>

          <select
            value={reduxAIConfig.model || ''}
            onChange={(e) => updateModel(e.target.value)}
            className="model-selector"
            title="Select AI model"
            disabled={fetchingModels || availableModels.length === 0}
          >
            {fetchingModels ? (
              <option value="">Loading models...</option>
            ) : availableModels.length > 0 ? (
              availableModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            ) : (
              <option value="">No models available</option>
            )}
          </select>

          <button
            onClick={() => fetchAvailableModels(aiConfig)}
            className="refresh-models-btn"
            title="Refresh available models"
            disabled={fetchingModels}
          >
            {fetchingModels ? '🔄' : '♻️'}
          </button>
          <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
               title={isOnline ? 'Online' : 'Offline'}></div>
          <button
            onClick={syncFromAPI}
            className="sync-from-btn"
            title="Sync from Prism API"
            disabled={!isOnline}
          >
            📥
          </button>
          <button
            onClick={syncToAPI}
            className="sync-to-btn"
            title="Sync to Prism API"
            disabled={!isOnline}
          >
            📤
          </button>
          <button
            onClick={toggleAutoSync}
            className="autosync-btn"
            title={autoSyncEnabled ? "Stop Auto-Sync" : "Start Auto-Sync"}
            disabled={!isOnline}
          >
            {autoSyncEnabled ? '⏸️' : '▶️'}
          </button>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            className="settings-btn"
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={clearHistory}
            className="clear-btn"
            title="Clear Chat"
          >
            🗑️
          </button>
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-xs truncate max-w-[100px]">{user?.displayName || user?.email}</span>
              <button
                onClick={signOut}
                className="auth-signout-btn"
                title="Sign Out"
              >
                👤
              </button>
            </div>
          ) : (
            <button
              onClick={signInWithGoogle}
              className="auth-signin-btn"
              title="Sign In with Google"
              disabled={!isOnline}
            >
              🔐
            </button>
          )}
          <span className="provider-indicator" title={`Current provider: ${reduxAIConfig.provider}`}>
            {reduxAIConfig.provider === 'openai' && '🤖'}
            {reduxAIConfig.provider === 'gemini' && '⭐'}
            {reduxAIConfig.provider === 'claude' && '🤝'}
            {reduxAIConfig.provider === 'qwen' && '☁️'}
            {reduxAIConfig.provider === 'prism-api' && '💎'}
            {reduxAIConfig.provider === 'koboldcpp' && '👻'}
            {reduxAIConfig.provider === 'llamacpp' && '🦙'}
            {reduxAIConfig.provider === 'ollama' && '🦙'}
            {reduxAIConfig.provider === 'sglang' && '⚡'}
            {reduxAIConfig.provider === 'transformers' && '🔄'}
            {reduxAIConfig.provider === 'deepseek' && '🔍'}
            {reduxAIConfig.provider === 'grok' && '🤖'}
            {reduxAIConfig.provider === 'openrouter' && '🌐'}
            {reduxAIConfig.provider === 'poe' && '💬'}
            <span className="provider-name">{reduxAIConfig.provider}</span>
          </span>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>👋 Ask me anything about this page!</p>
            {reduxContext?.selectedText && (
              <div className="selected-text">
                Selected: "{reduxContext.selectedText.slice(0, 100)}..."
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="message-content">
                {msg.images && msg.images.length > 0 && (
                  <div className="message-images">
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`Attached image ${idx + 1}`}
                        className="attached-image"
                      />
                    ))}
                  </div>
                )}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({node, inline, className, children, ...props}) {
                      const match = /language-(\w+)/.exec(className || '');
                      return !inline && match ? (
                        <SyntaxHighlighter
                          style={atomDark}
                          language={match[1]}
                          PreTag="div"
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
              {msg.context && (
                <div className="message-context">
                  🔗 {msg.context.title || msg.context.url}
                </div>
              )}
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      {generatedImage ? (
        <div className="image-generation-result">
          <h3>Generated Image</h3>
          <img src={generatedImage} alt="Generated" style={{ maxWidth: '100%', borderRadius: '8px' }} />
          <div className="image-actions">
            <button
              onClick={() => setGeneratedImage(null)}
              className="action-btn"
            >
              Generate New
            </button>
            <button
              onClick={() => {
                // Create a download link for the image
                const link = document.createElement('a');
                link.href = generatedImage;
                link.download = `generated-image-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="action-btn"
            >
              Download
            </button>
          </div>
        </div>
      ) : (
        <div className="image-generation-section">
          <div className="image-generation-controls">
            <input
              type="text"
              value={imageGenerationPrompt}
              onChange={(e) => setImageGenerationPrompt(e.target.value)}
              placeholder="Enter image generation prompt..."
              className="image-prompt-input"
              disabled={isGeneratingImage}
            />
            <button
              onClick={generateImage}
              disabled={isGeneratingImage || !imageGenerationPrompt.trim() || !imageGenerationApiKey}
              className="image-generate-btn"
            >
              {isGeneratingImage ? 'Generating...' : 'Generate Image'}
            </button>
          </div>
        </div>
      )}

      {/* Iframe Injection Section */}
      <div className="iframe-injection-section">
        <div className="iframe-controls">
          <input
            type="text"
            value={iframeUrl}
            onChange={(e) => setIframeUrl(e.target.value)}
            placeholder="Enter URL to inject into iframe..."
            className="iframe-url-input"
          />
          <button
            onClick={injectIframe}
            disabled={!iframeUrl.trim() || isIframeInjected}
            className="inject-iframe-btn"
          >
            {isIframeInjected ? 'Injected ✓' : 'Inject Iframe'}
          </button>
          {isIframeInjected && (
            <button
              onClick={removeIframe}
              className="remove-iframe-btn"
            >
              Remove Iframe
            </button>
          )}
        </div>
        {iframeError && (
          <div className="iframe-error">
            Error: {iframeError}
          </div>
        )}
      </div>

      <div className="input-container">
        <div className="input-actions">
          <button
            className={`action-btn ${sendSelectedText || textSelectionMode ? 'active' : ''}`}
            onClick={() => {
              setSendSelectedText(!sendSelectedText);
              setTextSelectionMode(!textSelectionMode);
            }}
            title="Include selected text in your message (Ctrl+Shift+T or Shift+1)"
          >
            📝
          </button>
          <button
            className={`action-btn ${sendPageContents || pageContextMode ? 'active' : ''}`}
            onClick={() => {
              setSendPageContents(!sendPageContents);
              setPageContextMode(!pageContextMode);
            }}
            title="Include page contents in your message (Ctrl+Shift+P or Shift+2)"
          >
            📄
          </button>
          <button
            className={`action-btn ${sendScreenshot || pageScreenshotMode ? 'active' : ''}`}
            onClick={() => {
              setSendScreenshot(!sendScreenshot);
              setPageScreenshotMode(!pageScreenshotMode);
            }}
            title="Include screenshot in your message (Ctrl+Shift+S or Shift+3)"
          >
            📷
          </button>
          <button
            className="action-btn"
            onClick={() => {
              // Toggle clipboard mode
              setClipboardMode(!clipboardMode);
              // Add clipboard content to input
              if (!clipboardMode) {
                navigator.clipboard.readText().then(text => {
                  setInput(prev => prev + (prev ? ' ' : '') + text);
                });
              }
            }}
            title="Include clipboard content in your message (Shift+4)"
          >
            📋
          </button>
          <button
            className="action-btn"
            onClick={() => {
              // Toggle page info mode
              setPageInfoMode(!pageInfoMode);
              // Add page info to input
              if (!pageInfoMode) {
                const pageInfo = `URL: ${window.location.href}\nTitle: ${document.title}`;
                setInput(prev => prev + (prev ? '\n' : '') + pageInfo);
              }
            }}
            title="Include page info in your message (Shift+5)"
          >
            ℹ️
          </button>
          <button
            className="action-btn"
            onClick={addImageToInput}
            title="Upload an image"
          >
            🖼️
          </button>
          <button
            className="action-btn"
            onClick={() => {
              // Switch to image generation mode
              if (!generatedImage) {
                setImageGenerationPrompt(input);
              }
            }}
            title="Generate an image based on your input"
          >
            🎨
          </button>
        </div>

        {/* Display uploaded images */}
        {uploadedImages.length > 0 && (
          <div className="uploaded-images">
            {uploadedImages.map((img, index) => (
              <div key={index} className="image-preview">
                <img src={img} alt={`Preview ${index}`} />
                <button
                  className="remove-image-btn"
                  onClick={() => removeImage(index)}
                  title="Remove image"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask about this page..."
          disabled={loading}
          rows={2}
        />
        <div className="input-footer">
          <div className="send-options">
            {(sendSelectedText || textSelectionMode) && <span className="send-option active" title="Ctrl+Shift+T or Shift+1 to toggle">📝</span>}
            {(sendPageContents || pageContextMode) && <span className="send-option active" title="Ctrl+Shift+P or Shift+2 to toggle">📄</span>}
            {(sendScreenshot || pageScreenshotMode) && <span className="send-option active" title="Ctrl+Shift+S or Shift+3 to toggle">📷</span>}
            {clipboardMode && <span className="send-option active" title="Shift+4 to toggle">📋</span>}
            {pageInfoMode && <span className="send-option active" title="Shift+5 to toggle">ℹ️</span>}
            {uploadedImages.length > 0 && <span className="send-option active" title="Uploaded images">🖼️ {uploadedImages.length}</span>}
          </div>
          <button
            onClick={sendMessage}
            disabled={loading || (!input.trim() && uploadedImages.length === 0)}
            className="send-btn"
          >
            {loading ? '⏳' : '🚀'}
          </button>
        </div>
      </div>

      {showMenu && renderMenu()}
      {showPrompts && renderPromptShortcuts()}
    </div>
  );
}