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
  loadChatSessionById
} from '@prism/shared-db';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';
import './ChatPage.scss';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'openai',
  apiUrl: 'http://localhost:3000/api'
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

export function ChatPage() {
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
  const [selectedProvider, setSelectedProvider] = useState<AIConfig['provider']>('openai');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load AI configuration from chrome storage
    chrome.storage.local.get(['aiConfig'], (result) => {
      if (result.aiConfig) {
        try {
          const config = result.aiConfig as AIConfig;
          setAiConfig(config);
          setSelectedProvider(config.provider);
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

    // Load chat sessions
    loadChatSessionsFromDB();
    
    // Load current chat history
    loadChatHistoryFromDB();
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
      setMessages([]);
    }
  };

  const loadChatSessionsFromDB = async () => {
    try {
      const sessionsList = await getChatSessions();
      setSessions(sessionsList);
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
      setSessions([]);
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
      const history = await loadChatSessionById(sessionId);
      if (history) {
        setMessages(history.messages);
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
    if (!input.trim()) return;

    // Load extension settings to get token limits
    const result = await chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings;
    const totalMessageTokenLimit = settings?.totalMessageTokenLimit || 20000;

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
      context
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // Temporarily use selected provider for this message
      const tempConfig = { ...aiConfig, provider: selectedProvider };
      client.updateAIConfig(tempConfig);

      const response = await client.sendMessage(input, context, currentSessionId);

      if (response.success && response.data) {
        const updatedMessages = [...newMessages, response.data];
        setMessages(updatedMessages);

        // Save to database
        await saveCurrentChatToDB(updatedMessages);

        // Update the current AI config back to the original if different
        if (aiConfig.provider !== selectedProvider) {
          client.updateAIConfig(aiConfig);
        }
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

  const copyMessageToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // Optionally show a toast notification or visual feedback
      console.log('Message copied to clipboard');
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const copyCodeToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      // Optionally show a toast notification or visual feedback
      console.log('Code copied to clipboard');
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const resendMessage = async (message: Message) => {
    if (message.role === 'user') {
      // Resend the user's message by putting it in the input field
      setInput(message.content);
    } else if (message.role === 'assistant') {
      // Find the corresponding user message and resend it
      const userMessageIndex = messages.findIndex(
        (msg, idx) => idx < messages.indexOf(message) && msg.role === 'user'
      );
      if (userMessageIndex !== -1) {
        setInput(messages[userMessageIndex].content);
      }
    }
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);

    if (diffInSeconds < 60) {
      return 'just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  const getTimeSinceLastMessage = (currentIndex: number): string | null => {
    if (currentIndex === 0) return null; // First message has no previous message

    const currentTimestamp = messages[currentIndex].timestamp;
    const previousTimestamp = messages[currentIndex - 1].timestamp;

    const diffInSeconds = Math.floor((currentTimestamp - previousTimestamp) / 1000);

    if (diffInSeconds < 60) {
      return `sent ${diffInSeconds}s after previous message`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `sent ${minutes}m after previous message`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `sent ${hours}h after previous message`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `sent ${days}d after previous message`;
    }
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

  return (
    <div className="chat-page-container">
      <div className="chat-header">
        <h1>💎 Prism Chat</h1>
        <div className="header-actions">
          <select 
            value={selectedProvider} 
            onChange={(e) => setSelectedProvider(e.target.value as AIConfig['provider'])}
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
          
          <button onClick={() => setShowMenu(true)} className="menu-btn">📋</button>
          <button onClick={clearHistory} className="clear-btn">🗑️</button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>👋 Start a new conversation!</p>
            <p>Choose a provider and send your first message.</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const currentMsgDate = new Date(msg.timestamp);
            const previousMsgDate = index > 0 ? new Date(messages[index - 1].timestamp) : null;
            const showDateSeparator = !previousMsgDate ||
              currentMsgDate.toDateString() !== previousMsgDate.toDateString();

            const timeString = currentMsgDate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });

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
                      <span className="relative-time">{getRelativeTime(msg.timestamp)}</span>
                    </div>
                    {msg.role === 'user' ? (
                      <button
                        className="copy-message-btn"
                        onClick={() => copyMessageToClipboard(msg.content)}
                        title="Copy message"
                      >
                        📋
                      </button>
                    ) : (
                      <>
                        <button
                          className="copy-message-btn"
                          onClick={() => copyMessageToClipboard(msg.content)}
                          title="Copy message"
                        >
                          📋
                        </button>
                        <button
                          className="resend-message-btn"
                          onClick={() => resendMessage(msg)}
                          title="Resend message"
                        >
                          ↪️
                        </button>
                      </>
                    )}
                  </div>
                  {index > 0 && (
                    <div className="time-since-previous">
                      {getTimeSinceLastMessage(index)}
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
                                  onClick={() => copyCodeToClipboard(String(children))}
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

      <div className="input-container">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Type your message here..."
          disabled={loading}
          rows={3}
        />
        <div className="input-footer">
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="send-btn"
          >
            {loading ? '⏳' : '🚀 Send'}
          </button>
        </div>
      </div>

      {showMenu && renderMenu()}
    </div>
  );
}