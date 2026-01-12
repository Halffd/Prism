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
import '../popup/Popup.scss'; // Reuse popup styles

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

export function StandaloneChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<ContextData | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig>(defaultAIConfig);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);
  const [iframeUrl, setIframeUrl] = useState<string>('');
  const [isIframeInjected, setIsIframeInjected] = useState<boolean>(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
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
    // Load AI configuration from localStorage (since we're not in extension context)
    const storedConfig = localStorage.getItem('aiConfig');
    if (storedConfig) {
      try {
        let config = JSON.parse(storedConfig) as AIConfig;

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

        setAiConfig(config);
        // Update the current provider's API key in the config before creating the client
        const updatedConfig = { ...config };
        if (updatedConfig.providerKeys) {
          updatedConfig.apiKey = updatedConfig.providerKeys[updatedConfig.provider] || '';
          if (updatedConfig.provider === 'prism-api') {
            updatedConfig.apiUrl = updatedConfig.providerKeys['prism-api'] || updatedConfig.apiUrl;
          }
        }

        setAiConfig(updatedConfig);
        client = new UnifiedAIClient({
          aiConfig: updatedConfig,
          prismApiUrl: updatedConfig.apiUrl
        });

        // Fetch available models for the current provider
        fetchAvailableModels(updatedConfig);
      } catch (error) {
        console.error('Failed to load AI config, using default:', error);
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    } else {
      client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
    }

    // Load history from localStorage
    loadChatHistoryFromDB();

    // Load chat sessions
    loadChatSessionsFromDB();

    // Load prompt shortcuts
    loadPromptShortcuts();

    // Initialize image generation
    initializeImageGeneration();

    // Initialize font scaling (for standalone page)
    const initFontScale = async () => {
      try {
        const fontScale = localStorage.getItem('fontScale');
        let currentFontScale = 1.0;
        if (fontScale) {
          currentFontScale = Math.max(0.5, Math.min(2.0, parseFloat(fontScale))); // Clamp between 0.5 and 2.0
        }
        
        // Apply font scale to the document root (for the popup)
        document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());
      } catch (error) {
        console.warn('Could not load font scale, using default:', error);
      }
    };

    initFontScale();
  }, []);

  // Update models when AI configuration changes
  useEffect(() => {
    fetchAvailableModels(aiConfig);
  }, [aiConfig.provider]); // Only re-fetch when provider changes

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle keyboard shortcuts for font size adjustment
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for font size adjustment with + and - keys
      if (e.key === '+' || e.key === '=' || e.key === 'Add') {
        e.preventDefault();
        adjustFontSize(0.1);
      } else if (e.key === '-' || e.key === 'Subtract') {
        e.preventDefault();
        adjustFontSize(-0.1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const adjustFontSize = (delta: number) => {
    try {
      const currentFontScaleStr = localStorage.getItem('fontScale');
      let currentFontScale = currentFontScaleStr ? parseFloat(currentFontScaleStr) : 1.0;
      
      // Calculate new scale and clamp between 0.5 and 2.0
      currentFontScale = Math.max(0.5, Math.min(2.0, currentFontScale + delta));
      
      // Apply font scale to the document root
      document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());
      
      // Save the new font scale to localStorage
      localStorage.setItem('fontScale', currentFontScale.toString());
    } catch (error) {
      console.error('Error adjusting font size:', error);
    }
  };

  const loadChatHistoryFromDB = async () => {
    try {
      // For standalone page, use localStorage instead of extension storage
      const savedHistory = localStorage.getItem(`chatHistory_${currentSessionId}`);
      if (savedHistory) {
        setMessages(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      // Fallback to localStorage if database fails
      const savedHistory = localStorage.getItem('history');
      if (savedHistory) {
        setMessages(JSON.parse(savedHistory));
      }
    }
  };

  const loadChatSessionsFromDB = async () => {
    try {
      // For standalone page, use localStorage instead of extension storage
      const savedSessions = localStorage.getItem('chatSessions');
      if (savedSessions) {
        setSessions(JSON.parse(savedSessions));
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  };

  const saveCurrentChatToDB = async (newMessages: Message[]) => {
    try {
      // For standalone page, use localStorage instead of extension storage
      localStorage.setItem(`chatHistory_${currentSessionId}`, JSON.stringify(newMessages));
      
      // Update sessions list
      const updatedSessions = [...sessions];
      const sessionIndex = updatedSessions.findIndex(s => s.id === currentSessionId);
      if (sessionIndex !== -1) {
        updatedSessions[sessionIndex] = {
          ...updatedSessions[sessionIndex],
          messages: newMessages,
          updatedAt: Date.now()
        };
      } else {
        updatedSessions.push({
          id: currentSessionId,
          userId: 'standalone-user',
          messages: newMessages,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      
      setSessions(updatedSessions);
      localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
    } catch (error) {
      console.error('Failed to save chat to database:', error);
    }
  };

  const switchToSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    try {
      // For standalone page, use localStorage instead of extension storage
      const savedHistory = localStorage.getItem(`chatHistory_${sessionId}`);
      if (savedHistory) {
        setMessages(JSON.parse(savedHistory));
      } else {
        setMessages([]);
      }
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
        // For standalone page, use localStorage instead of extension storage
        localStorage.removeItem(`chatHistory_${sessionId}`);
        
        const updatedSessions = sessions.filter(session => session.id !== sessionId);
        setSessions(updatedSessions);
        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        
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
      // For standalone page, use localStorage instead of extension storage
      const savedPrompts = localStorage.getItem('promptShortcuts');
      if (savedPrompts) {
        setPromptShortcuts(JSON.parse(savedPrompts));
      }
    } catch (error) {
      console.error('Failed to load prompt shortcuts:', error);
    }
  };

  const savePromptShortcutToDB = async (prompt: PromptShortcut) => {
    try {
      // For standalone page, use localStorage instead of extension storage
      const savedPrompts = localStorage.getItem('promptShortcuts');
      const prompts = savedPrompts ? JSON.parse(savedPrompts) : [];
      const updatedPrompts = [...prompts.filter((p: PromptShortcut) => p.id !== prompt.id), prompt];
      localStorage.setItem('promptShortcuts', JSON.stringify(updatedPrompts));
      setPromptShortcuts(updatedPrompts);
    } catch (error) {
      console.error('Failed to save prompt shortcut:', error);
    }
  };

  const deletePromptShortcutFromDB = async (promptId: string) => {
    if (window.confirm('Are you sure you want to delete this prompt shortcut?')) {
      try {
        // For standalone page, use localStorage instead of extension storage
        const savedPrompts = localStorage.getItem('promptShortcuts');
        if (savedPrompts) {
          const prompts = JSON.parse(savedPrompts);
          const updatedPrompts = prompts.filter((p: PromptShortcut) => p.id !== promptId);
          localStorage.setItem('promptShortcuts', JSON.stringify(updatedPrompts));
          setPromptShortcuts(updatedPrompts);
        }
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
      savePromptShortcutToDB(updatedPrompt);
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const clearHistory = async () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setMessages([]);
      await saveCurrentChatToDB([]);
    }
  };

  // Image generation functions
  const initializeImageGeneration = () => {
    // Load image generation config from localStorage
    const savedApiKey = localStorage.getItem('imageGenApiKey');
    const savedModel = localStorage.getItem('imageGenModel');
    
    if (savedApiKey) {
      setImageGenerationApiKey(savedApiKey);
    }
    if (savedModel) {
      setImageGenerationModel(savedModel);
    }
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
      localStorage.setItem('imageGenApiKey', imageGenerationApiKey);
      localStorage.setItem('imageGenModel', imageGenerationModel);
    } catch (error) {
      console.error('Error generating image:', error);
      alert('Error generating image: ' + (error as Error).message);
    } finally {
      setIsGeneratingImage(false);
    }
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
    if ((!input.trim() && uploadedImages.length === 0)) return;

    // Load extension settings to get token limits
    // For standalone page, use default limits
    const totalMessageTokenLimit = 20000; // Default limit

    // Calculate total tokens to ensure we're within the limit
    const totalTokens = estimateTokenCount(input);

    if (totalTokens > totalMessageTokenLimit) {
      alert(`Message exceeds token limit. Current: ${totalTokens} tokens, Limit: ${totalMessageTokenLimit} tokens. Please reduce the message size.`);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
      tokens: totalTokens, // Include token count
      images: uploadedImages.length > 0 ? [...uploadedImages] : undefined,
      context
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setUploadedImages([]);
    setLoading(true);

    try {
      // Update the client with current AI config
      client.updateAIConfig(aiConfig);

      // Try to send the message using the client (which handles online/offline)
      const response = await client.sendMessage(input, context, currentSessionId, uploadedImages.length > 0 ? uploadedImages : undefined);

      if (response.success && response.data) {
        const updatedMessages = [...newMessages, response.data];
        setMessages(updatedMessages);

        // Save to local IndexedDB to ensure persistence
        await saveCurrentChatToDB(updatedMessages);
      } else {
        // If API call fails, add an error message to the chat
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: response.error || 'Failed to get response. Please try again later.',
          timestamp: Date.now(),
        };
        setMessages([...newMessages, errorMessage]);
        await saveCurrentChatToDB([...newMessages, errorMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Add an error message to the chat in case of network errors
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: (error as Error).message || 'Network error. Please check your connection.',
        timestamp: Date.now(),
      };
      setMessages([...newMessages, errorMessage]);
      await saveCurrentChatToDB([...newMessages, errorMessage]);
    } finally {
      setLoading(false);
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
    const updatedConfig = { ...aiConfig, model };
    setAiConfig(updatedConfig);
    client.updateAIConfig(updatedConfig);

    // Save the updated config to localStorage
    localStorage.setItem('aiConfig', JSON.stringify(updatedConfig));
  };

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

  // Render menu for switching sessions
  const renderMenu = () => (
    <div className="menu-overlay">
      <div className="menu-panel">
        <div className="menu-header">
          <h2>Chat Sessions</h2>
          <button onClick={() => setShowMenu(false)} className="close-btn">✕</button>
        </div>

        <div className="menu-content">
          <div className="menu-section">
            <div className="session-actions">
              <button className="session-item new-session-btn" onClick={() => {
                createNewSession();
                setShowMenu(false);
              }}>
                + New Chat
              </button>
            </div>

            <div className="session-list">
              {sessions.map(session => (
                <div key={session.id} className="session-item">
                  <button
                    onClick={() => {
                      switchToSession(session.id);
                      setShowMenu(false);
                    }}
                    className={session.id === currentSessionId ? 'active' : ''}
                  >
                    <div className="session-title">{session.title || 'Untitled Chat'}</div>
                    <div className="session-date">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSession(session.id)}
                    className="delete-session-btn"
                  >
                    🗑️
                  </button>
                </div>
              ))}

              {sessions.length === 0 && (
                <div className="no-sessions">No chat sessions yet</div>
              )}
            </div>
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
            <div className="session-actions">
              <div className="add-prompt-form">
                <input
                  type="text"
                  placeholder="Prompt name"
                  value={newPrompt.name}
                  onChange={(e) => setNewPrompt({...newPrompt, name: e.target.value})}
                />
                <input
                  type="text"
                  placeholder="Slash command (e.g. /fix)"
                  value={newPrompt.shortcutKey}
                  onChange={(e) => setNewPrompt({...newPrompt, shortcutKey: e.target.value})}
                />
                <input
                  type="text"
                  placeholder="Category (optional)"
                  value={newPrompt.category}
                  onChange={(e) => setNewPrompt({...newPrompt, category: e.target.value})}
                />
                <textarea
                  placeholder="Prompt content"
                  value={newPrompt.content}
                  onChange={(e) => setNewPrompt({...newPrompt, content: e.target.value})}
                  rows={3}
                />
                <button onClick={addNewPrompt}>Add Prompt</button>
              </div>
            </div>

            <div className="prompt-list">
              {promptShortcuts.map(prompt => (
                <div key={prompt.id} className="prompt-item">
                  <div className="prompt-content">
                    <div className="prompt-name">{prompt.name}</div>
                    <div className="prompt-text">{prompt.content.substring(0, 100)}{prompt.content.length > 100 ? '...' : ''}</div>
                    <div className="prompt-category">{prompt.category}</div>
                  </div>
                  <div className="prompt-actions">
                    <button onClick={() => usePrompt(prompt.content)}>Use</button>
                    <button onClick={() => deletePromptShortcutFromDB(prompt.id)}>Delete</button>
                  </div>
                </div>
              ))}

              {promptShortcuts.length === 0 && (
                <div className="no-prompts">No prompt shortcuts yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const usePrompt = (content: string) => {
    setInput(content);
    setShowPrompts(false);
  };

  return (
    <div className="popup-container standalone-chat">
      <div className="popup-header">
        <h2>💎 Prism Chat</h2>
        <div className="header-actions">
          <select
            value={aiConfig.provider}
            onChange={(e) => {
              const updatedConfig = { ...aiConfig, provider: e.target.value as AIConfig['provider'] };
              setAiConfig(updatedConfig);
              client.updateAIConfig(updatedConfig);
              
              // Save the updated config to localStorage
              localStorage.setItem('aiConfig', JSON.stringify(updatedConfig));
            }}
            className="provider-selector"
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
          
          {availableModels.length > 0 && (
            <select
              value={aiConfig.model || ''}
              onChange={(e) => updateModel(e.target.value)}
              className="model-selector"
              disabled={fetchingModels}
            >
              <option value="">Select model</option>
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          )}
          
          <button onClick={() => setShowMenu(true)} className="menu-btn">📋</button>
          <button onClick={() => setShowPrompts(true)} className="prompts-btn">⚡</button>
          <button onClick={clearHistory} className="clear-btn">🗑️</button>
        </div>
      </div>

      <div className="popup-body">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>👋 Start a new conversation!</p>
              <p>Ask anything and I'll help you find answers.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const currentMsgDate = new Date(msg.timestamp);
              const previousMsgDate = messages.indexOf(msg) > 0 ? 
                new Date(messages[messages.indexOf(msg) - 1].timestamp) : null;
              const showDateSeparator = !previousMsgDate || 
                currentMsgDate.toDateString() !== previousMsgDate.toDateString();
              
              const timeString = currentMsgDate.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              });
              
              // Calculate relative time (e.g. "2m ago")
              const now = Date.now();
              const diffInSeconds = Math.floor((now - msg.timestamp) / 1000);
              let relativeTime = '';
              if (diffInSeconds < 60) {
                relativeTime = 'just now';
              } else if (diffInSeconds < 3600) {
                const minutes = Math.floor(diffInSeconds / 60);
                relativeTime = `${minutes}m ago`;
              } else if (diffInSeconds < 86400) {
                const hours = Math.floor(diffInSeconds / 3600);
                relativeTime = `${hours}h ago`;
              } else {
                const days = Math.floor(diffInSeconds / 86400);
                relativeTime = `${days}d ago`;
              }
              
              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="date-separator">
                      {currentMsgDate.toLocaleDateString([], { 
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </div>
                  )}
                  <div
                    className={`message ${msg.role === 'user' ? 'user' : 'assistant'}`}
                  >
                    <div className="message-header">
                      <div className="timestamp-container">
                        <span className="message-timestamp">{timeString}</span>
                        <span className="relative-time">{relativeTime}</span>
                      </div>
                      <div className="button-container">
                        <button 
                          className="copy-message-btn" 
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content);
                          }}
                          title="Copy message"
                        >
                          📋
                        </button>
                        {msg.role === 'assistant' && (
                          <button 
                            className="resend-message-btn" 
                            onClick={() => setInput(messages[messages.indexOf(msg) - 1]?.content || '')}
                            title="Resend message"
                          >
                            ↪️
                          </button>
                        )}
                      </div>
                    </div>
                    {messages.indexOf(msg) > 0 && (
                      <div className="time-since-previous">
                        {Math.floor((msg.timestamp - messages[messages.indexOf(msg) - 1].timestamp) / 60000)}m after previous
                      </div>
                    )}
                    <div className="message-content">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({node, inline, className, children, ...props}) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <div className="code-block-wrapper">
                                <div className="code-header">
                                  <span>{match[1]}</span>
                                  <button 
                                    className="copy-code-btn" 
                                    onClick={() => navigator.clipboard.writeText(String(children))}
                                    title="Copy code"
                                  >
                                    📋
                                  </button>
                                </div>
                                <SyntaxHighlighter
                                  style={atomDark}
                                  language={match[1]}
                                  PreTag="div"
                                  {...props}
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              </div>
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
                    {msg.images && msg.images.length > 0 && (
                      <div className="message-images">
                        {msg.images.map((img, idx) => (
                          <img key={idx} src={img} alt={`Uploaded ${idx}`} className="uploaded-image-preview" />
                        ))}
                      </div>
                    )}
                    {msg.context && (
                      <div className="message-context">
                        🔗 {msg.context.title || msg.context.url}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>

        {generatedImage && (
          <div className="generated-image-container">
            <h3>Generated Image:</h3>
            <img src={generatedImage} alt="Generated" className="generated-image" />
            <button onClick={() => setGeneratedImage(null)}>Clear</button>
          </div>
        )}

        <div className="input-container">
          <div className="input-actions">
            <button
              className={`action-btn ${sendSelectedText ? 'active' : ''}`}
              onClick={() => setSendSelectedText(!sendSelectedText)}
              title="Include selected text in your message"
            >
              📝
            </button>
            <button
              className={`action-btn ${sendPageContents ? 'active' : ''}`}
              onClick={() => setSendPageContents(!sendPageContents)}
              title="Include page contents in your message"
            >
              📄
            </button>
            <button
              className={`action-btn ${sendScreenshot ? 'active' : ''}`}
              onClick={() => setSendScreenshot(!sendScreenshot)}
              title="Include screenshot in your message"
            >
              📷
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
                } else {
                  e.preventDefault();
                  sendMessage();
                }
              }
            }}
            placeholder="Ask anything..."
            disabled={loading}
            rows={2}
          />
          <div className="input-footer">
            <div className="send-options">
              {sendSelectedText && <span className="send-option active" title="Selected text">📝</span>}
              {sendPageContents && <span className="send-option active" title="Page contents">📄</span>}
              {sendScreenshot && <span className="send-option active" title="Screenshot">📷</span>}
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
      </div>

      {showMenu && renderMenu()}
      {showPrompts && renderPromptShortcuts()}
    </div>
  );
}