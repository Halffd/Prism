import React, { useState, useEffect } from 'react';
import { AIConfig } from '@prism/shared-types';
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
  apiUrl: 'http://localhost:3000/api'
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

  useEffect(() => {
    loadSettings();
  }, []);

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
        const config = result.aiConfig as AIConfig;
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

  const updateSettings = async () => {
    try {
      // Save AI configuration
      await chrome.storage.local.set({
        aiConfig: aiConfig
      });

      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: aiConfig
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

      if (onClose) onClose();
    } catch (error) {
      console.error('Failed to update settings:', error);
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
          <h3>AI Configuration</h3>
          <div className="form-group">
            <label>AI Provider</label>
            <select
              value={aiConfig.provider}
              onChange={(e) => setAiConfig({...aiConfig, provider: e.target.value as any})}
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