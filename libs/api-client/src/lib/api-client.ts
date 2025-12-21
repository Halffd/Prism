import { AIService, ChatCompletionRequest } from '@prism/llm-service';
import { Message, ContextData, ApiResponse, AIConfig } from '@prism/shared-types';

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
    // If using an AI provider directly, use the AI service
    if (this.aiService && this.aiConfig && this.aiConfig.provider !== 'prism-api') {
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

    // Otherwise, fall back to Prism API
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found'
      };
    }

    try {
      const response = await fetch(`${this.prismApiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.prismApiKey && { Authorization: `Bearer ${this.prismApiKey}` })
        },
        body: JSON.stringify({
          content,
          context,
          sessionId,
          images
        })
      });

      return await response.json() as Promise<ApiResponse<Message>>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to Prism API'
      };
    }
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
}
