import { useState, useCallback } from 'react';
import type {
  AIConfig,
  AIProvider,
  AIMode,
  AICapability,
  LocalSearchProvider,
  HardwareProfile,
} from '@prism/shared-types';

interface SettingsState {
  aiConfig: AIConfig;
  adapterMode: AIMode;
  capabilityModes: Partial<Record<AICapability, AIMode>>;
  /** Default tool permission for the TUI agent runtime. */
  defaultToolPermission?: 'allow' | 'deny' | 'ask';
  availableProviders: AIProvider[];
  localApiUrl: string;
  localSearchProvider: LocalSearchProvider;
  searxngUrl: string;
  showSettings: boolean;
  /** Hardware profile for local inference. */
  hardware?: HardwareProfile;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    aiConfig: {
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      providerKeys: { openai: '' },
    },
    adapterMode: 'api',
    capabilityModes: {},
    availableProviders: ['openai', 'gemini', 'qwen', 'prism-api'],
    localApiUrl: 'http://localhost:8080',
    localSearchProvider: 'duckduckgo',
    searxngUrl: 'http://localhost:8888',
    showSettings: false,
    hardware: { preferredCompute: 'auto' },
  });

  const setProvider = useCallback((provider: AIProvider) => {
    setState((prev) => ({
      ...prev,
      aiConfig: { ...prev.aiConfig, provider },
    }));
  }, []);

  const setApiKey = useCallback((provider: string, key: string) => {
    setState((prev) => ({
      ...prev,
      aiConfig: {
        ...prev.aiConfig,
        providerKeys: { ...prev.aiConfig.providerKeys, [provider]: key },
      },
    }));
  }, []);

  const setAdapterMode = useCallback((mode: AIMode) => {
    setState((prev) => ({ ...prev, adapterMode: mode }));
  }, []);

  const setCapabilityMode = useCallback(
    (capability: AICapability, mode: AIMode) => {
      setState((prev) => ({
        ...prev,
        capabilityModes: { ...prev.capabilityModes, [capability]: mode },
      }));
    },
    [],
  );

  const setLocalApiUrl = useCallback((url: string) => {
    setState((prev) => ({ ...prev, localApiUrl: url }));
  }, []);

  const setDefaultToolPermission = useCallback(
    (level: 'allow' | 'deny' | 'ask') => {
      setState((prev) => ({ ...prev, defaultToolPermission: level }));
    },
    [],
  );

  const setLocalSearchProvider = useCallback(
    (provider: LocalSearchProvider) => {
      setState((prev) => ({ ...prev, localSearchProvider: provider }));
    },
    [],
  );

  const setSearxngUrl = useCallback((url: string) => {
    setState((prev) => ({ ...prev, searxngUrl: url }));
  }, []);

  const toggleSettings = useCallback(() => {
    setState((prev) => ({ ...prev, showSettings: !prev.showSettings }));
  }, []);

  const setShowSettings = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showSettings: show }));
  }, []);

  const setModel = useCallback((model: string) => {
    setState((prev) => ({
      ...prev,
      aiConfig: { ...prev.aiConfig, model },
    }));
  }, []);

  const setHardware = useCallback((hardware: HardwareProfile) => {
    setState((prev) => ({
      ...prev,
      hardware,
    }));
  }, []);

  return {
    ...state,
    setProvider,
    setApiKey,
    setAdapterMode,
    setCapabilityMode,
    setLocalApiUrl,
    setLocalSearchProvider,
    setSearxngUrl,
    toggleSettings,
    setShowSettings,
    setModel,
    setDefaultToolPermission,
    setHardware,
  };
}
