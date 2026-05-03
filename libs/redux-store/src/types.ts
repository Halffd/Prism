import type { Message, ContextData, AIConfig, ChatHistoryState, ChatFormData } from '@prism/shared-types';

export interface ChatState {
  messages: Message[];
  currentSessionId: string;
  sessions: any[];
  loading: boolean;
  selectedProvider: AIConfig['provider'];
  history: ChatHistoryState;
  forms: ChatFormData;
}

export interface AIConfigState {
  config: AIConfig;
  availableModels: string[];
  fetchingModels: boolean;
}

export interface ContextState {
  context: ContextData | null;
}

export interface GlobalState {
  chat: ChatState;
  aiConfig: AIConfigState;
  context: ContextState;
}