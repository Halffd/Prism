import React from 'react';
import type { AIConfig } from '@prism/shared-types';
import { RootState } from '@prism/redux-store';

interface HeaderSectionProps {
  context: any;
  aiConfig: AIConfig;
  availableModels: string[];
  fetchingModels: boolean;
  isOnline: boolean;
  setShowMenu: (value: boolean) => void;
  updateAIConfig: (config: AIConfig) => void;
  updateModel: (model: string) => void;
  fetchAvailableModels: (config: AIConfig) => void;
  syncFromAPI: () => void;
  syncToAPI: () => void;
  toggleAutoSync: () => void;
  user: any;
  isAuthenticated: boolean;
  signInWithGoogle: () => void;
  signOut: () => void;
  autoSyncEnabled: boolean;
}

export const HeaderSection: React.FC<HeaderSectionProps> = ({
  context,
  aiConfig,
  availableModels,
  fetchingModels,
  isOnline,
  setShowMenu,
  updateAIConfig,
  updateModel,
  fetchAvailableModels,
  syncFromAPI,
  syncToAPI,
  toggleAutoSync,
  user,
  isAuthenticated,
  signInWithGoogle,
  signOut,
  autoSyncEnabled
}) => {
  return (
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
        {context && (
          <span className="context-indicator" title={context.title}>
            📄 {context.type}
          </span>
        )}
        <select
          value={aiConfig.provider}
          onChange={(e) => {
            const newProvider = e.target.value as AIConfig['provider'];
            const updatedConfig = { ...aiConfig, provider: newProvider };
            updateAIConfig(updatedConfig);
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
          <option value="nvidia-nim">NVIDIA NIM</option>
          <option value="groq">Groq</option>
          <option value="cerebras">Cerebras</option>
          <option value="cloudflare-workers">Cloudflare Workers</option>
          <option value="fireworks">Fireworks</option>
          <option value="zai">Z.AI</option>
        </select>

        <select
          value={aiConfig.model || ''}
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
          onClick={() => {
            // Assuming clearHistory is passed as a prop
          }}
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
        <span className="provider-indicator" title={`Current provider: ${aiConfig.provider}`}>
          {aiConfig.provider === 'openai' && '🤖'}
          {aiConfig.provider === 'gemini' && '⭐'}
          {aiConfig.provider === 'claude' && '🤝'}
          {aiConfig.provider === 'qwen' && '☁️'}
          {aiConfig.provider === 'prism-api' && '💎'}
          {aiConfig.provider === 'koboldcpp' && '👻'}
          {aiConfig.provider === 'llamacpp' && '🦙'}
          {aiConfig.provider === 'ollama' && '🦙'}
          {aiConfig.provider === 'sglang' && '⚡'}
          {aiConfig.provider === 'transformers' && '🔄'}
          {aiConfig.provider === 'deepseek' && '🔍'}
          {aiConfig.provider === 'grok' && '🤖'}
          {aiConfig.provider === 'openrouter' && '🌐'}
          {aiConfig.provider === 'poe' && '💬'}
          {aiConfig.provider === 'nvidia-nim' && '🟢'}
          {aiConfig.provider === 'groq' && '⚡'}
          {aiConfig.provider === 'cerebras' && '🔥'}
          {aiConfig.provider === 'cloudflare-workers' && '🟠'}
          {aiConfig.provider === 'fireworks' && '🎆'}
          {aiConfig.provider === 'zai' && '🟣'}
          <span className="provider-name">{aiConfig.provider}</span>
        </span>
      </div>
    </div>
  );
};