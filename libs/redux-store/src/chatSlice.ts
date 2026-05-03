import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ChatState } from './types';
import type { Message, AIConfig, FormField } from '@prism/shared-types';

const initialState: ChatState = {
  messages: [],
  currentSessionId: `session_${Date.now()}`,
  sessions: [],
  loading: false,
  selectedProvider: 'prism-api',
  history: {
    past: [],
    present: [],
    future: [],
  },
  forms: {},
};

export const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.history.past.push(state.history.present);
      state.history.present = action.payload;
      state.history.future = [];
      state.messages = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      const newMessages = [...state.messages, action.payload];
      state.history.past.push(state.history.present);
      state.history.present = newMessages;
      state.history.future = [];
      state.messages.push(action.payload);
    },
    updateMessage: (state, action: PayloadAction<{ id: string; message: Partial<Message> }>) => {
      const { id, message } = action.payload;
      const existingMessage = state.messages.find(msg => msg.id === id);
      if (existingMessage) {
        const newMessages = state.messages.map(msg =>
          msg.id === id ? { ...msg, ...message } : msg
        );
        state.history.past.push(state.history.present);
        state.history.present = newMessages;
        state.history.future = [];
        Object.assign(existingMessage, message);
      }
    },
    clearMessages: (state) => {
      state.history.past.push(state.history.present);
      state.history.present = [];
      state.history.future = [];
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
    // Undo/Redo actions
    pushToHistory: (state, action: PayloadAction<Message[]>) => {
      state.history.past.push(state.history.present);
      state.history.present = action.payload;
      state.history.future = [];
    },
    undo: (state) => {
      if (state.history.past.length === 0) return;
      const previous = state.history.past.pop()!;
      state.history.future.unshift(state.history.present);
      state.history.present = previous;
      state.messages = previous;
    },
    redo: (state) => {
      if (state.history.future.length === 0) return;
      const next = state.history.future.shift()!;
      state.history.past.push(state.history.present);
      state.history.present = next;
      state.messages = next;
    },
    clearHistory: (state) => {
      state.history = { past: [], present: [], future: [] };
    },
    // Fork action
    forkSession: (state, action: PayloadAction<{ messageId: string; newSessionId: string }>) => {
      const { messageId, newSessionId } = action.payload;
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return;
      const forkedMessages = state.messages.slice(0, messageIndex + 1);
      const newSession = {
        id: newSessionId,
        userId: state.sessions.find(s => s.id === state.currentSessionId)?.userId || 'unknown',
        messages: forkedMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        parentSessionId: state.currentSessionId,
        forkedFromMessageId: messageId,
      };
      state.sessions.push(newSession);
      state.currentSessionId = newSessionId;
      state.messages = forkedMessages;
      state.history.present = forkedMessages;
    },
    // Form actions
    initForm: (state, action: PayloadAction<{ formId: string; fields: Record<string, unknown> }>) => {
      const { formId, fields } = action.payload;
      const fieldStates: Record<string, FormField> = {};
      Object.entries(fields).forEach(([name, value]) => {
        fieldStates[name] = {
          name,
          value,
          touched: false,
          dirty: false,
        };
      });
      state.forms[formId] = {
        fields: fieldStates,
        isValid: true,
        isSubmitting: false,
        submitCount: 0,
        errors: {},
      };
    },
    updateField: (state, action: PayloadAction<{ formId: string; name: string; value: unknown }>) => {
      const { formId, name, value } = action.payload;
      const form = state.forms[formId];
      if (!form) return;
      const field = form.fields[name];
      if (!field) return;
      field.value = value;
      field.dirty = true;
      field.touched = true;
    },
    setFieldError: (state, action: PayloadAction<{ formId: string; name: string; error: string }>) => {
      const { formId, name, error } = action.payload;
      const form = state.forms[formId];
      if (!form) return;
      if (error) {
        form.errors[name] = error;
        form.fields[name].error = error;
      } else {
        delete form.errors[name];
        delete form.fields[name].error;
      }
      form.isValid = Object.keys(form.errors).length === 0;
    },
    setFormSubmitting: (state, action: PayloadAction<{ formId: string; isSubmitting: boolean }>) => {
      const { formId, isSubmitting } = action.payload;
      const form = state.forms[formId];
      if (!form) return;
      form.isSubmitting = isSubmitting;
      if (isSubmitting) form.submitCount++;
    },
    resetForm: (state, action: PayloadAction<string>) => {
      const formId = action.payload;
      delete state.forms[formId];
    },
    touchField: (state, action: PayloadAction<{ formId: string; name: string }>) => {
      const { formId, name } = action.payload;
      const form = state.forms[formId];
      if (!form) return;
      if (form.fields[name]) form.fields[name].touched = true;
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
  pushToHistory,
  undo,
  redo,
  clearHistory,
  forkSession,
  initForm,
  updateField,
  setFieldError,
  setFormSubmitting,
  resetForm,
  touchField,
} = chatSlice.actions;

export default chatSlice.reducer;