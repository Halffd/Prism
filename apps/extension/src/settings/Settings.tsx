import React, { useState, useEffect } from 'react';
import { AIConfig, ExtensionSettings, PopupDisplayMode } from '@prism/shared-types';
import { UnifiedAIClient } from '@prism/api-client';
import {
  getPromptShortcuts,
  savePromptShortcut,
  deletePromptShortcut,
  PromptShortcut
} from '@prism/shared-db';
import './Settings.scss';

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

interface SettingsProps {
  onClose?: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [aiConfig, setAiConfig] = useState<AIConfig>(defaultAIConfig);
  const [imageGenerationApiKey, setImageGenerationApiKey] = useState<string>('');
  const [imageGenerationModel, setImageGenerationModel] = useState<string>('stabilityai/stable-diffusion-2-1');
  const [excludedSites, setExcludedSites] = useState<string[]>([]);
  const [whitelistedSites, setWhitelistedSites] = useState<string[]>([]);
  const [promptShortcuts, setPromptShortcuts] = useState<PromptShortcut[]>([]);
  const [newPrompt, setNewPrompt] = useState({
    name: '',
    content: '',
    category: '',
    shortcutKey: ''
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [displayMode, setDisplayMode] = useState<PopupDisplayMode>('popup');
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('right');
  const [sidebarWidth, setSidebarWidth] = useState<number>(350);
  const [pageContentTokenLimit, setPageContentTokenLimit] = useState<number>(20000);
  const [totalMessageTokenLimit, setTotalMessageTokenLimit] = useState<number>(20000);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  // Auto-save settings when any setting changes
  useEffect(() => {
    // Clear previous timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Set new timeout to save settings after 1 second of inactivity
    const timeout = setTimeout(() => {
      updateSettingsAuto();
    }, 1000);

    setSaveTimeout(timeout);

    // Cleanup function
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [aiConfig, imageGenerationApiKey, imageGenerationModel, excludedSites, whitelistedSites, displayMode, sidebarPosition, sidebarWidth]);

  const loadSettings = async () => {
    try {
      // Load AI configuration from chrome storage
      const result = await chrome.storage.local.get([
        'aiConfig',
        'imageGenApiKey',
        'imageGenModel',
        'excludedSites',
        'whitelistedSites'
      ]);

      if (result.aiConfig) {
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

        setAiConfig(config);
      } else {
        setAiConfig(defaultAIConfig);
      }

      if (result.imageGenApiKey) {
        setImageGenerationApiKey(result.imageGenApiKey);
      }

      if (result.imageGenModel) {
        setImageGenerationModel(result.imageGenModel);
      }

      if (result.excludedSites) {
        setExcludedSites(result.excludedSites);
      }

      if (result.whitelistedSites) {
        setWhitelistedSites(result.whitelistedSites);
      }

      // Load display preferences
      if (result.displaySettings) {
        const displaySettings = result.displaySettings as ExtensionSettings;
        setDisplayMode(displaySettings.popupDisplayMode || 'popup');
        setSidebarPosition(displaySettings.sidebarPosition || 'right');
        setSidebarWidth(displaySettings.sidebarWidth || 350);
        setPageContentTokenLimit(displaySettings.pageContentTokenLimit || 20000);
        setTotalMessageTokenLimit(displaySettings.totalMessageTokenLimit || 20000);
      } else {
        // Set defaults
        setDisplayMode('popup');
        setSidebarPosition('right');
        setSidebarWidth(350);
        setPageContentTokenLimit(20000);
        setTotalMessageTokenLimit(20000);
      }

      // Load prompt shortcuts
      const shortcuts = await getPromptShortcuts();
      setPromptShortcuts(shortcuts);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setAiConfig(defaultAIConfig);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableModels = async () => {
    setFetchingModels(true);
    try {
      // Create a temporary client with the current AI config
      // Update the current provider's API key in the config temporarily to use the new providerKeys structure
      const tempConfig = { ...aiConfig };

      if (tempConfig.providerKeys) {
        // Temporarily set apiKey to the current provider's key
        tempConfig.apiKey = tempConfig.providerKeys[tempConfig.provider] || '';

        // For prism-api, use the apiUrl field
        if (tempConfig.provider === 'prism-api' && tempConfig.providerKeys['prism-api']) {
          tempConfig.apiUrl = tempConfig.providerKeys['prism-api'];
        }
      }

      const client = new UnifiedAIClient({ aiConfig: tempConfig });
      const models = await client.getAvailableModels();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error fetching available models:', error);
      alert('Failed to fetch available models. Please check your API key and connection.');
    } finally {
      setFetchingModels(false);
    }
  };

  const updateSettings = async () => {
    try {
      // Update the current provider's API key in the providerKeys object
      const updatedConfig = { ...aiConfig };

      if (updatedConfig.providerKeys) {
        // Set the apiKey field to the current provider's key for backward compatibility
        updatedConfig.apiKey = updatedConfig.providerKeys[updatedConfig.provider] || '';

        // For prism-api, also use the apiUrl field
        if (updatedConfig.provider === 'prism-api' && updatedConfig.providerKeys['prism-api']) {
          updatedConfig.apiUrl = updatedConfig.providerKeys['prism-api'];
        }
      }

      // Save AI configuration
      await chrome.storage.local.set({
        aiConfig: updatedConfig
      });

      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: updatedConfig
      });

      // Save image generation settings
      await chrome.storage.local.set({
        imageGenApiKey: imageGenerationApiKey,
        imageGenModel: imageGenerationModel
      });

      // Save excluded and whitelisted sites
      await chrome.storage.local.set({
        excludedSites: excludedSites,
        whitelistedSites: whitelistedSites
      });

      // Save display preferences
      await chrome.storage.local.set({
        displaySettings: {
          popupDisplayMode: displayMode,
          sidebarPosition: sidebarPosition,
          sidebarWidth: sidebarWidth,
          enablePopupIframe: displayMode === 'iframe',
          enableSidebar: displayMode === 'sidebar',
          pageContentTokenLimit: pageContentTokenLimit,
          totalMessageTokenLimit: totalMessageTokenLimit
        } as ExtensionSettings
      });

      // Send a message to update the display mode across the extension
      await chrome.runtime.sendMessage({
        type: 'UPDATE_DISPLAY_MODE',
        data: {
          popupDisplayMode: displayMode,
          sidebarPosition: sidebarPosition,
          sidebarWidth: sidebarWidth,
          pageContentTokenLimit: pageContentTokenLimit,
          totalMessageTokenLimit: totalMessageTokenLimit
        }
      });

      if (onClose) onClose();
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  };

  const updateSettingsAuto = async () => {
    try {
      // Update the current provider's API key in the providerKeys object
      const updatedConfig = { ...aiConfig };

      if (updatedConfig.providerKeys) {
        // Set the apiKey field to the current provider's key for backward compatibility
        updatedConfig.apiKey = updatedConfig.providerKeys[updatedConfig.provider] || '';

        // For prism-api, also use the apiUrl field
        if (updatedConfig.provider === 'prism-api' && updatedConfig.providerKeys['prism-api']) {
          updatedConfig.apiUrl = updatedConfig.providerKeys['prism-api'];
        }
      }

      // Save AI configuration
      await chrome.storage.local.set({
        aiConfig: updatedConfig
      });

      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: updatedConfig
      });

      // Save image generation settings
      await chrome.storage.local.set({
        imageGenApiKey: imageGenerationApiKey,
        imageGenModel: imageGenerationModel
      });

      // Save excluded and whitelisted sites
      await chrome.storage.local.set({
        excludedSites: excludedSites,
        whitelistedSites: whitelistedSites
      });

      // Save display preferences
      await chrome.storage.local.set({
        displaySettings: {
          popupDisplayMode: displayMode,
          sidebarPosition: sidebarPosition,
          sidebarWidth: sidebarWidth,
          enablePopupIframe: displayMode === 'iframe',
          enableSidebar: displayMode === 'sidebar',
          pageContentTokenLimit: pageContentTokenLimit,
          totalMessageTokenLimit: totalMessageTokenLimit
        } as ExtensionSettings
      });

      // Send a message to update the display mode across the extension
      await chrome.runtime.sendMessage({
        type: 'UPDATE_DISPLAY_MODE',
        data: {
          popupDisplayMode: displayMode,
          sidebarPosition: sidebarPosition,
          sidebarWidth: sidebarWidth,
          pageContentTokenLimit: pageContentTokenLimit,
          totalMessageTokenLimit: totalMessageTokenLimit
        }
      });
    } catch (error) {
      console.error('Failed to auto-save settings:', error);
    }
  };

  const addExcludedSite = () => {
    const site = prompt('Enter site URL to exclude (e.g., example.com or www.example.com):');
    if (site && !excludedSites.includes(site)) {
      setExcludedSites([...excludedSites, site]);
    }
  };

  const removeExcludedSite = (index: number) => {
    const newSites = [...excludedSites];
    newSites.splice(index, 1);
    setExcludedSites(newSites);
  };

  const addWhitelistedSite = () => {
    const site = prompt('Enter site URL to whitelist (e.g., example.com or www.example.com):');
    if (site && !whitelistedSites.includes(site)) {
      setWhitelistedSites([...whitelistedSites, site]);
    }
  };

  const removeWhitelistedSite = (index: number) => {
    const newSites = [...whitelistedSites];
    newSites.splice(index, 1);
    setWhitelistedSites(newSites);
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

  const savePromptShortcutToDB = async (prompt: PromptShortcut) => {
    try {
      await savePromptShortcut(prompt);
      // Refresh the list
      const shortcuts = await getPromptShortcuts();
      setPromptShortcuts(shortcuts);
    } catch (error) {
      console.error('Failed to save prompt shortcut:', error);
    }
  };

  const deletePromptShortcutFromDB = async (promptId: string) => {
    if (window.confirm('Are you sure you want to delete this prompt shortcut?')) {
      try {
        await deletePromptShortcut(promptId);
        // Refresh the list
        const shortcuts = await getPromptShortcuts();
        setPromptShortcuts(shortcuts);
      } catch (error) {
        console.error('Failed to delete prompt shortcut:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="settings-container">
        <div className="loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>Extension Settings</h2>
        {onClose && (
          <button onClick={onClose} className="close-btn">✕</button>
        )}
      </div>

      <div className="settings-content">
        <div className="settings-section">
          <h3>AI Provider Selection</h3>
          <div className="form-group">
            <label>Active AI Provider</label>
            <select
              value={aiConfig.provider}
              onChange={(e) => setAiConfig({...aiConfig, provider: e.target.value as any})}
              className="form-control"
            >
              <option value="prism-api">Prism API</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="gemini">Google Gemini</option>
              <option value="qwen">Alibaba Qwen</option>
              <option value="koboldcpp">KoboldCPP</option>
              <option value="llamacpp">Llama.cpp</option>
              <option value="ollama">Ollama</option>
              <option value="sglang">SGLang</option>
              <option value="transformers">Transformers</option>
              <option value="claude">Claude</option>
              <option value="deepseek">DeepSeek</option>
              <option value="grok">Grok</option>
              <option value="openrouter">OpenRouter</option>
              <option value="poe">Poe</option>
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h3>Provider API Keys</h3>
          <div className="form-group">
            <label>OpenAI API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.openai || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  openai: e.target.value
                }
              })}
              placeholder="Enter your OpenAI API key"
              className="form-control"
            />
            <small className="form-hint">Required for OpenAI models (GPT-3.5, GPT-4, etc.)</small>
          </div>

          <div className="form-group">
            <label>Google Gemini API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.gemini || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  gemini: e.target.value
                }
              })}
              placeholder="Enter your Google Gemini API key"
              className="form-control"
            />
            <small className="form-hint">Required for Google's Gemini models</small>
          </div>

          <div className="form-group">
            <label>Alibaba Qwen API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.qwen || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  qwen: e.target.value
                }
              })}
              placeholder="Enter your Alibaba Qwen API key"
              className="form-control"
            />
            <small className="form-hint">Required for Alibaba's Qwen models</small>
          </div>

          <div className="form-group">
            <label>KoboldCPP API URL</label>
            <input
              type="text"
              value={aiConfig.providerKeys?.koboldcpp || aiConfig.localApiUrl || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                localApiUrl: e.target.value,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  koboldcpp: e.target.value
                }
              })}
              placeholder="Enter your KoboldCPP API URL (e.g., http://localhost:5001)"
              className="form-control"
            />
            <small className="form-hint">Enter the URL for your KoboldCPP server</small>
          </div>

          <div className="form-group">
            <label>Llama.cpp API URL</label>
            <input
              type="text"
              value={aiConfig.providerKeys?.llamacpp || aiConfig.localApiUrl || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                localApiUrl: e.target.value,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  llamacpp: e.target.value
                }
              })}
              placeholder="Enter your Llama.cpp API URL (e.g., http://localhost:8080)"
              className="form-control"
            />
            <small className="form-hint">Enter the URL for your Llama.cpp server</small>
          </div>

          <div className="form-group">
            <label>Ollama API URL</label>
            <input
              type="text"
              value={aiConfig.providerKeys?.ollama || aiConfig.localApiUrl || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                localApiUrl: e.target.value,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  ollama: e.target.value
                }
              })}
              placeholder="Enter your Ollama API URL (e.g., http://localhost:11434)"
              className="form-control"
            />
            <small className="form-hint">Enter the URL for your Ollama server</small>
          </div>

          <div className="form-group">
            <label>SGLang API URL</label>
            <input
              type="text"
              value={aiConfig.providerKeys?.sglang || aiConfig.localApiUrl || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                localApiUrl: e.target.value,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  sglang: e.target.value
                }
              })}
              placeholder="Enter your SGLang API URL (e.g., http://localhost:30000)"
              className="form-control"
            />
            <small className="form-hint">Enter the URL for your SGLang server</small>
          </div>

          <div className="form-group">
            <label>Transformers API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.transformers || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  transformers: e.target.value
                }
              })}
              placeholder="Enter your Transformers API key (Hugging Face token)"
              className="form-control"
            />
            <small className="form-hint">API key for Hugging Face Transformers API</small>
          </div>

          <div className="form-group">
            <label>Claude API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.claude || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  claude: e.target.value
                }
              })}
              placeholder="Enter your Anthropic Claude API key"
              className="form-control"
            />
            <small className="form-hint">API key for Anthropic Claude API</small>
          </div>

          <div className="form-group">
            <label>DeepSeek API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.deepseek || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  deepseek: e.target.value
                }
              })}
              placeholder="Enter your DeepSeek API key"
              className="form-control"
            />
            <small className="form-hint">API key for DeepSeek API</small>
          </div>

          <div className="form-group">
            <label>Grok API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.grok || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  grok: e.target.value
                }
              })}
              placeholder="Enter your Grok API key"
              className="form-control"
            />
            <small className="form-hint">API key for Grok API</small>
          </div>

          <div className="form-group">
            <label>OpenRouter API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.openrouter || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  openrouter: e.target.value
                }
              })}
              placeholder="Enter your OpenRouter API key"
              className="form-control"
            />
            <small className="form-hint">API key for OpenRouter API</small>
          </div>

          <div className="form-group">
            <label>Poe API Key</label>
            <input
              type="password"
              value={aiConfig.providerKeys?.poe || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  poe: e.target.value
                }
              })}
              placeholder="Enter your Poe API key"
              className="form-control"
            />
            <small className="form-hint">API key for Poe API (if available)</small>
          </div>

          <div className="form-group">
            <label>Prism API URL</label>
            <input
              type="text"
              value={aiConfig.providerKeys?.['prism-api'] || aiConfig.apiUrl || ''}
              onChange={(e) => setAiConfig({
                ...aiConfig,
                apiUrl: e.target.value,
                providerKeys: {
                  ...aiConfig.providerKeys,
                  'prism-api': e.target.value
                }
              })}
              placeholder="Enter your Prism API URL"
              className="form-control"
            />
            <small className="form-hint">Enter the URL for your Prism API endpoint</small>
          </div>
        </div>

        <div className="settings-section">
          <h3>Model Configuration</h3>
          <div className="form-group">
            <label>Model</label>
            <input
              type="text"
              value={aiConfig.model || ''}
              onChange={(e) => setAiConfig({...aiConfig, model: e.target.value})}
              placeholder="e.g., gpt-3.5-turbo, gemini-pro, qwen-max"
              className="form-control"
            />
            <small className="form-hint">Specify the model to use with the current provider</small>
          </div>

          <div className="form-group">
            <button
              type="button"
              className="fetch-models-btn"
              onClick={fetchAvailableModels}
              disabled={fetchingModels}
            >
              {fetchingModels ? 'Fetching...' : 'Fetch Available Models'}
            </button>
            {availableModels.length > 0 && (
              <div className="available-models">
                <label>Available Models:</label>
                <div className="model-list">
                  {availableModels.map((model, index) => (
                    <button
                      key={index}
                      type="button"
                      className="model-btn"
                      onClick={() => setAiConfig({...aiConfig, model})}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <h3>Display Options</h3>
          <div className="form-group">
            <label>Popup Display Mode</label>
            <select
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value as any)}
              className="form-control"
            >
              <option value="popup">Extension Popup</option>
              <option value="floating">Floating Window</option>
              <option value="sidebar">Sidebar</option>
              <option value="iframe">Popup as Iframe</option>
            </select>
            <small className="form-hint">Choose how the Prism interface appears on web pages</small>
          </div>

          {displayMode === 'sidebar' && (
            <>
              <div className="form-group">
                <label>Sidebar Position</label>
                <select
                  value={sidebarPosition}
                  onChange={(e) => setSidebarPosition(e.target.value as any)}
                  className="form-control"
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>

              <div className="form-group">
                <label>Sidebar Width (px)</label>
                <input
                  type="number"
                  value={sidebarWidth}
                  onChange={(e) => setSidebarWidth(Number(e.target.value))}
                  min="200"
                  max="600"
                  className="form-control"
                />
              </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <h3>Token Limits</h3>
          <div className="form-group">
            <label>Page Content Token Limit</label>
            <input
              type="number"
              value={pageContentTokenLimit}
              onChange={(e) => setPageContentTokenLimit(Number(e.target.value))}
              min="1000"
              max="100000"
              className="form-control"
            />
            <small className="form-hint">Maximum tokens to extract from page content (default: 20000)</small>
          </div>

          <div className="form-group">
            <label>Total Message Token Limit</label>
            <input
              type="number"
              value={totalMessageTokenLimit}
              onChange={(e) => setTotalMessageTokenLimit(Number(e.target.value))}
              min="1000"
              max="100000"
              className="form-control"
            />
            <small className="form-hint">Maximum total tokens for message + context (default: 20000)</small>
          </div>
        </div>

        <div className="settings-section">
          <h3>Image Generation</h3>
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

        <div className="settings-section">
          <h3>Site Permissions</h3>
          <div className="form-group">
            <label>Excluded Sites</label>
            <div className="site-list">
              {excludedSites.map((site, index) => (
                <div key={index} className="site-item">
                  <span>{site}</span>
                  <button
                    className="remove-site-btn"
                    onClick={() => removeExcludedSite(index)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {excludedSites.length === 0 && (
                <p className="no-sites">No excluded sites</p>
              )}
            </div>
            <button
              type="button"
              className="add-site-btn"
              onClick={addExcludedSite}
            >
              Add Excluded Site
            </button>
          </div>

          <div className="form-group">
            <label>Whitelisted Sites</label>
            <div className="site-list">
              {whitelistedSites.map((site, index) => (
                <div key={index} className="site-item">
                  <span>{site}</span>
                  <button
                    className="remove-site-btn"
                    onClick={() => removeWhitelistedSite(index)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {whitelistedSites.length === 0 && (
                <p className="no-sites">No whitelisted sites</p>
              )}
            </div>
            <button
              type="button"
              className="add-site-btn"
              onClick={addWhitelistedSite}
            >
              Add Whitelisted Site
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Prompt Shortcuts</h3>
          <div className="form-group">
            <div className="prompt-form">
              <input
                type="text"
                placeholder="Prompt name"
                value={newPrompt.name}
                onChange={(e) => setNewPrompt({...newPrompt, name: e.target.value})}
                className="prompt-input form-control"
              />
              <input
                type="text"
                placeholder="Slash command (e.g. /fix)"
                value={newPrompt.shortcutKey}
                onChange={(e) => setNewPrompt({...newPrompt, shortcutKey: e.target.value})}
                className="prompt-input form-control"
              />
              <textarea
                placeholder="Prompt content"
                value={newPrompt.content}
                onChange={(e) => setNewPrompt({...newPrompt, content: e.target.value})}
                className="prompt-textarea form-control"
                rows={3}
              />
              <input
                type="text"
                placeholder="Category (optional)"
                value={newPrompt.category}
                onChange={(e) => setNewPrompt({...newPrompt, category: e.target.value})}
                className="prompt-input form-control"
              />
              <button
                onClick={addNewPrompt}
                className="prompt-add-btn"
              >
                Add Prompt
              </button>
            </div>
          </div>

          <div className="form-group">
            <div className="prompt-list">
              {promptShortcuts.map(prompt => (
                <div key={prompt.id} className="prompt-item">
                  <div className="prompt-content">
                    <div className="prompt-name">{prompt.name}</div>
                    <div className="prompt-info">
                      {prompt.shortcutKey && <span className="shortcut-tag">{prompt.shortcutKey}</span>}
                    </div>
                    <div className="prompt-text">{prompt.content.substring(0, 50)}{prompt.content.length > 50 ? '...' : ''}</div>
                  </div>
                  <div className="prompt-actions">
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

      <div className="settings-actions">
        <button
          onClick={updateSettings}
          className="save-btn"
        >
          Save Settings
        </button>
        <button
          onClick={onClose}
          className="cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default Settings;