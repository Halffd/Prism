import React, { useState, useEffect } from 'react';
import { AIConfig, ExtensionSettings, PopupDisplayMode, PromptShortcut } from '@prism/shared-types';
import { UnifiedAIClient } from '@prism/api-client';
import {
  getSetting,
  saveSetting,
  getSiteFilters,
  addSiteFilter,
  removeSiteFilter,
  getImageGenConfig,
  saveImageGenConfig
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
  // Removed commandPrefix state as we're using individual prompt shortcuts instead of global prefix
  const [buttonPositionTop, setButtonPositionTop] = useState<number>(20);
  const [buttonPositionRight, setButtonPositionRight] = useState<number>(20);
  const [textSelectionKey, setTextSelectionKey] = useState<string>('1');
  const [pageContextKey, setPageContextKey] = useState<string>('2');
  const [pageScreenshotKey, setPageScreenshotKey] = useState<string>('3');
  const [clipboardKey, setClipboardKey] = useState<string>('4');
  const [pageInfoKey, setPageInfoKey] = useState<string>('5');
  const [iframeToggleKey, setIframeToggleKey] = useState<string>('`');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [buttonSensitivityAreaPercentage, setButtonSensitivityAreaPercentage] = useState<number>(10);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [apiClient, setApiClient] = useState<UnifiedAIClient | null>(null);

  useEffect(() => {
    // Initialize API client with current settings
    const initializeApiClient = async () => {
      // Try to get AI config from local database first, fallback to chrome.storage
      let aiConfig = await getSetting<AIConfig>('aiConfig');

      if (!aiConfig) {
        // Fallback to chrome.storage if not found in local DB
        const result = await chrome.storage.local.get(['aiConfig']);
        aiConfig = result.aiConfig;
      }

      const client = new UnifiedAIClient({
        aiConfig: aiConfig,
        prismApiUrl: aiConfig?.providerKeys?.['prism-api'] || 'http://localhost:3000/api'
      });
      setApiClient(client);
      loadSettings(client);
    };

    initializeApiClient();
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

  const loadSettings = async (client: UnifiedAIClient) => {
    try {
      // Load AI configuration from local database first, fallback to chrome.storage
      let aiConfig = await getSetting<AIConfig>('aiConfig');

      if (!aiConfig) {
        // Fallback to chrome.storage if not found in local DB
        const result = await chrome.storage.local.get(['aiConfig']);
        aiConfig = result.aiConfig;
      }

      if (aiConfig) {
        let config = aiConfig as AIConfig;

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

      // Load image generation config from local database
      const imageGenConfig = await getImageGenConfig();
      if (imageGenConfig) {
        setImageGenerationApiKey(imageGenConfig.apiKey);
        setImageGenerationModel(imageGenConfig.model);
      } else {
        // Fallback to chrome.storage
        const result = await chrome.storage.local.get(['imageGenApiKey', 'imageGenModel']);
        if (result.imageGenApiKey) {
          setImageGenerationApiKey(result.imageGenApiKey);
        }
        if (result.imageGenModel) {
          setImageGenerationModel(result.imageGenModel);
        }
      }

      // Load site filters from local database
      const excludedFilters = await getSiteFilters('exclude');
      setExcludedSites(excludedFilters.map(f => f.urlPattern));

      const whitelistedFilters = await getSiteFilters('whitelist');
      setWhitelistedSites(whitelistedFilters.map(f => f.urlPattern));

      // Load display preferences from local database
      const displaySettings = await getSetting<ExtensionSettings>('displaySettings');
      if (displaySettings) {
        setDisplayMode(displaySettings.popupDisplayMode || 'popup');
        setSidebarPosition(displaySettings.sidebarPosition || 'right');
        setSidebarWidth(displaySettings.sidebarWidth || 350);
        setPageContentTokenLimit(displaySettings.pageContentTokenLimit || 20000);
        setTotalMessageTokenLimit(displaySettings.totalMessageTokenLimit || 20000);
        // Removed commandPrefix loading as we're using individual prompt shortcuts instead of global prefix
        setButtonPositionTop(displaySettings.buttonPosition?.top || 20);
        setButtonPositionRight(displaySettings.buttonPosition?.right || 20);
        setTextSelectionKey(displaySettings.textSelectionKey || '1');
        setPageContextKey(displaySettings.pageContextKey || '2');
        setPageScreenshotKey(displaySettings.pageScreenshotKey || '3');
        setClipboardKey(displaySettings.clipboardKey || '4');
        setPageInfoKey(displaySettings.pageInfoKey || '5');
        setIframeToggleKey(displaySettings.iframeToggleKey || '`');
        setSystemPrompt(displaySettings.systemPrompt || '');
        setButtonSensitivityAreaPercentage(displaySettings.buttonSensitivityAreaPercentage || 10);
      } else {
        // Fallback to chrome.storage
        const result = await chrome.storage.local.get(['displaySettings']);
        if (result.displaySettings) {
          const settings = result.displaySettings as ExtensionSettings;
          setDisplayMode(settings.popupDisplayMode || 'popup');
          setSidebarPosition(settings.sidebarPosition || 'right');
          setSidebarWidth(settings.sidebarWidth || 350);
          setPageContentTokenLimit(settings.pageContentTokenLimit || 20000);
          setTotalMessageTokenLimit(settings.totalMessageTokenLimit || 20000);
          // Removed commandPrefix loading as we're using individual prompt shortcuts instead of global prefix
          setButtonPositionTop(settings.buttonPosition?.top || 20);
          setButtonPositionRight(settings.buttonPosition?.right || 20);
          setTextSelectionKey(settings.textSelectionKey || '1');
          setPageContextKey(settings.pageContextKey || '2');
          setPageScreenshotKey(settings.pageScreenshotKey || '3');
          setClipboardKey(settings.clipboardKey || '4');
          setPageInfoKey(settings.pageInfoKey || '5');
          setIframeToggleKey(settings.iframeToggleKey || '`');
          setSystemPrompt(settings.systemPrompt || '');
          setButtonSensitivityAreaPercentage(settings.buttonSensitivityAreaPercentage || 10);
        } else {
          // Set defaults
          setDisplayMode('popup');
          setSidebarPosition('right');
          setSidebarWidth(350);
          setPageContentTokenLimit(20000);
          setTotalMessageTokenLimit(20000);
          // Removed commandPrefix initialization as we're using individual prompt shortcuts instead of global prefix
          setButtonPositionTop(20);
          setButtonPositionRight(20);
          setTextSelectionKey('1');
          setPageContextKey('2');
          setPageScreenshotKey('3');
          setClipboardKey('4');
          setPageInfoKey('5');
          setIframeToggleKey('`');
          setSystemPrompt('');
          setButtonSensitivityAreaPercentage(10);
        }
      }

      // Load prompt shortcuts from API
      if (client) {
        try {
          const response = await client.getSyncedData();
          if (response.success && response.data?.prompts) {
            setPromptShortcuts(response.data.prompts);

            // Also sync to chrome.storage.local for content script access
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              try {
                await chrome.storage.local.set({ promptShortcuts: response.data.prompts });
              } catch (error) {
                console.warn('Could not sync prompt shortcuts to chrome.storage.local:', error);
              }
            }
          } else {
            // Fallback to empty array if API call fails
            setPromptShortcuts([]);
          }
        } catch (error) {
          console.debug('Backend unavailable, using local storage only');
          // Fallback to empty array if API call fails
          setPromptShortcuts([]);
        }
      } else {
        // Fallback to empty array if no client
        setPromptShortcuts([]);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      setAiConfig(defaultAIConfig);
      setPromptShortcuts([]);
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

      // Save AI configuration to local database
      await saveSetting('aiConfig', updatedConfig);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        aiConfig: updatedConfig
      });

      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: updatedConfig
      });

      // Save image generation settings to local database
      await saveImageGenConfig(imageGenerationApiKey, imageGenerationModel);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        imageGenApiKey: imageGenerationApiKey,
        imageGenModel: imageGenerationModel
      });

      // Save excluded and whitelisted sites to local database
      // First, remove all existing filters
      const allFilters = await getSiteFilters();
      for (const filter of allFilters) {
        await removeSiteFilter(filter.id!);
      }

      // Then add the current filters
      for (const site of excludedSites) {
        await addSiteFilter(site, 'exclude');
      }
      for (const site of whitelistedSites) {
        await addSiteFilter(site, 'whitelist');
      }

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        excludedSites: excludedSites,
        whitelistedSites: whitelistedSites
      });

      // Save display preferences to local database
      const displaySettingsObj: ExtensionSettings = {
        popupDisplayMode: displayMode,
        sidebarPosition: sidebarPosition as 'left' | 'right',
        sidebarWidth: sidebarWidth,
        enablePopupIframe: displayMode === 'iframe',
        enableSidebar: displayMode === 'sidebar',
        defaultProvider: updatedConfig.provider,
        pageContentTokenLimit: pageContentTokenLimit,
        totalMessageTokenLimit: totalMessageTokenLimit,
        textSelectionKey: textSelectionKey,
        pageContextKey: pageContextKey,
        pageScreenshotKey: pageScreenshotKey,
        clipboardKey: clipboardKey,
        pageInfoKey: pageInfoKey,
        iframeToggleKey: iframeToggleKey,
        systemPrompt: systemPrompt,
        buttonPosition: {
          top: buttonPositionTop,
          right: buttonPositionRight
        },
        buttonSensitivityAreaPercentage: buttonSensitivityAreaPercentage
      };

      await saveSetting('displaySettings', displaySettingsObj);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        displaySettings: displaySettingsObj
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

      // Sync prompt shortcuts to the API if available
      if (apiClient) {
        try {
          const response = await apiClient.syncPrompts(promptShortcuts);
          if (!response.success) {
            console.error('Failed to sync prompt shortcuts:', response.error);
          }
        } catch (error) {
          console.debug('Backend unavailable, using local storage only');
        }
      }

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

      // Save AI configuration to local database
      await saveSetting('aiConfig', updatedConfig);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        aiConfig: updatedConfig
      });

      await chrome.runtime.sendMessage({
        type: 'UPDATE_AI_CONFIG',
        data: updatedConfig
      });

      // Save image generation settings to local database
      await saveImageGenConfig(imageGenerationApiKey, imageGenerationModel);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        imageGenApiKey: imageGenerationApiKey,
        imageGenModel: imageGenerationModel
      });

      // Save excluded and whitelisted sites to local database
      // First, remove all existing filters
      const allFilters = await getSiteFilters();
      for (const filter of allFilters) {
        await removeSiteFilter(filter.id!);
      }

      // Then add the current filters
      for (const site of excludedSites) {
        await addSiteFilter(site, 'exclude');
      }
      for (const site of whitelistedSites) {
        await addSiteFilter(site, 'whitelist');
      }

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        excludedSites: excludedSites,
        whitelistedSites: whitelistedSites
      });

      // Save display preferences to local database
      const displaySettingsObj: ExtensionSettings = {
        popupDisplayMode: displayMode,
        sidebarPosition: sidebarPosition as 'left' | 'right',
        sidebarWidth: sidebarWidth,
        enablePopupIframe: displayMode === 'iframe',
        enableSidebar: displayMode === 'sidebar',
        defaultProvider: updatedConfig.provider,
        pageContentTokenLimit: pageContentTokenLimit,
        totalMessageTokenLimit: totalMessageTokenLimit,
        textSelectionKey: textSelectionKey,
        pageContextKey: pageContextKey,
        pageScreenshotKey: pageScreenshotKey,
        clipboardKey: clipboardKey,
        pageInfoKey: pageInfoKey,
        iframeToggleKey: iframeToggleKey,
        systemPrompt: systemPrompt,
        buttonPosition: {
          top: buttonPositionTop,
          right: buttonPositionRight
        },
        buttonSensitivityAreaPercentage: buttonSensitivityAreaPercentage
      };

      await saveSetting('displaySettings', displaySettingsObj);

      // Also save to chrome.storage for compatibility
      await chrome.storage.local.set({
        displaySettings: displaySettingsObj
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

      // Sync prompt shortcuts to the API if available
      if (apiClient) {
        try {
          const response = await apiClient.syncPrompts(promptShortcuts);
          if (!response.success) {
            console.error('Failed to sync prompt shortcuts:', response.error);
          }
        } catch (error) {
          console.debug('Backend unavailable, using local storage only');
        }
      }
    } catch (error) {
      console.error('Failed to auto-save settings:', error);
    }
  };

  const addExcludedSite = async () => {
    const site = prompt('Enter site URL to exclude (e.g., example.com or www.example.com):');
    if (site && !excludedSites.includes(site)) {
      // Add to local state
      const newExcludedSites = [...excludedSites, site];
      setExcludedSites(newExcludedSites);

      // Add to local database
      await addSiteFilter(site, 'exclude');

      // Update chrome.storage for compatibility
      await chrome.storage.local.set({ excludedSites: newExcludedSites });
    }
  };

  const removeExcludedSite = async (index: number) => {
    const newSites = [...excludedSites];
    const removedSite = newSites.splice(index, 1)[0];
    setExcludedSites(newSites);

    // Remove from local database
    const allFilters = await getSiteFilters('exclude');
    const filterToRemove = allFilters.find(f => f.urlPattern === removedSite);
    if (filterToRemove) {
      await removeSiteFilter(filterToRemove.id!);
    }

    // Update chrome.storage for compatibility
    await chrome.storage.local.set({ excludedSites: newSites });
  };

  const addWhitelistedSite = async () => {
    const site = prompt('Enter site URL to whitelist (e.g., example.com or www.example.com):');
    if (site && !whitelistedSites.includes(site)) {
      // Add to local state
      const newWhitelistedSites = [...whitelistedSites, site];
      setWhitelistedSites(newWhitelistedSites);

      // Add to local database
      await addSiteFilter(site, 'whitelist');

      // Update chrome.storage for compatibility
      await chrome.storage.local.set({ whitelistedSites: newWhitelistedSites });
    }
  };

  const removeWhitelistedSite = async (index: number) => {
    const newSites = [...whitelistedSites];
    const removedSite = newSites.splice(index, 1)[0];
    setWhitelistedSites(newSites);

    // Remove from local database
    const allFilters = await getSiteFilters('whitelist');
    const filterToRemove = allFilters.find(f => f.urlPattern === removedSite);
    if (filterToRemove) {
      await removeSiteFilter(filterToRemove.id!);
    }

    // Update chrome.storage for compatibility
    await chrome.storage.local.set({ whitelistedSites: newSites });
  };

  const addNewPrompt = async () => {
    if (newPrompt.name && newPrompt.content && apiClient) {
      const prompt: PromptShortcut = {
        id: `prompt_${Date.now()}`,
        name: newPrompt.name,
        content: newPrompt.content,
        category: newPrompt.category || 'General',
        shortcutKey: newPrompt.shortcutKey || undefined,
        createdAt: Date.now()
      };
      await savePromptShortcutToAPI(prompt);
      setNewPrompt({ name: '', content: '', category: '', shortcutKey: '' });
    }
  };

  const savePromptShortcutToAPI = async (prompt: PromptShortcut) => {
    if (!apiClient) {
      console.error('API client not initialized');
      return;
    }

    try {
      // Add the new prompt to the current list
      const updatedPrompts = [...promptShortcuts, prompt];

      // Sync all prompts to the API
      const response = await apiClient.syncPrompts(updatedPrompts);
      if (response.success) {
        // Refresh the list from the API response to ensure consistency
        const syncResponse = await apiClient.getSyncedData();
        if (syncResponse.success && syncResponse.data?.prompts) {
          setPromptShortcuts(syncResponse.data.prompts);

          // Also sync to chrome.storage.local for content script access
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
              await chrome.storage.local.set({ promptShortcuts: syncResponse.data.prompts });
            } catch (error) {
              console.warn('Could not sync prompt shortcuts to chrome.storage.local:', error);
            }
          }
        }
      } else {
        console.error('Failed to sync prompt shortcut:', response.error);
      }
    } catch (error) {
      console.debug('Backend unavailable, using local storage only');
    }
  };

  const deletePromptShortcutFromAPI = async (promptId: string) => {
    if (!apiClient) {
      console.error('API client not initialized');
      return;
    }

    if (window.confirm('Are you sure you want to delete this prompt shortcut?')) {
      try {
        // Remove the prompt from the current list
        const updatedPrompts = promptShortcuts.filter(prompt => prompt.id !== promptId);

        // Sync all prompts to the API
        const response = await apiClient.syncPrompts(updatedPrompts);
        if (response.success) {
          // Refresh the list from the API response to ensure consistency
          const syncResponse = await apiClient.getSyncedData();
          if (syncResponse.success && syncResponse.data?.prompts) {
            setPromptShortcuts(syncResponse.data.prompts);

            // Also sync to chrome.storage.local for content script access
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              try {
                await chrome.storage.local.set({ promptShortcuts: syncResponse.data.prompts });
              } catch (error) {
                console.warn('Could not sync prompt shortcuts to chrome.storage.local:', error);
              }
            }
          }
        } else {
          console.error('Failed to sync prompt shortcuts after deletion:', response.error);
        }
      } catch (error) {
        console.debug('Backend unavailable, using local storage only');
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
          <h3>Command Settings</h3>
        </div>

        <div className="settings-section">
          <h3>Mode Toggle Keys</h3>
          <div className="form-group">
            <label>Text Selection (Shift + Key)</label>
            <input
              type="text"
              value={textSelectionKey}
              onChange={(e) => setTextSelectionKey(e.target.value)}
              className="form-control"
              placeholder="e.g., 1"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle text selection mode (default: 1)</small>
          </div>
          <div className="form-group">
            <label>Page Context (Shift + Key)</label>
            <input
              type="text"
              value={pageContextKey}
              onChange={(e) => setPageContextKey(e.target.value)}
              className="form-control"
              placeholder="e.g., 2"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle page context mode (default: 2)</small>
          </div>
          <div className="form-group">
            <label>Page Screenshot (Shift + Key)</label>
            <input
              type="text"
              value={pageScreenshotKey}
              onChange={(e) => setPageScreenshotKey(e.target.value)}
              className="form-control"
              placeholder="e.g., 3"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle page screenshot mode (default: 3)</small>
          </div>
          <div className="form-group">
            <label>Clipboard (Shift + Key)</label>
            <input
              type="text"
              value={clipboardKey}
              onChange={(e) => setClipboardKey(e.target.value)}
              className="form-control"
              placeholder="e.g., 4"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle clipboard mode (default: 4)</small>
          </div>
          <div className="form-group">
            <label>Page Info (Shift + Key)</label>
            <input
              type="text"
              value={pageInfoKey}
              onChange={(e) => setPageInfoKey(e.target.value)}
              className="form-control"
              placeholder="e.g., 5"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle page info mode (default: 5)</small>
          </div>
        </div>

        <div className="settings-section">
          <h3>Iframe Toggle Key</h3>
          <div className="form-group">
            <label>Iframe Toggle (Ctrl + Key)</label>
            <input
              type="text"
              value={iframeToggleKey}
              onChange={(e) => setIframeToggleKey(e.target.value)}
              className="form-control"
              placeholder="e.g., ` (backtick)"
              maxLength={1}
            />
            <small className="form-hint">Key to toggle iframe show/hide (default: backtick `)</small>
          </div>
        </div>

        <div className="settings-section">
          <h3>System Prompt</h3>
          <div className="form-group">
            <label>System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="form-control"
              placeholder="Enter a system prompt that will be applied to all conversations (e.g., 'You are a helpful assistant')"
              rows={4}
            />
            <small className="form-hint">This prompt will be applied to all conversations as a system message. Leave blank to disable.</small>
          </div>
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
          <h3>Floating Button Settings</h3>
          <div className="form-group">
            <label>Button Top Position (px)</label>
            <input
              type="number"
              value={buttonPositionTop}
              onChange={(e) => setButtonPositionTop(Number(e.target.value))}
              min="0"
              max="100"
              className="form-control"
            />
            <small className="form-hint">Distance from the top of the screen in pixels</small>
          </div>

          <div className="form-group">
            <label>Button Right Position (px)</label>
            <input
              type="number"
              value={buttonPositionRight}
              onChange={(e) => setButtonPositionRight(Number(e.target.value))}
              min="0"
              max="100"
              className="form-control"
            />
            <small className="form-hint">Distance from the right of the screen in pixels</small>
          </div>

          <div className="form-group">
            <label>Sensitivity Area Percentage</label>
            <input
              type="number"
              value={buttonSensitivityAreaPercentage}
              onChange={(e) => setButtonSensitivityAreaPercentage(Number(e.target.value))}
              min="1"
              max="50"
              className="form-control"
            />
            <small className="form-hint">Percentage of screen width/height that triggers button visibility when mouse enters (default: 10%)</small>
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
                      onClick={() => deletePromptShortcutFromAPI(prompt.id)}
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