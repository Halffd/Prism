export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // Base64 encoded image data or URLs
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

export interface PromptShortcut {
  id: string;
  name: string;
  content: string;
  category: string;
  shortcutKey?: string;        // Text-based shortcut key like /fix
  keyboardShortcut?: string;   // Keyboard shortcut like Ctrl+Shift+F
  createdAt: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  parentSessionId?: string;
  forkedFromMessageId?: string;
}

export interface ChatHistoryState {
  past: Message[][];
  present: Message[];
  future: Message[][];
}

export interface FormField {
  name: string;
  value: unknown;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

export interface FormState {
  fields: Record<string, FormField>;
  isValid: boolean;
  isSubmitting: boolean;
  submitCount: number;
  errors: Record<string, string>;
}

export interface ChatFormData {
  [formId: string]: FormState;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type AIProvider = 'openai' | 'gemini' | 'qwen' | 'prism-api' | 'koboldcpp' | 'llamacpp' | 'ollama' | 'sglang' | 'transformers' | 'claude' | 'deepseek' | 'grok' | 'openrouter' | 'poe' | 'nvidia-nim' | 'groq' | 'cerebras' | 'cloudflare-workers' | 'fireworks' | 'zai';

export interface AIConfig {
  provider: AIProvider;
  // Store API keys separately for each provider
  providerKeys?: {
    'openai'?: string;
    'gemini'?: string;
    'qwen'?: string;
    'prism-api'?: string;
    'koboldcpp'?: string;
    'llamacpp'?: string;
    'ollama'?: string;
    'sglang'?: string;
    'transformers'?: string;
    'claude'?: string;
    'deepseek'?: string;
    'grok'?: string;
    'openrouter'?: string;
    'poe'?: string;
    'nvidia-nim'?: string;
    'groq'?: string;
    'cerebras'?: string;
    'cloudflare-workers'?: string;
    'fireworks'?: string;
    'zai'?: string;
  };
  apiKey?: string; // Keep for backward compatibility
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // Additional options for local providers
  localApiUrl?: string;  // For local inference providers
  imageSupport?: boolean; // Whether the provider supports image input
}

export type PopupDisplayMode = 'popup' | 'sidebar' | 'iframe' | 'floating';

export interface ExtensionSettings {
  popupDisplayMode: PopupDisplayMode;
  sidebarPosition: 'left' | 'right';
  sidebarWidth: number;
  enablePopupIframe: boolean;
  enableSidebar: boolean;
  defaultProvider: AIProvider;
  pageContentTokenLimit?: number;  // Token limit for page content (default 20000)
  totalMessageTokenLimit?: number; // Total token limit for message + context (default 20000)
  buttonPosition?: { top: number; right: number };  // Position of the floating button
  buttonSensitivityAreaPercentage?: number;         // Percentage of screen area that triggers button visibility
  textSelectionKey?: string;        // Key to toggle text selection mode (default: '1')
  pageContextKey?: string;          // Key to toggle page context mode (default: '2')
  pageScreenshotKey?: string;       // Key to toggle page screenshot mode (default: '3')
  clipboardKey?: string;            // Key to toggle clipboard mode (default: '4')
  pageInfoKey?: string;             // Key to toggle page info mode (default: '5')
  iframeToggleKey?: string;         // Key to toggle iframe show/hide (default: '`')
  systemPrompt?: string; // System prompt applied to all conversations (default: '')
}

export interface AudioTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface TTSOptions {
  model?: string;
  voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
  speed?: number;
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
}

export interface AudioServiceConfig {
  apiKey: string;
  apiUrl?: string;
  provider?: AIProvider;
}