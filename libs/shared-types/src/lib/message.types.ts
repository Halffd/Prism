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
  metadata?: Record<string, any>;
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

null