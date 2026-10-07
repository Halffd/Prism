import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CharacterCard, GroupChatMode } from '@prism/shared-types';

export interface CharacterState {
  characters: CharacterCard[];
  activeCharacterId: string | null;
  activeCharacterIds: string[]; // Multiple active characters for group chat
  groupChatMode: GroupChatMode | null; // null = single character mode
  groupChatTurnOrder: string[]; // Character IDs in round-robin order
  groupChatCurrentTurnIndex: number; // Current position in turn order
  isLoading: boolean;
}

const initialState: CharacterState = {
  characters: [],
  activeCharacterId: null,
  activeCharacterIds: [],
  groupChatMode: null,
  groupChatTurnOrder: [],
  groupChatCurrentTurnIndex: 0,
  isLoading: false,
};

export const characterSlice = createSlice({
  name: 'characters',
  initialState,
  reducers: {
    setCharacters: (state, action: PayloadAction<CharacterCard[]>) => {
      state.characters = action.payload;
    },
    addCharacter: (state, action: PayloadAction<CharacterCard>) => {
      state.characters.unshift(action.payload);
    },
    updateCharacter: (state, action: PayloadAction<{ id: string; updates: Partial<CharacterCard> }>) => {
      const idx = state.characters.findIndex(c => c.id === action.payload.id);
      if (idx !== -1) {
        state.characters[idx] = { ...state.characters[idx], ...action.payload.updates };
      }
    },
    removeCharacter: (state, action: PayloadAction<string>) => {
      state.characters = state.characters.filter(c => c.id !== action.payload);
      if (state.activeCharacterId === action.payload) {
        state.activeCharacterId = null;
      }
      // Also remove from group chat arrays
      state.activeCharacterIds = state.activeCharacterIds.filter(id => id !== action.payload);
      state.groupChatTurnOrder = state.groupChatTurnOrder.filter(id => id !== action.payload);
    },
    setActiveCharacter: (state, action: PayloadAction<string | null>) => {
      state.activeCharacterId = action.payload;
      // When setting a single active character, exit group chat mode
      if (action.payload !== null) {
        state.activeCharacterIds = [action.payload];
        state.groupChatMode = null;
      } else {
        state.activeCharacterIds = [];
        state.groupChatMode = null;
      }
    },
    setCharactersLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    // Group chat reducers
    setActiveCharacterIds: (state, action: PayloadAction<string[]>) => {
      state.activeCharacterIds = action.payload;
      // If only one character, treat as single mode
      if (action.payload.length <= 1) {
        state.activeCharacterId = action.payload[0] ?? null;
        state.groupChatMode = null;
      }
    },
    toggleCharacterInGroup: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      if (state.activeCharacterIds.includes(id)) {
        state.activeCharacterIds = state.activeCharacterIds.filter(cid => cid !== id);
        state.groupChatTurnOrder = state.groupChatTurnOrder.filter(cid => cid !== id);
        if (state.activeCharacterIds.length === 0) {
          state.groupChatMode = null;
          state.activeCharacterId = null;
        } else if (state.activeCharacterIds.length === 1) {
          state.activeCharacterId = state.activeCharacterIds[0];
          state.groupChatMode = null;
        }
      } else {
        state.activeCharacterIds.push(id);
        state.groupChatTurnOrder.push(id);
      }
    },
    setGroupChatMode: (state, action: PayloadAction<GroupChatMode | null>) => {
      state.groupChatMode = action.payload;
      if (action.payload && state.activeCharacterIds.length > 1) {
        // Initialize turn order from activeCharacterIds if not already set
        if (state.groupChatTurnOrder.length === 0) {
          state.groupChatTurnOrder = [...state.activeCharacterIds];
        }
        state.groupChatCurrentTurnIndex = 0;
      }
    },
    setGroupChatTurnOrder: (state, action: PayloadAction<string[]>) => {
      state.groupChatTurnOrder = action.payload;
      state.groupChatCurrentTurnIndex = 0;
    },
    advanceGroupChatTurn: (state) => {
      if (state.groupChatTurnOrder.length > 0) {
        state.groupChatCurrentTurnIndex = (state.groupChatCurrentTurnIndex + 1) % state.groupChatTurnOrder.length;
      }
    },
    resetGroupChatTurn: (state) => {
      state.groupChatCurrentTurnIndex = 0;
    },
  },
});

export const {
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  setActiveCharacter,
  setCharactersLoading,
  setActiveCharacterIds,
  toggleCharacterInGroup,
  setGroupChatMode,
  setGroupChatTurnOrder,
  advanceGroupChatTurn,
  resetGroupChatTurn,
} = characterSlice.actions;

export default characterSlice.reducer;
