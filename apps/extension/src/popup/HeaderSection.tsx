import type { AIConfig } from '@prism/shared-types';
import { Icon } from '@prism/ui-components';
import type { ProviderOption } from './provider-catalog';

interface HeaderSectionProps {
  context: { title?: string; type?: string } | null;
  aiConfig: AIConfig;
  availableModels: string[];
  fetchingModels: boolean;
  isOnline: boolean;
  providerOptions: ProviderOption[];
  setShowMenu: (value: boolean) => void;
  updateAIConfig: (config: AIConfig) => void;
  updateModel: (model: string) => void;
  fetchAvailableModels: (config: AIConfig) => void;
  syncFromAPI: () => void;
  syncToAPI: () => void;
  toggleAutoSync: () => void;
  user: { displayName?: string | null; email?: string | null } | null;
  isAuthenticated: boolean;
  signInWithGoogle: () => void;
  signOut: () => void;
  autoSyncEnabled: boolean;
}

/** The icon shown next to the provider name. */
const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  gemini: '⭐',
  claude: '🤝',
  qwen: '☁️',
  'prism-api': '💎',
  koboldcpp: '👻',
  llamacpp: '🦙',
  ollama: '🦙',
  sglang: '⚡',
  transformers: '🔄',
  deepseek: '🔍',
  grok: '🤖',
  openrouter: '🌐',
  poe: '💬',
  'nvidia-nim': '🟢',
  groq: '⚡',
  cerebras: '🔥',
  'cloudflare-workers': '🟠',
  fireworks: '🎆',
  zai: '🟣',
};

export const HeaderSection: React.FC<HeaderSectionProps> = ({
  context,
  aiConfig,
  availableModels,
  fetchingModels,
  isOnline,
  providerOptions,
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
  autoSyncEnabled,
}) => {
  // The Prism API sync is optional: it needs a signed-in user and a
  // reachable API. Normal use — picking a provider, picking a model,
  // chatting — never depends on it.
  const syncDisabled = !isOnline || !isAuthenticated;
  const syncTitle = !isAuthenticated
    ? 'Sign in to sync with the Prism API'
    : !isOnline
      ? 'The Prism API is unreachable'
      : 'Sync with the Prism API';

  return (
    <div className="popup-header">
      <h1>💎 Prism</h1>
      <div className="header-actions">
        <button onClick={() => setShowMenu(true)} className="menu-btn">
          ☰
        </button>
        {/* Close button for popup when in browser action mode */}
        <button
          onClick={() => {
            if (typeof window !== 'undefined' && window.close) {
              window.close();
            }
          }}
          className="close-btn"
          title="Close popup"
          style={{
            display:
              typeof window !== 'undefined' &&
              window.location?.pathname?.includes('index.html')
                ? 'block'
                : 'none',
          }}
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
          aria-label="Select AI provider"
        >
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>

        {(aiConfig.customModels ?? []).length > 0 && (
          <select
            value={aiConfig.activeCustomModelId ?? ''}
            onChange={(e) => {
              const customModel = (aiConfig.customModels ?? []).find(
                (entry) => entry.id === e.target.value,
              );
              if (!customModel) {
                return;
              }
              updateAIConfig({
                ...aiConfig,
                activeCustomModelId: customModel.id,
                model: customModel.model,
              });
            }}
            className="custom-model-selector"
            title="Select a custom model endpoint"
          >
            <option value="">Custom: none</option>
            {(aiConfig.customModels ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label || 'Untitled'}
              </option>
            ))}
          </select>
        )}

        <select
          value={aiConfig.model || ''}
          onChange={(e) => updateModel(e.target.value)}
          className="model-selector"
          title="Select AI model"
          aria-label="Select AI model"
          disabled={fetchingModels || availableModels.length === 0}
        >
          {fetchingModels ? (
            <option value="">Loading models...</option>
          ) : availableModels.length > 0 ? (
            availableModels.map((model) => (
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
        <div
          className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
          title={isOnline ? 'Online' : 'Offline'}
        ></div>
        <button
          onClick={syncFromAPI}
          className="sync-from-btn"
          title={`${syncTitle} (from)`}
          aria-label="Sync from Prism API"
          disabled={syncDisabled}
        >
          📥
        </button>
        <button
          onClick={syncToAPI}
          className="sync-to-btn"
          title={`${syncTitle} (to)`}
          aria-label="Sync to Prism API"
          disabled={syncDisabled}
        >
          📤
        </button>
        <button
          onClick={toggleAutoSync}
          className="autosync-btn"
          title={
            syncDisabled
              ? syncTitle
              : autoSyncEnabled
                ? 'Stop Auto-Sync'
                : 'Start Auto-Sync'
          }
          aria-label="Toggle auto-sync with the Prism API"
          disabled={syncDisabled}
        >
          {autoSyncEnabled ? '⏸️' : '▶️'}
        </button>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="settings-btn"
          title="Settings"
        >
          <Icon name="settings" title="Settings" />
        </button>
        <button
          onClick={() => {
            // Assuming clearHistory is passed as a prop
          }}
          className="clear-btn"
          title="Clear Chat"
        >
          <Icon name="delete" title="Clear Chat" />
        </button>
        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            <span className="text-xs truncate max-w-[100px]">
              {user?.displayName || user?.email}
            </span>
            <button
              onClick={signOut}
              className="auth-signout-btn"
              title="Sign Out"
            >
              <Icon name="smart_toy" title="Signed in" />
            </button>
          </div>
        ) : (
          <button
            onClick={signInWithGoogle}
            className="auth-signin-btn"
            title="Sign In with Google"
            disabled={!isOnline}
          >
            <Icon name="keyboard" title="Sign In with Google" />
          </button>
        )}
        <span
          className="provider-indicator"
          title={`Current provider: ${aiConfig.provider}`}
        >
          {PROVIDER_ICONS[aiConfig.provider] ?? '🔌'}
          <span className="provider-name">{aiConfig.provider}</span>
        </span>
      </div>
    </div>
  );
};
