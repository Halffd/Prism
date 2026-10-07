import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { WorldInfo, WorldInfoEntry } from '@prism/shared-types';

export interface WorldInfoState {
  worldInfoList: WorldInfo[];
  activeWorldInfoId: string | null;
  entries: Record<string, WorldInfoEntry[]>;
  isLoading: boolean;
}

const initialState: WorldInfoState = {
  worldInfoList: [],
  activeWorldInfoId: null,
  entries: {},
  isLoading: false,
};

export const worldInfoSlice = createSlice({
  name: 'worldInfo',
  initialState,
  reducers: {
    setWorldInfoList: (state, action: PayloadAction<WorldInfo[]>) => {
      state.worldInfoList = action.payload;
    },
    addWorldInfo: (state, action: PayloadAction<WorldInfo>) => {
      state.worldInfoList.unshift(action.payload);
    },
    updateWorldInfo: (state, action: PayloadAction<{ id: string; updates: Partial<WorldInfo> }>) => {
      const idx = state.worldInfoList.findIndex(w => w.id === action.payload.id);
      if (idx !== -1) {
        state.worldInfoList[idx] = { ...state.worldInfoList[idx], ...action.payload.updates };
      }
    },
    removeWorldInfo: (state, action: PayloadAction<string>) => {
      state.worldInfoList = state.worldInfoList.filter(w => w.id !== action.payload);
      delete state.entries[action.payload];
      if (state.activeWorldInfoId === action.payload) {
        state.activeWorldInfoId = null;
      }
    },
    setActiveWorldInfo: (state, action: PayloadAction<string | null>) => {
      state.activeWorldInfoId = action.payload;
    },
    setWorldInfoLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setEntries: (state, action: PayloadAction<{ worldInfoId: string; entries: WorldInfoEntry[] }>) => {
      state.entries[action.payload.worldInfoId] = action.payload.entries;
    },
    addEntry: (state, action: PayloadAction<WorldInfoEntry>) => {
      const wiId = action.payload.worldInfoId;
      if (!state.entries[wiId]) {
        state.entries[wiId] = [];
      }
      state.entries[wiId].push(action.payload);
    },
    updateEntry: (state, action: PayloadAction<{ id: string; worldInfoId: string; updates: Partial<WorldInfoEntry> }>) => {
      const entries = state.entries[action.payload.worldInfoId];
      if (entries) {
        const idx = entries.findIndex(e => e.id === action.payload.id);
        if (idx !== -1) {
          entries[idx] = { ...entries[idx], ...action.payload.updates };
        }
      }
    },
    removeEntry: (state, action: PayloadAction<{ id: string; worldInfoId: string }>) => {
      const entries = state.entries[action.payload.worldInfoId];
      if (entries) {
        state.entries[action.payload.worldInfoId] = entries.filter(e => e.id !== action.payload.id);
      }
    },
  },
});

export const {
  setWorldInfoList,
  addWorldInfo,
  updateWorldInfo,
  removeWorldInfo,
  setActiveWorldInfo,
  setWorldInfoLoading,
  setEntries,
  addEntry,
  updateEntry,
  removeEntry,
} = worldInfoSlice.actions;

export default worldInfoSlice.reducer;
