import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  AIConfig,
  AIProvider,
  AIMode,
  AICapability,
  LocalSearchProvider,
  HardwareProfile,
} from '@prism/shared-types';
import {
  loadPersisted,
  savePersisted,
  toPersisted,
} from '../lib/settings-store';

/** Debounce window for writes so rapid setting changes coalesce. */
const SAVE_DEBOUNCE_MS = 250;

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
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>(() => {
    const persisted = loadPersisted();
    return {
      aiConfig: persisted.aiConfig,
      adapterMode: persisted.adapterMode,
      capabilityModes: persisted.capabilityModes,
      defaultToolPermission: persisted.defaultToolPermission,
      availableProviders: ['openai', 'gemini', 'qwen', 'prism-api'],
      localApiUrl: persisted.localApiUrl,
      localSearchProvider: persisted.localSearchProvider,
      searxngUrl: persisted.searxngUrl,
      showSettings: false,
    };
  });

  // Persist the file-backed subset whenever its content changes. The
  // serialized form is the effect dependency, so UI-only toggles
  // (showSettings) do not trigger writes.
  const persistedJson = useMemo(
    () => JSON.stringify(toPersisted(state)),
    [state],
  );
  const lastSeenRef = useRef<string>('');
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastSeenRef.current) {
      // First mount: content came from disk (or defaults), nothing to save.
      lastSeenRef.current = persistedJson;
      return;
    }
    if (persistedJson === lastSeenRef.current) {
      return;
    }
    lastSeenRef.current = persistedJson;
    pendingRef.current = persistedJson;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const json = pendingRef.current;
      pendingRef.current = null;
      if (!json) {
        return;
      }
      try {
        savePersisted(JSON.parse(json));
      } catch {
        // Disk errors (read-only home, full disk) must not crash the TUI.
      }
    }, SAVE_DEBOUNCE_MS);
  }, [persistedJson]);

  // Flush a pending debounced write when the TUI unmounts (exit).
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const json = pendingRef.current;
      if (json) {
        try {
          savePersisted(JSON.parse(json));
        } catch {
          // Ignore: same disk-error policy as above.
        }
      }
    },
    [],
  );

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
      aiConfig: { ...prev.aiConfig, hardware },
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
