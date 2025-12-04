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
      this.aiService = new AIService(options.aiConfig);
    }
  }

  async sendMessage(
    content: string,
    context?: ContextData,
    sessionId?: string
  ): Promise<ApiResponse<Message>> {
    // If using an AI provider directly, use the AI service
    if (this.aiService && this.aiConfig && this.aiConfig.provider !== 'prism-api') {
      try {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content,
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
          sessionId
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
      this.aiService.updateConfig(config);
    } else {
      this.aiService = new AIService(config);
    }
  }

  getCurrentAIConfig(): AIConfig | undefined {
    return this.aiConfig;
  }
}
