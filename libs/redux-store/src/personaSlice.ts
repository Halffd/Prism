import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { PersonaProfile } from '@prism/shared-types';

export interface PersonaState {
  personas: PersonaProfile[];
  activePersonaId: string | null;
  isLoading: boolean;
}

const initialState: PersonaState = {
  personas: [],
  activePersonaId: null,
  isLoading: false,
};

export const personaSlice = createSlice({
  name: 'personas',
  initialState,
  reducers: {
    setPersonas: (state, action: PayloadAction<PersonaProfile[]>) => {
      state.personas = action.payload;
    },
    addPersona: (state, action: PayloadAction<PersonaProfile>) => {
      state.personas.unshift(action.payload);
    },
    updatePersona: (state, action: PayloadAction<{ id: string; updates: Partial<PersonaProfile> }>) => {
      const idx = state.personas.findIndex(p => p.id === action.payload.id);
      if (idx !== -1) {
        state.personas[idx] = { ...state.personas[idx], ...action.payload.updates };
      }
    },
    removePersona: (state, action: PayloadAction<string>) => {
      state.personas = state.personas.filter(p => p.id !== action.payload);
      if (state.activePersonaId === action.payload) {
        state.activePersonaId = null;
      }
    },
    setActivePersona: (state, action: PayloadAction<string | null>) => {
      state.activePersonaId = action.payload;
    },
    setPersonasLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const {
  setPersonas,
  addPersona,
  updatePersona,
  removePersona,
  setActivePersona,
  setPersonasLoading,
} = personaSlice.actions;

export default personaSlice.reducer;
