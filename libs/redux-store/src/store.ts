import { configureStore } from '@reduxjs/toolkit';
import { combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // defaults to localStorage for web
import type { Message, ChatSession, ContextData, AIConfig, PopupDisplayMode, ExtensionSettings, PromptShortcut, ChatHistoryState, ChatFormData } from '@prism/shared-types';
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';

// Define the root state interface
export interface RootState {
  chat: ChatState;
  aiConfig: AIConfigState;
  ui: UIState;
  settings: SettingsState;
  prompts: PromptsState;
  network: NetworkState;
}

// Define state interfaces
export interface ChatState {
  messages: Message[];
  currentSessionId: string;
  sessions: ChatSession[];
  isLoading: boolean;
  context: ContextData | null;
  history: ChatHistoryState;
  forms: ChatFormData;
}

export interface AIConfigState {
  config: AIConfig;
  availableModels: string[];
  isFetchingModels: boolean;
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

// Define action types
export const CHAT_ACTIONS = {
  ADD_MESSAGE: 'chat/ADD_MESSAGE',
  SET_MESSAGES: 'chat/SET_MESSAGES',
  UPDATE_MESSAGE: 'chat/UPDATE_MESSAGE',
  DELETE_MESSAGE: 'chat/DELETE_MESSAGE',
  SET_CURRENT_SESSION: 'chat/SET_CURRENT_SESSION',
  SET_SESSIONS: 'chat/SET_SESSIONS',
  ADD_SESSION: 'chat/ADD_SESSION',
  DELETE_SESSION: 'chat/DELETE_SESSION',
  SET_LOADING: 'chat/SET_LOADING',
  SET_CONTEXT: 'chat/SET_CONTEXT',
  CLEAR_HISTORY: 'chat/CLEAR_HISTORY',
} as const;

export const AI_CONFIG_ACTIONS = {
  SET_AI_CONFIG: 'aiConfig/SET_AI_CONFIG',
  UPDATE_AI_CONFIG: 'aiConfig/UPDATE_AI_CONFIG',
  SET_AVAILABLE_MODELS: 'aiConfig/SET_AVAILABLE_MODELS',
  SET_FETCHING_MODELS: 'aiConfig/SET_FETCHING_MODELS',
} as const;

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

// Define action creators
export const addMessage = (message: Message) => ({
  type: CHAT_ACTIONS.ADD_MESSAGE as typeof CHAT_ACTIONS.ADD_MESSAGE,
  payload: message
});

export const setMessages = (messages: Message[]) => ({
  type: CHAT_ACTIONS.SET_MESSAGES as typeof CHAT_ACTIONS.SET_MESSAGES,
  payload: messages
});

export const updateMessage = (id: string, updates: Partial<Message>) => ({
  type: CHAT_ACTIONS.UPDATE_MESSAGE as typeof CHAT_ACTIONS.UPDATE_MESSAGE,
  payload: { id, updates }
});

export const deleteMessage = (id: string) => ({
  type: CHAT_ACTIONS.DELETE_MESSAGE as typeof CHAT_ACTIONS.DELETE_MESSAGE,
  payload: id
});

export const setCurrentSession = (sessionId: string) => ({
  type: CHAT_ACTIONS.SET_CURRENT_SESSION as typeof CHAT_ACTIONS.SET_CURRENT_SESSION,
  payload: sessionId
});

export const setSessions = (sessions: ChatSession[]) => ({
  type: CHAT_ACTIONS.SET_SESSIONS as typeof CHAT_ACTIONS.SET_SESSIONS,
  payload: sessions
});

export const addSession = (session: ChatSession) => ({
  type: CHAT_ACTIONS.ADD_SESSION as typeof CHAT_ACTIONS.ADD_SESSION,
  payload: session
});

export const deleteSession = (sessionId: string) => ({
  type: CHAT_ACTIONS.DELETE_SESSION as typeof CHAT_ACTIONS.DELETE_SESSION,
  payload: sessionId
});

export const setLoading = (isLoading: boolean) => ({
  type: CHAT_ACTIONS.SET_LOADING as typeof CHAT_ACTIONS.SET_LOADING,
  payload: isLoading
});

export const setContext = (context: ContextData | null) => ({
  type: CHAT_ACTIONS.SET_CONTEXT as typeof CHAT_ACTIONS.SET_CONTEXT,
  payload: context
});

export const clearHistory = () => ({
  type: CHAT_ACTIONS.CLEAR_HISTORY as typeof CHAT_ACTIONS.CLEAR_HISTORY
});

export const setAIConfig = (config: AIConfig) => ({
  type: AI_CONFIG_ACTIONS.SET_AI_CONFIG as typeof AI_CONFIG_ACTIONS.SET_AI_CONFIG,
  payload: config
});

export const updateAIConfig = (config: AIConfig) => ({
  type: AI_CONFIG_ACTIONS.UPDATE_AI_CONFIG as typeof AI_CONFIG_ACTIONS.UPDATE_AI_CONFIG,
  payload: config
});

export const setAvailableModels = (models: string[]) => ({
  type: AI_CONFIG_ACTIONS.SET_AVAILABLE_MODELS as typeof AI_CONFIG_ACTIONS.SET_AVAILABLE_MODELS,
  payload: models
});

export const setFetchingModels = (isFetching: boolean) => ({
  type: AI_CONFIG_ACTIONS.SET_FETCHING_MODELS as typeof AI_CONFIG_ACTIONS.SET_FETCHING_MODELS,
  payload: isFetching
});

export const setDisplayMode = (mode: PopupDisplayMode) => ({
  type: UI_ACTIONS.SET_DISPLAY_MODE as typeof UI_ACTIONS.SET_DISPLAY_MODE,
  payload: mode
});

export const setFontSize = (size: number) => ({
  type: UI_ACTIONS.SET_FONT_SIZE as typeof UI_ACTIONS.SET_FONT_SIZE,
  payload: size
});

export const setChatOpen = (isOpen: boolean) => ({
  type: UI_ACTIONS.SET_CHAT_OPEN as typeof UI_ACTIONS.SET_CHAT_OPEN,
  payload: isOpen
});

export const setShowPrompts = (show: boolean) => ({
  type: UI_ACTIONS.SET_SHOW_PROMPTS as typeof UI_ACTIONS.SET_SHOW_PROMPTS,
  payload: show
});

export const setShowMenu = (show: boolean) => ({
  type: UI_ACTIONS.SET_SHOW_MENU as typeof UI_ACTIONS.SET_SHOW_MENU,
  payload: show
});

export const increaseFontSize = () => ({
  type: UI_ACTIONS.INCREASE_FONT_SIZE as typeof UI_ACTIONS.INCREASE_FONT_SIZE
});

export const decreaseFontSize = () => ({
  type: UI_ACTIONS.DECREASE_FONT_SIZE as typeof UI_ACTIONS.DECREASE_FONT_SIZE
});

export const setDisplaySettings = (settings: ExtensionSettings) => ({
  type: SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS as typeof SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS,
  payload: settings
});

export const setSystemPrompt = (prompt: string) => ({
  type: SETTINGS_ACTIONS.SET_SYSTEM_PROMPT as typeof SETTINGS_ACTIONS.SET_SYSTEM_PROMPT,
  payload: prompt
});

export const setPromptShortcuts = (shortcuts: PromptShortcut[]) => ({
  type: PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS as typeof PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS,
  payload: shortcuts
});

export const addPromptShortcut = (shortcut: PromptShortcut) => ({
  type: PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT,
  payload: shortcut
});

export const updatePromptShortcut = (id: string, updates: Partial<PromptShortcut>) => ({
  type: PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT,
  payload: { id, updates }
});

export const deletePromptShortcut = (id: string) => ({
  type: PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT as typeof PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT,
  payload: id
});

export const setPromptsLoading = (isLoading: boolean) => ({
  type: PROMPTS_ACTIONS.SET_LOADING as typeof PROMPTS_ACTIONS.SET_LOADING,
  payload: isLoading
});

export const setOnlineStatus = (isOnline: boolean) => ({
  type: NETWORK_ACTIONS.SET_ONLINE_STATUS as typeof NETWORK_ACTIONS.SET_ONLINE_STATUS,
  payload: isOnline
});

export const setLastSync = (timestamp: number) => ({
  type: NETWORK_ACTIONS.SET_LAST_SYNC as typeof NETWORK_ACTIONS.SET_LAST_SYNC,
  payload: timestamp
});

// Reducers
const initialChatState: ChatState = {
  messages: [],
  currentSessionId: `session_${Date.now()}`,
  sessions: [],
  isLoading: false,
  context: null,
  history: {
    past: [],
    present: [],
    future: [],
  },
  forms: {},
};

const chatReducer = (state = initialChatState, action: any): ChatState => {
  switch (action.type) {
    case CHAT_ACTIONS.ADD_MESSAGE:
      return {
        ...state,
        messages: [...state.messages, action.payload]
      };
    case CHAT_ACTIONS.SET_MESSAGES:
      return {
        ...state,
        messages: action.payload
      };
    case CHAT_ACTIONS.UPDATE_MESSAGE:
      return {
        ...state,
        messages: state.messages.map(msg => 
          msg.id === action.payload.id ? { ...msg, ...action.payload.updates } : msg
        )
      };
    case CHAT_ACTIONS.DELETE_MESSAGE:
      return {
        ...state,
        messages: state.messages.filter(msg => msg.id !== action.payload)
      };
    case CHAT_ACTIONS.SET_CURRENT_SESSION:
      return {
        ...state,
        currentSessionId: action.payload
      };
    case CHAT_ACTIONS.SET_SESSIONS:
      return {
        ...state,
        sessions: action.payload
      };
    case CHAT_ACTIONS.ADD_SESSION:
      return {
        ...state,
        sessions: [...state.sessions, action.payload]
      };
    case CHAT_ACTIONS.DELETE_SESSION:
      return {
        ...state,
        sessions: state.sessions.filter(session => session.id !== action.payload)
      };
    case CHAT_ACTIONS.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload
      };
    case CHAT_ACTIONS.SET_CONTEXT:
      return {
        ...state,
        context: action.payload
      };
    case CHAT_ACTIONS.CLEAR_HISTORY:
      return {
        ...state,
        messages: []
      };
    default:
      return state;
  }
};

const initialAIConfigState: AIConfigState = {
  config: {
    provider: 'prism-api',
    apiUrl: 'http://localhost:3000/api',
    providerKeys: {
      'openai': '',
      'gemini': '',
      'qwen': '',
      'prism-api': ''
    }
  },
  availableModels: [],
  isFetchingModels: false
};

const aiConfigReducer = (state = initialAIConfigState, action: any): AIConfigState => {
  switch (action.type) {
    case AI_CONFIG_ACTIONS.SET_AI_CONFIG:
      return {
        ...state,
        config: action.payload
      };
    case AI_CONFIG_ACTIONS.UPDATE_AI_CONFIG:
      return {
        ...state,
        config: { ...state.config, ...action.payload }
      };
    case AI_CONFIG_ACTIONS.SET_AVAILABLE_MODELS:
      return {
        ...state,
        availableModels: action.payload
      };
    case AI_CONFIG_ACTIONS.SET_FETCHING_MODELS:
      return {
        ...state,
        isFetchingModels: action.payload
      };
    default:
      return state;
  }
};

const initialUIState: UIState = {
  displayMode: 'popup',
  fontSize: 1.0,
  isChatOpen: false,
  showPrompts: false,
  showMenu: false
};

const uiReducer = (state = initialUIState, action: any): UIState => {
  switch (action.type) {
    case UI_ACTIONS.SET_DISPLAY_MODE:
      return {
        ...state,
        displayMode: action.payload
      };
    case UI_ACTIONS.SET_FONT_SIZE:
      return {
        ...state,
        fontSize: action.payload
      };
    case UI_ACTIONS.SET_CHAT_OPEN:
      return {
        ...state,
        isChatOpen: action.payload
      };
    case UI_ACTIONS.SET_SHOW_PROMPTS:
      return {
        ...state,
        showPrompts: action.payload
      };
    case UI_ACTIONS.SET_SHOW_MENU:
      return {
        ...state,
        showMenu: action.payload
      };
    case UI_ACTIONS.INCREASE_FONT_SIZE:
      return {
        ...state,
        fontSize: Math.min(2.0, state.fontSize + 0.1)
      };
    case UI_ACTIONS.DECREASE_FONT_SIZE:
      return {
        ...state,
        fontSize: Math.max(0.5, state.fontSize - 0.1)
      };
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
    systemPrompt: ''
  },
  systemPrompt: ''
};

const settingsReducer = (state = initialSettingsState, action: any): SettingsState => {
  switch (action.type) {
    case SETTINGS_ACTIONS.SET_DISPLAY_SETTINGS:
      return {
        ...state,
        displaySettings: action.payload
      };
    case SETTINGS_ACTIONS.SET_SYSTEM_PROMPT:
      return {
        ...state,
        systemPrompt: action.payload,
        displaySettings: {
          ...state.displaySettings,
          systemPrompt: action.payload
        }
      };
    default:
      return state;
  }
};

const initialPromptsState: PromptsState = {
  shortcuts: [],
  isLoading: false
};

const promptsReducer = (state = initialPromptsState, action: any): PromptsState => {
  switch (action.type) {
    case PROMPTS_ACTIONS.SET_PROMPT_SHORTCUTS:
      return {
        ...state,
        shortcuts: action.payload
      };
    case PROMPTS_ACTIONS.ADD_PROMPT_SHORTCUT:
      return {
        ...state,
        shortcuts: [...state.shortcuts, action.payload]
      };
    case PROMPTS_ACTIONS.UPDATE_PROMPT_SHORTCUT:
      return {
        ...state,
        shortcuts: state.shortcuts.map(shortcut => 
          shortcut.id === action.payload.id ? { ...shortcut, ...action.payload.updates } : shortcut
        )
      };
    case PROMPTS_ACTIONS.DELETE_PROMPT_SHORTCUT:
      return {
        ...state,
        shortcuts: state.shortcuts.filter(shortcut => shortcut.id !== action.payload)
      };
    case PROMPTS_ACTIONS.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload
      };
    default:
      return state;
  }
};

const initialNetworkState: NetworkState = {
  isOnline: true,
  lastSync: null
};

const networkReducer = (state = initialNetworkState, action: any): NetworkState => {
  switch (action.type) {
    case NETWORK_ACTIONS.SET_ONLINE_STATUS:
      return {
        ...state,
        isOnline: action.payload
      };
    case NETWORK_ACTIONS.SET_LAST_SYNC:
      return {
        ...state,
        lastSync: action.payload
      };
    default:
      return state;
  }
};

// Combine reducers
const rootReducer = combineReducers({
  chat: chatReducer,
  aiConfig: aiConfigReducer,
  ui: uiReducer,
  settings: settingsReducer,
  prompts: promptsReducer,
  network: networkReducer
});

// Configure persist config
const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['chat', 'settings'] // Only persist certain parts of the state
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

// Create the store
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