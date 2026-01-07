import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ContextState } from './types';
import type { ContextData } from '@prism/shared-types';

const initialState: ContextState = {
  context: null,
};

export const contextSlice = createSlice({
  name: 'context',
  initialState,
  reducers: {
    setContext: (state, action: PayloadAction<ContextData | null>) => {
      state.context = action.payload;
    },
    updateContext: (state, action: PayloadAction<Partial<ContextData>>) => {
      if (state.context) {
        Object.assign(state.context, action.payload);
      } else {
        state.context = action.payload as ContextData;
      }
    },
    clearContext: (state) => {
      state.context = null;
    },
  },
});

export const {
  setContext,
  updateContext,
  clearContext,
} = contextSlice.actions;

export default contextSlice.reducer;