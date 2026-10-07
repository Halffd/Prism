import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AIConfigState } from './types';
import type { AIConfig, AIMode, AICapability } from '@prism/shared-types';

declare const window: any;

const initialState: AIConfigState = {
  config: {
    provider: 'prism-api',
    apiUrl: typeof window !== 'undefined' && typeof window.document !== 'undefined'
      ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api')
      : 'http://localhost:3000/api',
  },
  availableModels: [],
  fetchingModels: false,
};

export const aiConfigSlice = createSlice({
  name: 'aiConfig',
  initialState,
  reducers: {
    setAIConfig: (state, action: PayloadAction<AIConfig>) => {
      state.config = action.payload;
    },
    updateAIConfig: (state, action: PayloadAction<Partial<AIConfig>>) => {
      state.config = { ...state.config, ...action.payload };
    },
    setAvailableModels: (state, action: PayloadAction<string[]>) => {
      state.availableModels = action.payload;
    },
    setFetchingModels: (state, action: PayloadAction<boolean>) => {
      state.fetchingModels = action.payload;
    },
    setSelectedProvider: (state, action: PayloadAction<AIConfig['provider']>) => {
      state.config.provider = action.payload;
    },
    setProviderKey: (state, action: PayloadAction<{ provider: string; key: string }>) => {
      if (!state.config.providerKeys) {
        state.config.providerKeys = {};
      }
      state.config.providerKeys[action.payload.provider as keyof typeof state.config.providerKeys] = action.payload.key;
    },
    setAdapterMode: (state, action: PayloadAction<AIMode>) => {
      state.config.mode = action.payload;
    },
    setCapabilityMode: (state, action: PayloadAction<{ capability: AICapability; mode: AIMode }>) => {
      if (!state.config.capabilityModes) {
        state.config.capabilityModes = {};
      }
      state.config.capabilityModes[action.payload.capability] = action.payload.mode;
    },
  },
});

export const {
  setAIConfig,
  updateAIConfig,
  setAvailableModels,
  setFetchingModels,
  setSelectedProvider: setAIProvider,
  setProviderKey,
  setAdapterMode,
  setCapabilityMode,
} = aiConfigSlice.actions;

export default aiConfigSlice.reducer;