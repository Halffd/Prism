import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { PromptPreset, PromptEntry } from '@prism/shared-types';

export interface PresetState {
  presets: PromptPreset[];
  activePresetId: string | null;
  isLoading: boolean;
}

const initialState: PresetState = {
  presets: [],
  activePresetId: null,
  isLoading: false,
};

export const presetSlice = createSlice({
  name: 'presets',
  initialState,
  reducers: {
    setPresets: (state, action: PayloadAction<PromptPreset[]>) => {
      state.presets = action.payload;
    },
    addPreset: (state, action: PayloadAction<PromptPreset>) => {
      state.presets.unshift(action.payload);
    },
    updatePreset: (state, action: PayloadAction<{ id: string; updates: Partial<PromptPreset> }>) => {
      const idx = state.presets.findIndex(p => p.id === action.payload.id);
      if (idx !== -1) {
        state.presets[idx] = { ...state.presets[idx], ...action.payload.updates };
      }
    },
    removePreset: (state, action: PayloadAction<string>) => {
      state.presets = state.presets.filter(p => p.id !== action.payload);
      if (state.activePresetId === action.payload) {
        state.activePresetId = null;
      }
    },
    setActivePreset: (state, action: PayloadAction<string | null>) => {
      state.activePresetId = action.payload;
    },
    setPresetsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    addPromptEntry: (state, action: PayloadAction<{ presetId: string; entry: PromptEntry }>) => {
      const preset = state.presets.find(p => p.id === action.payload.presetId);
      if (preset) {
        preset.prompts.push(action.payload.entry);
      }
    },
    updatePromptEntry: (state, action: PayloadAction<{ presetId: string; entryId: string; updates: Partial<PromptEntry> }>) => {
      const preset = state.presets.find(p => p.id === action.payload.presetId);
      if (preset) {
        const idx = preset.prompts.findIndex(e => e.id === action.payload.entryId);
        if (idx !== -1) {
          preset.prompts[idx] = { ...preset.prompts[idx], ...action.payload.updates };
        }
      }
    },
    removePromptEntry: (state, action: PayloadAction<{ presetId: string; entryId: string }>) => {
      const preset = state.presets.find(p => p.id === action.payload.presetId);
      if (preset) {
        preset.prompts = preset.prompts.filter(e => e.id !== action.payload.entryId);
      }
    },
  },
});

export const {
  setPresets,
  addPreset,
  updatePreset,
  removePreset,
  setActivePreset,
  setPresetsLoading,
  addPromptEntry,
  updatePromptEntry,
  removePromptEntry,
} = presetSlice.actions;

export default presetSlice.reducer;
