import { AIService, ChatCompletionRequest } from '@prism/llm-service';
import {
  Message,
  ContextData,
  ApiResponse,
  AIConfig,
  ChatSession,
  PromptShortcut
} from '@prism/shared-types';
import { networkStatusService } from './network-status';
import { getFirebaseIdToken } from '@prism/firebase-auth';

export interface UnifiedAIClientOptions {
  aiConfig?: AIConfig;
  prismApiUrl?: string;
  prismApiKey?: string;
}

export class UnifiedAIClient {
  private aiService?: AIService;
  private prismApiUrl?: string;
  private prismApiKey?: string;
  private aiConfig?: AIConfig;

  constructor(options: UnifiedAIClientOptions = {}) {
    this.aiConfig = options.aiConfig;
    this.prismApiUrl = options.prismApiUrl;
    this.prismApiKey = options.prismApiKey;

    if (options.aiConfig) {
      // Ensure proper configuration for local providers
      const configForService = this.prepareConfigForService(options.aiConfig);
      this.aiService = new AIService(configForService);
    }
  }

  private prepareConfigForService(config: AIConfig): AIConfig {
    // Create a copy of the config to avoid modifying the original
    const serviceConfig = { ...config };

    // Set the appropriate API key based on the provider
    if (serviceConfig.providerKeys) {
      serviceConfig.apiKey = serviceConfig.providerKeys[serviceConfig.provider] || '';
    }

    // Set the appropriate API URL based on the provider (for local providers)
    if (serviceConfig.provider === 'koboldcpp' ||
        serviceConfig.provider === 'llamacpp' ||
        serviceConfig.provider === 'ollama' ||
        serviceConfig.provider === 'sglang') {
      serviceConfig.localApiUrl = serviceConfig.providerKeys?.[serviceConfig.provider] || serviceConfig.localApiUrl || serviceConfig.apiUrl;
    }

    // Set the appropriate API URL based on the provider (for OpenRouter)
    if (serviceConfig.provider === 'openrouter') {
      serviceConfig.apiUrl = 'https://openrouter.ai/api/v1';
    }

    return serviceConfig;
  }

  async sendMessage(
    content: string,
    context?: ContextData,
    sessionId?: string,
    images?: string[]
  ): Promise<ApiResponse<Message>> {
    // Check network status
    const isOnline = networkStatusService.isCurrentlyOnline();

    // If we have an AI service (local models) or we're offline, use the local AI service
    if (this.aiService && this.aiConfig) {
      try {
        // Check if provider is a local model or if we're offline
        const isLocalProvider = this.isLocalModelProvider(this.aiConfig.provider);
        const shouldUseLocal = isLocalProvider || !isOnline;

        if (shouldUseLocal) {
          // Use local AI service (offline first approach)
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content,
            images,
            context,
            timestamp: Date.now()
          };

          const request: ChatCompletionRequest = {
            messages: [userMessage],
            context,
            config: this.aiConfig
          };

          const response = await this.aiService.chatCompletion(request);

          const assistantMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
            context,
            tokens: response.tokensUsed
          };

          return {
            success: true,
            data: assistantMessage
          };
        }
      } catch (error: any) {
        console.warn('Local model failed, attempting fallback:', error.message);
        // Continue to try online method if local fails
      }
    }

    // If we're online and have Prism API configured, try the API
    if (isOnline && this.prismApiUrl) {
      try {
        // Get Firebase ID token to include in the request
        const firebaseToken = await getFirebaseIdToken();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        // Add Firebase token if available
        if (firebaseToken) {
          headers['Authorization'] = `Bearer ${firebaseToken}`;
        } else if (this.prismApiKey) {
          // Fall back to API key if no Firebase token
          headers['Authorization'] = `Bearer ${this.prismApiKey}`;
        }

        const response = await fetch(`${this.prismApiUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content,
            context,
            sessionId,
            images
          })
        });

        return await response.json() as Promise<ApiResponse<Message>>;
      } catch (error: any) {
        console.warn('API request failed:', error.message);
      }
    }

    // If all online methods fail, try local models again as last resort
    if (this.aiService && this.aiConfig) {
      try {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content,
          images,
          context,
          timestamp: Date.now()
        };

        const request: ChatCompletionRequest = {
          messages: [userMessage],
          context,
          config: this.aiConfig
        };

        const response = await this.aiService.chatCompletion(request);

        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          context,
          tokens: response.tokensUsed
        };

        return {
          success: true,
          data: assistantMessage
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to get response from AI provider'
        };
      }
    }

    // Finally, return an error if no method worked
    return {
      success: false,
      error: isOnline
        ? 'No API configuration found and local model failed'
        : 'Offline and no local model configured or available'
    };
  }

  // Helper method to check if provider is a local model
  private isLocalModelProvider(provider: string): boolean {
    const localProviders = [
      'koboldcpp',
      'llamacpp',
      'ollama',
      'sglang',
      'transformers'
    ];
    return localProviders.includes(provider);
  }

  updateAIConfig(config: AIConfig) {
    this.aiConfig = config;
    if (this.aiService) {
      const configForService = this.prepareConfigForService(config);
      this.aiService.updateConfig(configForService);
    } else {
      const configForService = this.prepareConfigForService(config);
      this.aiService = new AIService(configForService);
    }
  }

  getCurrentAIConfig(): AIConfig | undefined {
    return this.aiConfig;
  }

  async getAvailableModels(): Promise<string[]> {
    if (this.aiService) {
      return await this.aiService.getAvailableModels();
    }
    // Return default models if service is not initialized
    switch(this.aiConfig?.provider) {
      case 'openai':
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
      case 'gemini':
        return ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'];
      case 'qwen':
        return ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-7b', 'qwen-14b'];
      case 'prism-api':
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gemini-pro', 'gemini-1.5-pro', 'qwen-max', 'qwen-plus'];
      case 'koboldcpp':
        return ['llama-2-7b', 'llama-2-13b', 'llama-2-70b', 'mistral-7b', 'mixtral-8x7b', 'vicuna-7b', 'vicuna-13b'];
      case 'llamacpp':
        return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b', 'phi-2', 'gemma-2b', 'gemma-7b'];
      case 'ollama':
        return ['llama2', 'llama3', 'mistral', 'mixtral', 'gemma', 'phi'];
      case 'sglang':
        return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b'];
      case 'transformers':
        return ['microsoft/DialoGPT-medium', 'microsoft/DialoGPT-large', 'facebook/blenderbot-400M-distill', 'gpt2'];
      case 'claude':
        return ['claude-3-5-sonnet-20241022', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
      case 'deepseek':
        return ['deepseek-chat', 'deepseek-coder'];
      case 'grok':
        return ['grok-beta', 'grok-1', 'grok-1.5'];
      case 'openrouter':
        if (!this.aiService) {
          return ['openchat/openchat-7b', 'neversleep/noromaid-mixtral-8x7b', 'microsoft/wizardlm-2-8x22b'];
        }
        return await (this.aiService as any).getOpenrouterModels();
      case 'poe':
        return ['poe', 'sage', 'dragonfruit', 'citrine'];
      default:
        return [];
    }
  }

  // Sync methods for chat history and configuration
  async syncMessages(messages: Message[]): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      // Get Firebase ID token to include in the request
      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add Firebase token if available
      if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no Firebase token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/api/sync/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages })
      });

      return await response.json() as Promise<ApiResponse<{ message: string; count: number }>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync messages'
      };
    }
  }

  async syncSessions(sessions: ChatSession[]): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      // Get Firebase ID token to include in the request
      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add Firebase token if available
      if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no Firebase token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/api/sync/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessions })
      });

      return await response.json() as Promise<ApiResponse<{ message: string; count: number }>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync sessions'
      };
    }
  }

  async syncPrompts(prompts: PromptShortcut[]): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      // Get Firebase ID token to include in the request
      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add Firebase token if available
      if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no Firebase token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/api/sync/prompts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompts })
      });

      return await response.json() as Promise<ApiResponse<{ message: string; count: number }>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync prompts'
      };
    }
  }

  async getSyncedData(): Promise<ApiResponse<{
    messages: Message[];
    sessions: ChatSession[];
    prompts: PromptShortcut[];
  }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      // Get Firebase ID token to include in the request
      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add Firebase token if available
      if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no Firebase token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/api/sync/data`, {
        method: 'GET',
        headers
      });

      return await response.json() as Promise<ApiResponse<{
        messages: Message[];
        sessions: ChatSession[];
        prompts: PromptShortcut[];
      }>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get synced data'
      };
    }
  }

  async clearSyncedData(): Promise<ApiResponse<{ message: string }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      // Get Firebase ID token to include in the request
      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add Firebase token if available
      if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no Firebase token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/api/sync/clear`, {
        method: 'DELETE',
        headers
      });

      return await response.json() as Promise<ApiResponse<{ message: string }>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to clear synced data'
      };
    }
  }
}
