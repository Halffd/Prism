import { AIService, ChatCompletionRequest } from '@prism/llm-service';
import {
  Message,
  ContextData,
  ApiResponse,
  AIConfig,
  ChatSession,
  PromptShortcut,
  AudioTranscriptionResponse,
  TTSOptions,
  AudioServiceConfig
} from '@prism/shared-types';
import { networkStatusService } from './network-status';
import { getFirebaseIdToken } from '@prism/firebase-auth/src/utils';

// We'll access the supabase client dynamically to avoid build issues
let _supabaseClient: any = null;

async function getSupabaseClient() {
  if (!_supabaseClient) {
    const module: any = await import('@prism/supabase-client');
    _supabaseClient = module.supabaseClient;
  }
  return _supabaseClient;
}

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

    // Update the network status service with the API URL if provided
    if (this.prismApiUrl) {
      networkStatusService.updateApiUrl(this.prismApiUrl);
    }

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

    // Set API URLs for new providers
    if (serviceConfig.provider === 'nvidia-nim') {
      serviceConfig.apiUrl = serviceConfig.apiUrl || 'https://integrate.api.nvidia.com/v1';
    }

    if (serviceConfig.provider === 'groq') {
      serviceConfig.apiUrl = 'https://api.groq.com/openai/v1';
    }

    if (serviceConfig.provider === 'cerebras') {
      serviceConfig.apiUrl = 'https://api.cerebras.ai/v1';
    }

    if (serviceConfig.provider === 'cloudflare-workers') {
      // Cloudflare Workers AI requires account ID in URL
      // Format: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/...
      // The account_id should be set in the apiUrl or providerKey
      serviceConfig.apiUrl = serviceConfig.apiUrl || 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run';
    }

    if (serviceConfig.provider === 'fireworks') {
      serviceConfig.apiUrl = 'https://api.fireworks.ai/inference/v1';
    }

    if (serviceConfig.provider === 'zai') {
      serviceConfig.apiUrl = 'https://api.z.ai/v1';
    }

    return serviceConfig;
  }

  async sendMessage(
    content: string,
    context?: ContextData,
    sessionId?: string,
    images?: string[],
    conversationHistory?: Message[]
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

          // Prepare the messages array with conversation history if provided
          const messagesToSend = conversationHistory ? [...conversationHistory, userMessage] : [userMessage];

          const request: ChatCompletionRequest = {
            messages: messagesToSend,
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
        // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
        const supabase = await getSupabaseClient();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        let supabaseToken: string | null = null;
        if (!sessionError && session) {
          supabaseToken = session.access_token;
        }

        const firebaseToken = await getFirebaseIdToken();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };

        // Add authentication token in priority order
        if (supabaseToken) {
          headers['Authorization'] = `Bearer ${supabaseToken}`;
        } else if (firebaseToken) {
          headers['Authorization'] = `Bearer ${firebaseToken}`;
        } else if (this.prismApiKey) {
          // Fall back to API key if no authentication token
          headers['Authorization'] = `Bearer ${this.prismApiKey}`;
        }

        // Prepare the messages array with conversation history if provided
        const messagesToSend = conversationHistory ? [...conversationHistory, {
          id: Date.now().toString(),
          role: 'user',
          content,
          images,
          context,
          timestamp: Date.now()
        }] : [{
          id: Date.now().toString(),
          role: 'user',
          content,
          images,
          context,
          timestamp: Date.now()
        }];

        const response = await fetch(`${this.prismApiUrl}/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: messagesToSend,
            context,
            sessionId
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

    // Update the network status service with the API URL if it's in the provider keys
    if (config.providerKeys && config.providerKeys['prism-api']) {
      networkStatusService.updateApiUrl(config.providerKeys['prism-api']);
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
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication token in priority order
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      } else if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no authentication token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/sync/messages`, {
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
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication token in priority order
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      } else if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no authentication token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/sync/sessions`, {
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
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication token in priority order
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      } else if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no authentication token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/sync/prompts`, {
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
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication token in priority order
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      } else if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no authentication token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/sync/data`, {
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
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication token in priority order
      if (supabaseToken) {
        headers['Authorization'] = `Bearer ${supabaseToken}`;
      } else if (firebaseToken) {
        headers['Authorization'] = `Bearer ${firebaseToken}`;
      } else if (this.prismApiKey) {
        // Fall back to API key if no authentication token
        headers['Authorization'] = `Bearer ${this.prismApiKey}`;
      }

      const response = await fetch(`${this.prismApiUrl}/sync/clear`, {
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

  async transcribeAudio(audioBlob: Blob): Promise<ApiResponse<AudioTranscriptionResponse>> {
    try {
      if (!this.aiService) {
        return { success: false, error: 'AI service not initialized' };
      }

      const config = this.getAudioServiceConfig();
      const result = await this.aiService.transcribeAudio(audioBlob, config);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message || 'Transcription failed' };
    }
  }

  async textToSpeech(text: string, options?: TTSOptions): Promise<ApiResponse<Blob>> {
    try {
      if (!this.aiService) {
        return { success: false, error: 'AI service not initialized' };
      }

      const config = this.getAudioServiceConfig();
      const audioBlob = await this.aiService.textToSpeech(text, options || {}, config);
      return { success: true, data: audioBlob };
    } catch (error: any) {
      return { success: false, error: error.message || 'Text-to-speech failed' };
    }
  }

  private getAudioServiceConfig(): AudioServiceConfig {
    const config = this.aiConfig || {} as AIConfig;
    return {
      apiKey: config.providerKeys?.['openai'] || config.apiKey || '',
      apiUrl: config.apiUrl || 'https://api.openai.com/v1',
      provider: config.provider,
    };
  }
}
