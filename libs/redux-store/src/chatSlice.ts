import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ChatState } from './types';
import type { Message, AIConfig } from '@prism/shared-types';

const initialState: ChatState = {
  messages: [],
  currentSessionId: `session_${Date.now()}`,
  sessions: [],
  loading: false,
  selectedProvider: 'prism-api',
};

export const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload);
    },
    updateMessage: (state, action: PayloadAction<{ id: string; message: Partial<Message> }>) => {
      const { id, message } = action.payload;
      const existingMessage = state.messages.find(msg => msg.id === id);
      if (existingMessage) {
        Object.assign(existingMessage, message);
      }
    },
    clearMessages: (state) => {
      state.messages = [];
    },
    setCurrentSessionId: (state, action: PayloadAction<string>) => {
      state.currentSessionId = action.payload;
    },
    setSessions: (state, action: PayloadAction<any[]>) => {
      state.sessions = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setSelectedProvider: (state, action: PayloadAction<AIConfig['provider']>) => {
      state.selectedProvider = action.payload;
    },
    updateSession: (state, action: PayloadAction<{ sessionId: string; updates: Partial<any> }>) => {
      const { sessionId, updates } = action.payload;
      const session = state.sessions.find(s => s.id === sessionId);
      if (session) {
        Object.assign(session, updates);
      }
    },
    removeSession: (state, action: PayloadAction<string>) => {
      state.sessions = state.sessions.filter(s => s.id !== action.payload);
    },
  },
});

export const {
  setMessages,
  addMessage,
  updateMessage,
  clearMessages,
  setCurrentSessionId,
  setSessions,
  setLoading,
  setSelectedProvider,
  updateSession,
  removeSession,
} = chatSlice.actions;

export default chatSlice.reducer;