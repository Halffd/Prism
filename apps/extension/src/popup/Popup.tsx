import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { UnifiedAIClient } from '@prism/api-client';
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
import { ImageGenerationService } from '@prism/image-gen';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';
import './Popup.scss';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: 'http://localhost:3000/api'
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

export function Popup() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<ContextData | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig>(defaultAIConfig);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    // Generate a default session ID based on timestamp
    return `session_${Date.now()}`;
  });
  const [showMenu, setShowMenu] = useState(false);
  const [promptShortcuts, setPromptShortcuts] = useState<PromptShortcut[]>([]);
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
          const config = result.aiConfig as AIConfig;
          setAiConfig(config);
          client = new UnifiedAIClient({
            aiConfig: config,
            prismApiUrl: config.apiUrl
          });
        } catch (error) {
          console.error('Failed to load AI config, using default:', error);
          client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
        }
      } else {
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    });

    // Load history from database
    loadChatHistoryFromDB();

    // Load chat sessions
    loadChatSessionsFromDB();

    // Load prompt shortcuts
    loadPromptShortcuts();

    // Initialize image generation
    initializeImageGeneration();

    // Check for pending query (from context menu)
    checkPendingQuery();

    // Get current page context
    getCurrentContext();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadChatHistoryFromDB = async () => {
    try {
      const history = await loadChatHistory(currentSessionId);
      setMessages(history);
    } catch (error) {
      console.error('Failed to load chat history from database:', error);
      // Fallback to chrome storage if database fails
      const result = await chrome.storage.local.get('history');
      if (result.history) {
        setMessages(result.history);
      }
    }
  };

  const loadChatSessionsFromDB = async () => {
    try {
      const sessionsList = await getChatSessions();
      setSessions(sessionsList);
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
    setCurrentSessionId(sessionId);
    try {
      const history = await loadChatHistory(sessionId);
      setMessages(history);
    } catch (error) {
      console.error('Failed to load session:', error);
      setMessages([]);
    }
  };

  const createNewSession = () => {
    const newSessionId = `session_${Date.now()}`;
    setCurrentSessionId(newSessionId);
    setMessages([]);
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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENTS' });
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

      // Check for slash commands (e.g., /fix)
      if (e.key === 'Enter' && input.startsWith('/')) {
        const command = input.split(' ')[0];
        const prompt = promptShortcuts.find(p => p.shortcutKey === command);
        if (prompt) {
          e.preventDefault();
          // Replace the command with the prompt content
          setInput(prompt.content);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [input, promptShortcuts, editingKeyboardShortcut]);

  const checkPendingQuery = async () => {
    const result = await chrome.storage.local.get('pendingQuery');
    if (result.pendingQuery) {
      setInput(result.pendingQuery);
      await chrome.storage.local.remove('pendingQuery');
    }
  };

  const getCurrentContext = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab.id) {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_CONTEXT'
        });
        
        if (response && !response.error) {
          setContext(response);
        }
      }
    } catch (error) {
      console.error('Error getting context:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Construct the content based on selected options
    let fullInput = input;
    let additionalContext = '';

    if (sendSelectedText) {
      const selectedText = await getSelectedText();
      if (selectedText) {
        additionalContext += `\n--- Selected Text ---\n${selectedText}\n`;
      }
    }

    if (sendPageContents) {
      const pageContents = await getPageContents();
      if (pageContents) {
        additionalContext += `\n--- Page Contents ---\n${pageContents.substring(0, 2000)}\n`; // Limit length
      }
    }

    if (sendScreenshot) {
      const screenshot = await getScreenshot();
      if (screenshot) {
        // For now, we'll just add a note that a screenshot was taken
        // In a real implementation, you'd send the image data to the AI
        additionalContext += `\n--- Screenshot Attached ---\n`;
      }
    }

    // Combine input and context
    if (additionalContext.trim()) {
      fullInput = `${input}\n${additionalContext}`;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: fullInput,
      timestamp: Date.now(),
      context
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_MESSAGE',
        data: {
          content: fullInput,
          context
        }
      });

      if (response.success && response.data) {
        const updatedMessages = [...newMessages, response.data];
        setMessages(updatedMessages);

        // Save to database
        await saveCurrentChatToDB(updatedMessages);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    setMessages([]);
    await saveCurrentChatToDB([]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const [showSettings, setShowSettings] = useState(false);

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

  const updateAIConfig = async (config: AIConfig) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: config
      });
      setAiConfig(config);
      client = new UnifiedAIClient({
        aiConfig: config,
        prismApiUrl: config.apiUrl
      });
      setShowSettings(false); // Close settings after saving
    } catch (error) {
      console.error('Failed to update AI config:', error);
    }
  };

  const renderSettings = () => (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>AI Settings</h2>
          <button onClick={() => setShowSettings(false)} className="close-btn">✕</button>
        </div>

        <div className="settings-content">
          <div className="form-group">
            <label>AI Provider</label>
            <select
              value={aiConfig.provider}
              onChange={(e) => setAiConfig({...aiConfig, provider: e.target.value as AIProvider})}
              className="form-control"
            >
              <option value="prism-api">Prism API</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="gemini">Google Gemini</option>
              <option value="qwen">Alibaba Qwen</option>
            </select>
          </div>

          {aiConfig.provider !== 'prism-api' && (
            <>
              <div className="form-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={aiConfig.apiKey || ''}
                  onChange={(e) => setAiConfig({...aiConfig, apiKey: e.target.value})}
                  placeholder={`Enter ${aiConfig.provider} API key`}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label>Model</label>
                <input
                  type="text"
                  value={aiConfig.model || ''}
                  onChange={(e) => setAiConfig({...aiConfig, model: e.target.value})}
                  placeholder="e.g., gpt-3.5-turbo, gemini-pro, qwen-max"
                  className="form-control"
                />
              </div>
            </>
          )}

          {aiConfig.provider === 'prism-api' && (
            <div className="form-group">
              <label>Prism API URL</label>
              <input
                type="text"
                value={aiConfig.apiUrl || ''}
                onChange={(e) => setAiConfig({...aiConfig, apiUrl: e.target.value})}
                placeholder="Enter Prism API URL"
                className="form-control"
              />
            </div>
          )}

          {/* Image Generation Settings */}
          <div className="form-group">
            <label>Hugging Face API Key</label>
            <input
              type="password"
              value={imageGenerationApiKey}
              onChange={(e) => setImageGenerationApiKey(e.target.value)}
              placeholder="Enter your Hugging Face API key"
              className="form-control"
            />
          </div>

          <div className="form-group">
            <label>Image Generation Model</label>
            <select
              value={imageGenerationModel}
              onChange={(e) => setImageGenerationModel(e.target.value)}
              className="form-control"
            >
              <option value="stabilityai/stable-diffusion-2-1">Stable Diffusion 2.1</option>
              <option value="runwayml/stable-diffusion-v1-5">Stable Diffusion 1.5</option>
              <option value="stabilityai/stable-diffusion-xl-base-1.0">SDXL</option>
              <option value="black-forest-labs/FLUX.1-schnell">FLUX Schnell</option>
              <option value="black-forest-labs/FLUX.1-dev">FLUX Dev</option>
            </select>
          </div>
        </div>

        <div className="settings-actions">
          <button
            onClick={() => {
              updateAIConfig(aiConfig);
              saveImageGenerationConfig();
            }}
            className="save-btn"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1>💎 Prism</h1>
        <div className="header-actions">
          <button onClick={() => setShowMenu(true)} className="menu-btn">☰</button>
          {context && (
            <span className="context-indicator" title={context.title}>
              📄 Context: {context.type}
            </span>
          )}
          <button onClick={() => setShowSettings(true)} className="settings-btn">⚙️</button>
          <button onClick={clearHistory} className="clear-btn">
            🗑️
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>👋 Ask me anything about this page!</p>
            {context?.selectedText && (
              <div className="selected-text">
                Selected: "{context.selectedText.slice(0, 100)}..."
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

      <div className="input-container">
        <div className="input-actions">
          <button
            className={`action-btn ${sendSelectedText ? 'active' : ''}`}
            onClick={() => setSendSelectedText(!sendSelectedText)}
            title="Include selected text in your message"
          >
            📝 Selected Text
          </button>
          <button
            className={`action-btn ${sendPageContents ? 'active' : ''}`}
            onClick={() => setSendPageContents(!sendPageContents)}
            title="Include page contents in your message"
          >
            📄 Page Content
          </button>
          <button
            className={`action-btn ${sendScreenshot ? 'active' : ''}`}
            onClick={() => setSendScreenshot(!sendScreenshot)}
            title="Include screenshot in your message"
          >
            📷 Screenshot
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
            🎨 Image
          </button>
        </div>
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
            {sendSelectedText && <span className="send-option active" title="Ctrl+Shift+T to toggle">📝 Text</span>}
            {sendPageContents && <span className="send-option active" title="Ctrl+Shift+P to toggle">📄 Page</span>}
            {sendScreenshot && <span className="send-option active" title="Ctrl+Shift+S to toggle">📷 Screenshot</span>}
          </div>
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="send-btn"
          >
            {loading ? '⏳' : '🚀 Send'}
          </button>
        </div>
      </div>

      {showSettings && renderSettings()}
      {showMenu && renderMenu()}
      {showPrompts && renderPromptShortcuts()}
    </div>
  );
}