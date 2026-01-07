import { configureStore } from '@reduxjs/toolkit';
import chatReducer from './chatSlice';
import aiConfigReducer from './aiConfigSlice';
import contextReducer from './contextSlice';

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    aiConfig: aiConfigReducer,
    context: contextReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'], // If we add persistence later
      },
    }),
  devTools: {
    // Enable Redux DevTools in development
    enabled: process.env.NODE_ENV !== 'production',
    // Additional devtools configuration can go here
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Export actions for use in components
export {
  // Chat actions
  setMessages,
  addMessage,
  updateMessage,
  clearMessages,
  setCurrentSessionId,
  setSessions,
  setLoading,
  setSelectedProvider,
  updateSession,
  removeSession
} from './chatSlice';

export {
  setAIConfig,
  updateAIConfig,
  setAvailableModels,
  setFetchingModels,
  setAIProvider,
  setProviderKey
} from './aiConfigSlice';

export {
  setContext,
  updateContext,
  clearContext
} from './contextSlice';