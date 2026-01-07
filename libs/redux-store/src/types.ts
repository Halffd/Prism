import type { Message, ContextData, AIConfig } from '@prism/shared-types';

export interface ChatState {
  messages: Message[];
  currentSessionId: string;
  sessions: any[]; // Using any here since ChatSession type wasn't imported properly in the original code
  loading: boolean;
  selectedProvider: AIConfig['provider'];
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