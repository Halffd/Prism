import React, { useState, useEffect, useRef } from 'react';
import { PrismClient } from '@prism/api-client';
import type { Message, ContextData } from '@prism/shared-types';
import './Popup.scss';

const client = new PrismClient('http://localhost:3000/api');

export function Popup() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<ContextData | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load history from storage
    loadHistory();
    
    // Check for pending query (from context menu)
    checkPendingQuery();
    
    // Get current page context
    getCurrentContext();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = async () => {
    const result = await chrome.storage.local.get('history');
    if (result.history) {
      setMessages(result.history);
    }
  };

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

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
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
          content: input,
          context
        }
      });

      if (response.success && response.data) {
        setMessages([...newMessages, response.data]);
        
        // Save to storage
        await chrome.storage.local.set({ 
          history: [...newMessages, response.data] 
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    setMessages([]);
    await chrome.storage.local.remove('history');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1>💎 Prism</h1>
        <div className="header-actions">
          {context && (
            <span className="context-indicator" title={context.title}>
              📄 Context: {context.type}
            </span>
          )}
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
                {msg.content}
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
          placeholder="Ask about this page..."
          disabled={loading}
          rows={2}
        />
        <button 
          onClick={sendMessage} 
          disabled={loading || !input.trim()}
          className="send-btn"
        >
          {loading ? '⏳' : '🚀'}
        </button>
      </div>
    </div>
  );
}