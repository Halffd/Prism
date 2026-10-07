import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { persistReducer, persistStore } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage for web
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type {
  Message,
  ChatSession,
  ContextData,
  AIConfig,
  PopupDisplayMode,
  ExtensionSettings,
  PromptShortcut,
} from '@prism/shared-types';
import chatReducer from './chatSlice';
import aiConfigReducer from './aiConfigSlice';
import contextReducer from './contextSlice';
import characterReducer from './characterSlice';
import personaReducer from './personaSlice';
import presetReducer from './presetSlice';
import worldInfoReducer from './worldInfoSlice';
import agentReducer from './agentSlice';
import type { ChatState, AIConfigState, ContextState } from './types';
import type { CharacterState } from './characterSlice';
import type { PersonaState } from './personaSlice';
import type { PresetState } from './presetSlice';
import type { WorldInfoState } from './worldInfoSlice';
import type { AgentState } from './agentSlice';

export interface RootState {
  chat: ChatState;
  aiConfig: AIConfigState;
  context: ContextState;
  ui: UIState;
  settings: SettingsState;
  prompts: PromptsState;
  network: NetworkState;
  characters: CharacterState;
  personas: PersonaState;
  presets: PresetState;
  worldInfo: WorldInfoState;
  agents: AgentState;
  groupChat: GroupChatState;
}

export interface UIState {
  displayMode: PopupDisplayMode;
  fontSize: number;
  isChatOpen: boolean;
  showPrompts: boolean;
  showMenu: boolean;
}

export interface SettingsState {
  displaySettings: ExtensionSettings;
  systemPrompt: string;
}

export interface PromptsState {
  shortcuts: PromptShortcut[];
  isLoading: boolean;
}

export interface NetworkState {
  isOnline: boolean;
  lastSync: number | null;
}

export interface GroupChatState {
  isGroupChatActive: boolean;
  speakingCharacterId: string | null;
  pendingCharacterIds: string[];
  addressedCharacterIds: string[];
}

// Action type constants for the plain (non-slice) reducers below.
export const UI_ACTIONS = {
  SET_DISPLAY_MODE: 'ui/SET_DISPLAY_MODE',
  SET_FONT_SIZE: 'ui/SET_FONT_SIZE',
  SET_CHAT_OPEN: 'ui/SET_CHAT_OPEN',
  SET_SHOW_PROMPTS: 'ui/SET_SHOW_PROMPTS',
  SET_SHOW_MENU: 'ui/SET_SHOW_MENU',
  INCREASE_FONT_SIZE: 'ui/INCREASE_FONT_SIZE',
  DECREASE_FONT_SIZE: 'ui/DECREASE_FONT_SIZE',
} as const;

export const SETTINGS_ACTIONS = {
  SET_DISPLAY_SETTINGS: 'settings/SET_DISPLAY_SETTINGS',
  SET_SYSTEM_PROMPT: 'settings/SET_SYSTEM_PROMPT',
} as const;

export const PROMPTS_ACTIONS = {
  SET_PROMPT_SHORTCUTS: 'prompts/SET_PROMPT_SHORTCUTS',
  ADD_PROMPT_SHORTCUT: 'prompts/ADD_PROMPT_SHORTCUT',
  UPDATE_PROMPT_SHORTCUT: 'prompts/UPDATE_PROMPT_SHORTCUT',
  DELETE_PROMPT_SHORTCUT: 'prompts/DELETE_PROMPT_SHORTCUT',
  SET_LOADING: 'prompts/SET_LOADING',
} as const;

export const NETWORK_ACTIONS = {
  SET_ONLINE_STATUS: 'network/SET_ONLINE_STATUS',
  SET_LAST_SYNC: 'network/SET_LAST_SYNC',
} as const;

export const GROUP_CHAT_ACTIONS = {
  SET_GROUP_CHAT_ACTIVE: 'groupChat/SET_GROUP_CHAT_ACTIVE',
  SET_SPEAKING_CHARACTER: 'groupChat/SET_SPEAKING_CHARACTER',
  SET_PENDING_CHARACTERS: 'groupChat/SET_PENDING_CHARACTERS',
  SET_ADDRESSED_CHARACTERS: 'groupChat/SET_ADDRESSED_CHARACTERS',
  CLEAR_PENDING_CHARACTERS: 'groupChat/CLEAR_PENDING_CHARACTERS',
  ADVANCE_SPEAKING_CHARACTER: 'groupChat/ADVANCE_SPEAKING_CHARACTER',
  RESET_GROUP_CHAT_STATE: 'groupChat/RESET_GROUP_CHAT_STATE',
} as const;

// Chat action creators (forwarded to the slice action types so the slice
// reducer handles them — redux-toolkit matches on action.type).
export const addMessage = (message: Message) => ({
  type: 'chat/addMessage' as const,
  payload: message,
});
export const setMessages = (messages: Message[]) => ({
  type: 'chat/setMessages' as const,
  payload: messages,
});
export const updateMessage = (id: string, updates: Partial<Message>) => ({
  type: 'chat/updateMessage' as const,
  payload: { id, message: updates },
});
export const deleteMessage = (id: string) => ({
  type: 'chat/deleteMessage' as const,
  payload: id,
});
export const setCurrentSession = (sessionId: string) => ({
  type: 'chat/setCurrentSessionId' as const,
  payload: sessionId,
});
export const setSessions = (sessions: ChatSession[]) => ({
  type: 'chat/setSessions' as const,
  payload: sessions,
});
export const addSession = (session: ChatSession) => ({
  type: 'chat/addSession' as const,
  payload: session,
});
export const deleteSession = (sessionId: string) => ({
  type: 'chat/deleteSession' as const,
  payload: sessionId,
});
export const setLoading = (isLoading: boolean) => ({
  type: 'chat/setLoading' as const,
  payload: isLoading,
});
export const setContext = (context: ContextData | null) => ({
  type: 'context/setContext' as const,
  payload: context,
});
export const clearHistory = () => ({ type: 'chat/clearHistory' as const });

// AI config action creators
export const setAIConfig = (config: AIConfig) => ({
  type: 'aiConfig/setAIConfig' as const,
  payload: config,
});
export const updateAIConfig = (config: Partial<AIConfig>) => ({
  type: 'aiConfig/updateAIConfig' as const,
  payload: config,
});
export const setAvailableModels = (models: string[]) => ({
  type: 'aiConfig/setAvailableModels' as const,
  payload: models,
});
export const setFetchingModels = (isFetching: boolean) => ({
  type: 'aiConfig/setFetchingModels' as const,
  payload: isFetching,
});

// UI action creators
export const setDisplayMode = (mode: PopupDisplayMode) => ({
  type: UI_ACTIONS.SET_DISPLAY_MODE as typeof UI_ACTIONS.SET_DISPLAY_MODE,
  payload: mode,
});
export const setFontSize = (size: number) => ({
  type: UI_ACTIONS.SET_FONT_SIZE as typeof UI_ACTIONS.SET_FONT_SIZE,
  payload: size,
});
export const setChatOpen = (isOpen: boolean) => ({
  type: UI_ACTIONS.SET_CHAT_OPEN as typeof UI_ACTIONS.SET_CHAT_OPEN,
  payload: isOpen,
});
export const setShowPrompts = (show: boolean) => ({
  type: UI_ACTIONS.SET_SHOW_PROMPTS as typeof UI_ACTIONS.SET_SHOW_PROMPTS,
  payload: show,
});
export const setShowMenu = (show: boolean) => ({
  type: UI_ACTIONS.SET_SHOW_MENU as typeof UI_ACTIONS.SET_SHOW_MENU,
  payload: show,
});
export const increaseFontSize = () => ({
  type: UI_ACTIONS.INCREASE_FONT_SIZE as typeof UI_ACTIONS.INCREASE_FONT_SIZE,
});
export const decreaseFontSize = () => ({
  type: UI_ACTIONS.DECREASE_FONT_SIZE as typeof UI_ACTIONS.DECREASE_FONT_SIZE,
});

// Settings action creators
export const setDisplaySettings = (settings: ExtensionSettings) => ({
  type: SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS as typeof SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS,
  payload: settings,
});
export const setSystemPrompt = (prompt: string) => ({
  type: SETTINGS_ACTIONS.SET_SYSTEM_PROMPT as typeof SETTINGS_ACTIONS.SET_SYSTEM_PROMPT,
  payload: prompt,
});

// Prompts action creators
export const setPromptShortcuts = (shortcuts: PromptShortcut[]) => ({
  type: PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS as typeof PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS,
  payload: shortcuts,
});
export const addPromptShortcut = (shortcut: PromptShortcut) => ({
  type: PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT,
  payload: shortcut,
});
export const updatePromptShortcut = (
  id: string,
  updates: Partial<PromptShortcut>,
) => ({
  type: PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT,
  payload: { id, updates },
});
export const deletePromptShortcut = (id: string) => ({
  type: PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT,
  payload: id,
});
export const setPromptsLoading = (isLoading: boolean) => ({
  type: PROMPTS_ACTIONS.SET_LOADING as typeof PROMPTS_ACTIONS.SET_LOADING,
  payload: isLoading,
});

// Network action creators
export const setOnlineStatus = (isOnline: boolean) => ({
  type: NETWORK_ACTIONS.SET_ONLINE_STATUS as typeof NETWORK_ACTIONS.SET_ONLINE_STATUS,
  payload: isOnline,
});
export const setLastSync = (timestamp: number) => ({
  type: NETWORK_ACTIONS.SET_LAST_SYNC as typeof NETWORK_ACTIONS.SET_LAST_SYNC,
  payload: timestamp,
});

// Group chat action creators
export const setGroupChatActive = (isActive: boolean) => ({
  type: GROUP_CHAT_ACTIONS.SET_GROUP_CHAT_ACTIVE as typeof GROUP_CHAT_ACTIONS.SET_GROUP_CHAT_ACTIVE,
  payload: isActive,
});

export const setSpeakingCharacter = (characterId: string | null) => ({
  type: GROUP_CHAT_ACTIONS.SET_SPEAKING_CHARACTER as typeof GROUP_CHAT_ACTIONS.SET_SPEAKING_CHARACTER,
  payload: characterId,
});

export const setPendingCharacters = (characterIds: string[]) => ({
  type: GROUP_CHAT_ACTIONS.SET_PENDING_CHARACTERS as typeof GROUP_CHAT_ACTIONS.SET_PENDING_CHARACTERS,
  payload: characterIds,
});

export const setAddressedCharacters = (characterIds: string[]) => ({
  type: GROUP_CHAT_ACTIONS.SET_ADDRESSED_CHARACTERS as typeof GROUP_CHAT_ACTIONS.SET_ADDRESSED_CHARACTERS,
  payload: characterIds,
});

export const clearPendingCharacters = () => ({
  type: GROUP_CHAT_ACTIONS.CLEAR_PENDING_CHARACTERS as typeof GROUP_CHAT_ACTIONS.CLEAR_PENDING_CHARACTERS,
});

export const resetGroupChatState = () => ({
  type: GROUP_CHAT_ACTIONS.RESET_GROUP_CHAT_STATE as typeof GROUP_CHAT_ACTIONS.RESET_GROUP_CHAT_STATE,
});

const initialUIState: UIState = {
  displayMode: 'popup',
  fontSize: 1.0,
  isChatOpen: false,
  showPrompts: false,
  showMenu: false,
};

const uiReducer = (
  state = initialUIState,
  action: { type: string; payload?: unknown },
): UIState => {
  switch (action.type) {
    case UI_ACTIONS.SET_DISPLAY_MODE:
      return { ...state, displayMode: action.payload as PopupDisplayMode };
    case UI_ACTIONS.SET_FONT_SIZE:
      return { ...state, fontSize: action.payload as number };
    case UI_ACTIONS.SET_CHAT_OPEN:
      return { ...state, isChatOpen: action.payload as boolean };
    case UI_ACTIONS.SET_SHOW_PROMPTS:
      return { ...state, showPrompts: action.payload as boolean };
    case UI_ACTIONS.SET_SHOW_MENU:
      return { ...state, showMenu: action.payload as boolean };
    case UI_ACTIONS.INCREASE_FONT_SIZE:
      return { ...state, fontSize: Math.min(2.0, state.fontSize + 0.1) };
    case UI_ACTIONS.DECREASE_FONT_SIZE:
      return { ...state, fontSize: Math.max(0.5, state.fontSize - 0.1) };
    default:
      return state;
  }
};

const initialSettingsState: SettingsState = {
  displaySettings: {
    popupDisplayMode: 'popup',
    sidebarPosition: 'right',
    sidebarWidth: 350,
    enablePopupIframe: false,
    enableSidebar: false,
    defaultProvider: 'prism-api',
    pageContentTokenLimit: 20000,
    totalMessageTokenLimit: 20000,
    buttonPosition: { top: 20, right: 20 },
    buttonSensitivityAreaPercentage: 10,
    textSelectionKey: '1',
    pageContextKey: '2',
    pageScreenshotKey: '3',
    clipboardKey: '4',
    pageInfoKey: '5',
    iframeToggleKey: '`',
    systemPrompt: '',
  },
  systemPrompt: '',
};

const settingsReducer = (
  state = initialSettingsState,
  action: { type: string; payload?: unknown },
): SettingsState => {
  switch (action.type) {
    case SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS:
      return { ...state, displaySettings: action.payload as ExtensionSettings };
    case SETTINGS_ACTIONS.SET_SYSTEM_PROMPT: {
      const prompt = action.payload as string;
      return {
        ...state,
        systemPrompt: prompt,
        displaySettings: { ...state.displaySettings, systemPrompt: prompt },
      };
    }
    default:
      return state;
  }
};

const initialPromptsState: PromptsState = {
  shortcuts: [],
  isLoading: false,
};

const promptsReducer = (
  state = initialPromptsState,
  action: { type: string; payload?: unknown },
): PromptsState => {
  switch (action.type) {
    case PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS:
      return { ...state, shortcuts: action.payload as PromptShortcut[] };
    case PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT:
      return {
        ...state,
        shortcuts: [...state.shortcuts, action.payload as PromptShortcut],
      };
    case PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT: {
      const payload = action.payload as {
        id: string;
        updates: Partial<PromptShortcut>;
      };
      return {
        ...state,
        shortcuts: state.shortcuts.map((shortcut) =>
          shortcut.id === payload.id
            ? { ...shortcut, ...payload.updates }
            : shortcut,
        ),
      };
    }
    case PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT:
      return {
        ...state,
        shortcuts: state.shortcuts.filter(
          (shortcut) => shortcut.id !== (action.payload as string),
        ),
      };
    case PROMPTS_ACTIONS.SET_LOADING:
      return { ...state, isLoading: action.payload as boolean };
    default:
      return state;
  }
};

const initialNetworkState: NetworkState = {
  isOnline: true,
  lastSync: null,
};

const networkReducer = (
  state = initialNetworkState,
  action: { type: string; payload?: unknown },
): NetworkState => {
  switch (action.type) {
    case NETWORK_ACTIONS.SET_ONLINE_STATUS:
      return { ...state, isOnline: action.payload as boolean };
    case NETWORK_ACTIONS.SET_LAST_SYNC:
      return { ...state, lastSync: action.payload as number };
    default:
      return state;
  }
};

const initialGroupChatState: GroupChatState = {
  isGroupChatActive: false,
  speakingCharacterId: null,
  pendingCharacterIds: [],
  addressedCharacterIds: [],
};

export const groupChatReducer = (
  state = initialGroupChatState,
  action: { type: string; payload?: unknown },
): GroupChatState => {
  switch (action.type) {
    case GROUP_CHAT_ACTIONS.SET_GROUP_CHAT_ACTIVE:
      return { ...state, isGroupChatActive: action.payload as boolean };
    case GROUP_CHAT_ACTIONS.SET_SPEAKING_CHARACTER:
      return { ...state, speakingCharacterId: action.payload as string | null };
    case GROUP_CHAT_ACTIONS.SET_PENDING_CHARACTERS:
      return { ...state, pendingCharacterIds: action.payload as string[] };
    case GROUP_CHAT_ACTIONS.SET_ADDRESSED_CHARACTERS:
      return { ...state, addressedCharacterIds: action.payload as string[] };
    case GROUP_CHAT_ACTIONS.CLEAR_PENDING_CHARACTERS:
      return { ...state, pendingCharacterIds: [] };
    case GROUP_CHAT_ACTIONS.ADVANCE_SPEAKING_CHARACTER:
      return { ...state, speakingCharacterId: action.payload as string | null };
    case GROUP_CHAT_ACTIONS.RESET_GROUP_CHAT_STATE:
      return { ...initialGroupChatState };
    default:
      return state;
  }
};

const rootReducer = combineReducers({
  chat: chatReducer,
  aiConfig: aiConfigReducer,
  context: contextReducer,
  ui: uiReducer,
  settings: settingsReducer,
  prompts: promptsReducer,
  network: networkReducer,
  characters: characterReducer,
  personas: personaReducer,
  presets: presetReducer,
  worldInfo: worldInfoReducer,
  agents: agentReducer,
  groupChat: groupChatReducer,
});

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['chat', 'settings'],
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
