import axios from 'axios';
import { Message, ContextData, AIConfig } from '@prism/shared-types';

export interface ChatCompletionRequest {
  messages: Message[];
  context?: ContextData;
  config: AIConfig;
}

export interface ChatCompletionResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
}

export class AIService {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    switch (this.config.provider) {
      case 'openai':
        return this.openAIChatCompletion(request);
      case 'gemini':
        return this.geminiChatCompletion(request);
      case 'qwen':
        return this.qwenChatCompletion(request);
      case 'prism-api':
        return this.prismApiChatCompletion(request);
      default:
        throw new Error(`Unsupported AI provider: ${this.config.provider}`);
    }
  }

  private async openAIChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const openAiMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.model || 'gpt-3.5-turbo',
        messages: openAiMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        frequency_penalty: config.frequencyPenalty,
        presence_penalty: config.presencePenalty
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async geminiChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Format messages for Gemini API
    const geminiMessages = messages.filter(msg => msg.role !== 'system').map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model', // Gemini uses 'user' and 'model'
      parts: [{ text: msg.content }]
    }));

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model || 'gemini-pro'}:generateContent?key=${config.apiKey}`,
      {
        contents: geminiMessages,
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
          topP: config.topP
        }
      }
    );

    const candidate = response.data.candidates[0];
    return {
      content: candidate.content.parts[0].text,
      tokensUsed: undefined, // Gemini API doesn't return token usage in the same way
      model: config.model || 'gemini-pro'
    };
  }

  private async qwenChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Format messages for Qwen API (Alibaba Cloud)
    const qwenMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Using Alibaba Cloud's Qwen API endpoint
    // This is a hypothetical endpoint - in reality, we'd need to use Alibaba Cloud's actual API
    const apiUrl = config.apiUrl || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

    const response = await axios.post(
      apiUrl,
      {
        model: config.model || 'qwen-max',
        input: {
          messages: qwenMessages
        },
        parameters: {
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          top_p: config.topP
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable' // For async processing if needed
        }
      }
    );

    const output = response.data.output;
    return {
      content: output.text,
      tokensUsed: output.usage?.total_tokens,
      model: config.model || 'qwen-max'
    };
  }

  private async prismApiChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // This maintains compatibility with the existing Prism API
    throw new Error('Prism API integration not implemented in AIService. Use PrismClient instead.');
  }

  updateConfig(newConfig: AIConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  getCurrentConfig(): AIConfig {
    return this.config;
  }
}
