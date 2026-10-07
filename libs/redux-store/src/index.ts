// Redux Store Library for Prism
// Export store and types
export {
  store,
  persistor,
  type RootState,
  type AppDispatch,
  useAppDispatch,
  useAppSelector,
  setMessages,
  addMessage,
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
  setLastSync,
  // Group chat action creators
  setGroupChatActive,
  setSpeakingCharacter,
  setPendingCharacters,
  setAddressedCharacters,
  clearPendingCharacters,
  resetGroupChatState,
} from './store';
export * from './types';

// Export slice reducers and actions separately to avoid conflicts
export { default as chatReducer } from './chatSlice';
export { default as aiConfigReducer } from './aiConfigSlice';
export { default as contextReducer } from './contextSlice';
export { default as characterReducer } from './characterSlice';
export { default as personaReducer } from './personaSlice';
export { default as presetReducer } from './presetSlice';
export { default as worldInfoReducer } from './worldInfoSlice';
export { default as agentReducer } from './agentSlice';

// Export individual slice actions if needed separately
export {
  setCurrentSessionId,
  setSelectedProvider as setChatSelectedProvider,
  updateMessage as updateChatMessage,
  clearMessages as clearChatMessages,
  pushToHistory,
  undo,
  redo,
  clearHistory as clearChatHistory,
  forkSession,
  initForm,
  updateField,
  setFieldError,
  setFormSubmitting,
  resetForm,
  touchField,
} from './chatSlice';

// Export SillyTavern-style slice actions
export {
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
} from './characterSlice';

export {
  setPersonas,
  addPersona,
  updatePersona,
  removePersona,
  setActivePersona,
  setPersonasLoading,
} from './personaSlice';

export {
  setPresets,
  addPreset,
  updatePreset,
  removePreset,
  setActivePreset,
  setPresetsLoading,
  addPromptEntry,
  updatePromptEntry,
  removePromptEntry,
} from './presetSlice';

export {
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
} from './worldInfoSlice';

export {
  setAgents,
  addAgent,
  updateAgent,
  removeAgent,
  setActiveAgent,
  setAgentsLoading,
  setEditingAgent,
  addToolToEditing,
  updateToolInEditing,
  removeToolFromEditing,
} from './agentSlice';

// Export hooks
export { useChatForm } from './hooks/useChatForm';
export { useUndoRedo } from './hooks/useUndoRedo';
export { useForkChat } from './hooks/useForkChat';
