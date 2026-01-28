// Redux Store Library for Prism
// Export store and types
export {
  store,
  persistor,
  type RootState,
  type AppDispatch,
  // Export action creators from store.ts (avoiding duplicates with slices)
  addMessage,
  setMessages,
  updateMessage,
  deleteMessage,
  setCurrentSession,
  setSessions,
  addSession,
  deleteSession,
  setLoading,
  setContext,
  clearHistory,
  setAIConfig,
  updateAIConfig,
  setAvailableModels,
  setFetchingModels,
  setDisplayMode,
  setFontSize,
  setChatOpen,
  setShowPrompts,
  setShowMenu,
  increaseFontSize,
  decreaseFontSize,
  setDisplaySettings,
  setSystemPrompt,
  setPromptShortcuts,
  addPromptShortcut,
  updatePromptShortcut,
  deletePromptShortcut,
  setPromptsLoading,
  setOnlineStatus,
  setLastSync
} from './store';
export * from './types';

// Export slice reducers and actions separately to avoid conflicts
export { default as chatReducer } from './chatSlice';
export { default as aiConfigReducer } from './aiConfigSlice';
export { default as contextReducer } from './contextSlice';

// Export individual slice actions if needed separately
export {
  setCurrentSessionId,
  setSelectedProvider as setChatSelectedProvider,
  updateMessage as updateChatMessage,
  clearMessages as clearChatMessages
} from './chatSlice';
export {
  setSelectedProvider as setAIProvider,
  setProviderKey
} from './aiConfigSlice';
export {
  updateContext,
  clearContext
} from './contextSlice';