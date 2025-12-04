export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: ContextData;
  timestamp: number;
  tokens?: number;
}

export interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;  // For mobile screen context
  metadata?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type AIProvider = 'openai' | 'gemini' | 'qwen' | 'prism-api';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}