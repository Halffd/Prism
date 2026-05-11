import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message, ContextData, AIConfig, AudioTranscriptionResponse, TTSOptions, AudioServiceConfig } from '@prism/shared-types';

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
      case 'koboldcpp':
        return this.koboldCppChatCompletion(request);
      case 'llamacpp':
        return this.llamaCppChatCompletion(request);
      case 'ollama':
        return this.ollamaChatCompletion(request);
      case 'sglang':
        return this.sglangChatCompletion(request);
      case 'transformers':
        return this.transformersChatCompletion(request);
      case 'claude':
        return this.claudeChatCompletion(request);
      case 'deepseek':
        return this.deepseekChatCompletion(request);
      case 'grok':
        return this.grokChatCompletion(request);
      case 'openrouter':
        return this.openrouterChatCompletion(request);
      case 'poe':
        return this.poeChatCompletion(request);
      case 'nvidia-nim':
        return this.nvidiaNimChatCompletion(request);
      case 'groq':
        return this.groqChatCompletion(request);
      case 'cerebras':
        return this.cerebrasChatCompletion(request);
      case 'cloudflare-workers':
        return this.cloudflareWorkersChatCompletion(request);
      case 'fireworks':
        return this.fireworksChatCompletion(request);
      case 'zai':
        return this.zaiChatCompletion(request);
      default:
        throw new Error(`Unsupported AI provider: ${this.config.provider}`);
    }
  }

  private async openAIChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const openAiMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // Create a content array with text and image URLs
        const content: Array<{type: string, text?: string, image_url?: {url: string}}> = [];

        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          });
        }

        msg.images.forEach(image => {
          content.push({
            type: 'image_url',
            image_url: { url: image }
          });
        });

        return {
          role: msg.role,
          content: content
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.model || 'gpt-4-vision-preview', // Use vision model for image support
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

    // Initialize the Google Generative AI client
    if (!config.apiKey) {
      throw new Error('No API key provided for Google Gemini');
    }
    const genAI = new GoogleGenerativeAI(config.apiKey);

    // Determine the model to use
    const modelId = config.model || 'gemini-2.5-flash';

    // Prepare the contents array
    let contents: Array<any> = [];

    // Process messages to create content in the format expected by the new SDK
    for (const msg of messages) {
      if (msg.role === 'system') {
        // For system messages, we'll handle them as text content when supported
        if (msg.content) {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
          // Add a response from model to acknowledge the system instruction
          contents.push({
            role: 'model',
            parts: [{ text: 'I understand your instructions.' }]
          });
        }
      } else {
        const parts: Array<any> = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        if (msg.images && Array.isArray(msg.images)) {
          for (const image of msg.images) {
            if (image.startsWith('data:image/')) {
              const [header, base64Data] = image.split(',');
              const mimeType = header.split(';')[0].replace('data:', '');
              parts.push({
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              });
            }
          }
        }

        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: parts
        });
      }
    }

    // Create the generation config
    const generationConfig: any = {};
    if (config.temperature !== undefined) generationConfig.temperature = config.temperature;
    if (config.maxTokens !== undefined) generationConfig.maxOutputTokens = config.maxTokens;
    if (config.topP !== undefined) generationConfig.topP = config.topP;

    try {
      // Generate the content using the new SDK
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent({
        contents,
        generationConfig,
      });

      const response = result.response;
      const text = response.text();

      return {
        content: text,
        tokensUsed: undefined, // The new SDK doesn't provide token usage in the same way
        model: modelId
      };
    } catch (error) {
      console.error('Error generating content with Google Gen AI SDK:', error);
      throw error;
    }
  }

  private async qwenChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Format messages for Qwen API (Alibaba Cloud)
    // For multimodal support in Qwen, we need to handle images specially
    const qwenMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // For Qwen multimodal, combine text and image URLs in the content
        let content = msg.content;
        if (msg.images && msg.images.length > 0) {
          msg.images.forEach(img => {
            content += ` [IMAGE_URL: ${img}]`;
          });
        }
        return {
          role: msg.role,
          content: content
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    // Using Alibaba Cloud's Qwen API endpoint
    // This is a hypothetical endpoint - in reality, we'd need to use Alibaba Cloud's actual API
    const apiUrl = config.apiUrl || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

    const response = await axios.post(
      apiUrl,
      {
        model: config.model || 'qwen-vl-max', // Use vision model for image support
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
      model: config.model || 'qwen-vl-max'
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

  async getAvailableModels(): Promise<string[]> {
    // For now, return a static list of models for each provider
    // In a real implementation, you would fetch from the provider's API
    switch (this.config.provider) {
      case 'openai':
        return await this.getOpenAIModels();
      case 'gemini':
        return await this.getGeminiModels();
      case 'qwen':
        return await this.getQwenModels();
      case 'prism-api':
        return await this.getPrismModels();
      case 'koboldcpp':
        return await this.getKoboldCppModels();
      case 'llamacpp':
        return await this.getLlamaCppModels();
      case 'ollama':
        return await this.getOllamaModels();
      case 'sglang':
        return await this.getSglangModels();
      case 'transformers':
        return await this.getTransformersModels();
      case 'claude':
        return await this.getClaudeModels();
      case 'deepseek':
        return await this.getDeepseekModels();
      case 'grok':
        return await this.getGrokModels();
      case 'openrouter':
        return await this.getOpenrouterModels();
      case 'poe':
        return await this.getPoeModels();
      default:
        throw new Error(`Unsupported AI provider: ${this.config.provider}`);
    }
  }

  private async getOpenAIModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    }

    try {
      const response = await axios.get(
        'https://api.openai.com/v1/models',
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Filter for chat models
      const chatModels = response.data.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id)
        .sort();

      return chatModels.length > 0 ? chatModels : ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    } catch (error) {
      console.error('Error fetching OpenAI models:', error);
      return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    }
  }

  private async getGeminiModels(): Promise<string[]> {
    // The new Google Gen AI SDK doesn't provide a models listing method
    // So we'll continue to use the API approach
    if (!this.config.apiKey) {
      return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'];
    }

    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`
      );

      // Filter for text generation models
      const textModels = response.data.models
        .filter((model: any) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model: any) => model.name.replace('models/', ''))
        .sort();

      return textModels.length > 0 ? textModels : ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'];
    } catch (error) {
      console.error('Error fetching Gemini models:', error);
      return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'];
    }
  }

  private async getQwenModels(): Promise<string[]> {
    // Qwen models are typically accessed through Alibaba Cloud's API
    // This is a simplified implementation - in reality you'd fetch from the actual endpoint
    return ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-7b', 'qwen-14b'];
  }

  private async getPrismModels(): Promise<string[]> {
    // For Prism API, return commonly used models as options
    return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gemini-pro', 'gemini-1.5-pro', 'qwen-max', 'qwen-plus'];
  }

  private async getKoboldCppModels(): Promise<string[]> {
    // For KoboldCPP, return commonly used models or fetch from the API if available
    // Since KoboldCPP doesn't have a standard models endpoint, we'll return some common model names
    return ['llama-2-7b', 'llama-2-13b', 'llama-2-70b', 'mistral-7b', 'mixtral-8x7b', 'vicuna-7b', 'vicuna-13b'];
  }

  private async getLlamaCppModels(): Promise<string[]> {
    // For LlamaCPP, try to fetch available models if possible
    // LlamaCPP doesn't typically have a models endpoint, but we'll try to get a list
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b', 'phi-2', 'gemma-2b', 'gemma-7b'];
    }

    try {
      const apiUrl = this.config.localApiUrl || this.config.apiUrl || 'http://localhost:8080';
      const response = await axios.get(`${apiUrl}/v1/models`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.data) {
        return response.data.data.map((model: any) => model.id);
      }
    } catch (error) {
      console.error('Error fetching LlamaCPP models:', error);
    }

    // Return defaults if API call fails
    return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b', 'phi-2', 'gemma-2b', 'gemma-7b'];
  }

  private async getOllamaModels(): Promise<string[]> {
    // Fetch models from Ollama
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return ['llama2', 'llama3', 'mistral', 'mixtral', 'gemma', 'phi'];
    }

    try {
      const apiUrl = this.config.localApiUrl || this.config.apiUrl || 'http://localhost:11434';
      const response = await axios.get(`${apiUrl}/api/tags`);

      if (response.data && response.data.models) {
        return response.data.models.map((model: any) => model.name);
      }
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
    }

    // Return defaults if API call fails
    return ['llama2', 'llama3', 'mistral', 'mixtral', 'gemma', 'phi'];
  }

  private async getSglangModels(): Promise<string[]> {
    // For SGLang, try to fetch available models if possible
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b'];
    }

    try {
      const apiUrl = this.config.localApiUrl || this.config.apiUrl || 'http://localhost:30000';
      const response = await axios.get(`${apiUrl}/v1/models`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.data) {
        return response.data.data.map((model: any) => model.id);
      }
    } catch (error) {
      console.error('Error fetching SGLang models:', error);
    }

    // Return defaults if API call fails
    return ['llama-2-7b', 'llama-2-13b', 'llama-3-8b', 'mistral-7b', 'mixtral-8x7b'];
  }

  private async getTransformersModels(): Promise<string[]> {
    // For Transformers, return common models available through Hugging Face
    return [
      'microsoft/DialoGPT-medium',
      'microsoft/DialoGPT-large',
      'facebook/blenderbot-400M-distill',
      'facebook/blenderbot_small-90M',
      'gpt2',
      'EleutherAI/gpt-j-6B',
      'EleutherAI/gpt-neo-2.7B'
    ];
  }

  private async getClaudeModels(): Promise<string[]> {
    // Return Claude model options
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-sonnet-20240229',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307'
    ];
  }

  private async getDeepseekModels(): Promise<string[]> {
    // Return DeepSeek model options
    return [
      'deepseek-chat',
      'deepseek-coder'
    ];
  }

  private async getGrokModels(): Promise<string[]> {
    // Return Grok model options (these are hypothetical as Grok API details may vary)
    return [
      'grok-beta',
      'grok-1',
      'grok-1.5'
    ];
  }

  public async getOpenrouterModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      // Return some default models when no API key is set
      return [
        'openchat/openchat-7b',
        'neversleep/noromaid-mixtral-8x7b',
        'microsoft/wizardlm-2-8x22b',
        'cognitivecomputations/dolphin-mixtral-8x7b'
      ];
    }

    try {
      const response = await axios.get(
        'https://openrouter.ai/api/v1/models',
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Filter for chat models and map to their IDs
      const chatModels = response.data.data
        .filter((model: any) => model.capabilities?.chat)
        .map((model: any) => model.id)
        .sort();

      return chatModels.length > 0 ? chatModels : [
        'openchat/openchat-7b',
        'neversleep/noromaid-mixtral-8x7b',
        'microsoft/wizardlm-2-8x22b',
        'cognitivecomputations/dolphin-mixtral-8x7b'
      ];
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error);
      // Return some default models if API call fails
      return [
        'openchat/openchat-7b',
        'neversleep/noromaid-mixtral-8x7b',
        'microsoft/wizardlm-2-8x22b',
        'cognitivecomputations/dolphin-mixtral-8x7b'
      ];
    }
  }

  private async getPoeModels(): Promise<string[]> {
    // Return POE model options (placeholder as API is not publicly available)
    return [
      'poe',
      'sage',
      'dragonfruit',
      'citrine'
    ];
  }

  private async koboldCppChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const koboldMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const apiUrl = config.localApiUrl || config.apiUrl || 'http://localhost:5001';

    const response = await axios.post(
      `${apiUrl}/api/v1/generate`,
      {
        prompt: this.formatPrompt(koboldMessages),
        max_length: config.maxTokens || 200,
        temperature: config.temperature || 0.8,
        top_p: config.topP || 0.9,
        top_k: 100,
        rep_pen: 1.1
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.results[0].text,
      tokensUsed: undefined, // KoboldCPP doesn't typically return token usage
      model: config.model || 'default'
    };
  }

  private async llamaCppChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const llamaMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        // Create a content array with text and image URLs for multimodal support
        const content: Array<{type: string, text?: string, image_url?: {url: string}}> = [];

        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          });
        }

        msg.images.forEach(image => {
          content.push({
            type: 'image_url',
            image_url: { url: image }
          });
        });

        return {
          role: msg.role,
          content: content
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    const apiUrl = config.localApiUrl || config.apiUrl || 'http://localhost:8080';

    const response = await axios.post(
      `${apiUrl}/v1/chat/completions`,
      {
        model: config.model || '',
        messages: llamaMessages,
        temperature: config.temperature || 0.8,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        stream: false
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async ollamaChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    // Ollama supports images in its API - create the proper message format
    const ollamaMessages = messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        return {
          role: msg.role,
          content: msg.content,
          images: msg.images.map(img => {
            // For Ollama, image data needs to be base64 encoded without data:image/ prefix
            if (img.startsWith('data:image/')) {
              return img.split(',')[1]; // Get the base64 part
            }
            return img; // If already base64, return as is
          })
        };
      } else {
        return {
          role: msg.role,
          content: msg.content
        };
      }
    });

    const apiUrl = config.localApiUrl || config.apiUrl || 'http://localhost:11434';

    const response = await axios.post(
      `${apiUrl}/api/chat`,
      {
        model: config.model || 'llava', // Use a vision model for image support
        messages: ollamaMessages,
        options: {
          temperature: config.temperature || 0.8,
          num_predict: config.maxTokens,
          top_p: config.topP
        },
        stream: false
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.message.content,
      tokensUsed: undefined, // Ollama doesn't return token usage in the same way
      model: config.model || 'llava'
    };
  }

  private async sglangChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const sglangMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const apiUrl = config.localApiUrl || config.apiUrl || 'http://localhost:30000'; // Default SGLang port

    const response = await axios.post(
      `${apiUrl}/v1/chat/completions`,
      {
        model: config.model || '',
        messages: sglangMessages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens,
        top_p: config.topP
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private formatPrompt(messages: Array<{role: string, content: string}>): string {
    // Format messages into a single prompt for KoboldCPP
    return messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n') + '\n\nassistant:';
  }

  private async transformersChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Transformers API is typically used with Hugging Face Inference API
    const apiUrl = config.localApiUrl || config.apiUrl || 'https://api-inference.huggingface.co/models';
    const model = config.model || 'microsoft/DialoGPT-medium';

    const transformersMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await axios.post(
      `${apiUrl}/${model}/chat/completions`,
      {
        model: model,
        messages: transformersMessages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 200,
        top_p: config.topP || 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async claudeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    const apiUrl = config.localApiUrl || config.apiUrl || 'https://api.anthropic.com/v1';

    const claudeMessages = messages.filter(msg => msg.role !== 'system').map(msg => {
      if (msg.images && msg.images.length > 0) {
        const content: Array<{type: string; text?: string; source?: {type: string; media_type: string; data: string}}> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        msg.images.forEach(image => {
          const matches = image.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (matches) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: matches[1], data: matches[2] }
            });
          } else {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: image.replace(/^data:image\/\w+;base64,/, '') }
            });
          }
        });
        return { role: msg.role === 'user' ? 'user' : 'assistant', content };
      }
      return { role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content };
    });

    const response = await axios.post(
      `${apiUrl}/messages`,
      {
        model: config.model || 'claude-3-sonnet-20240229',
        messages: claudeMessages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 1024,
        top_p: config.topP || 0.9
      },
      {
        headers: {
          'x-api-key': config.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        }
      }
    );

    return {
      content: response.data.content[0].text,
      tokensUsed: response.data.usage?.input_tokens + response.data.usage?.output_tokens,
      model: response.data.model
    };
  }

  private async deepseekChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    const apiUrl = config.localApiUrl || config.apiUrl || 'https://api.deepseek.com';

    const response = await axios.post(
      `${apiUrl}/chat/completions`,
      {
        model: config.model || 'deepseek-chat',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 1024,
        top_p: config.topP || 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async grokChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    const apiUrl = config.localApiUrl || config.apiUrl || 'https://api.x.ai/v1';

    const response = await axios.post(
      `${apiUrl}/chat/completions`,
      {
        model: config.model || 'grok-beta',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 1024,
        top_p: config.topP || 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async openrouterChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    const apiUrl = config.localApiUrl || config.apiUrl || 'https://openrouter.ai/api/v1';

    const response = await axios.post(
      `${apiUrl}/chat/completions`,
      {
        model: config.model || 'openchat/openchat-7b',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 1024,
        top_p: config.topP || 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://prism-extension.com',
          'X-Title': 'Prism Extension',
          'User-Agent': 'Prism Extension'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async poeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // POE API access is typically through their web API
    // This is a placeholder implementation as POE doesn't have a public API
    // In a real implementation, this would require either POE API key or web scraping
    const { config } = request;

    // For now, we'll return a simulated response
    // In a real implementation, you would need to use POE's API or web interface
    console.warn('POE API integration not fully implemented - using mock response');

    // Return a simulated response
    return {
      content: "This is a simulated response from POE. In a real implementation, this would connect to POE's API.",
      tokensUsed: 25,
      model: config.model || 'poe'
    };
  }

  private async nvidiaNimChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      config.apiUrl || 'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model: config.model || 'meta/llama3-8b-instruct',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async groqChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: config.model || 'llama3-8b-8192',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async cerebrasChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        model: config.model || 'llama3.1-8b',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: config.temperature,
        max_tokens: config.maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async cloudflareWorkersChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      config.apiUrl || 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct',
      {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.result.response,
      tokensUsed: undefined,
      model: config.model || '@cf/meta/llama-3.1-8b-instruct'
    };
  }

  private async fireworksChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      'https://api.fireworks.ai/inference/v1/chat/completions',
      {
        model: config.model || 'accounts/fireworks/models/llama-v3p1-8b-instruct',
        messages: this.formatOpenAICompatibleMessages(messages),
        temperature: config.temperature,
        max_tokens: config.maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private async zaiChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      'https://api.z.ai/v1/chat/completions',
      {
        model: config.model || 'glm-4-flash',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: config.temperature,
        max_tokens: config.maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model
    };
  }

  private formatOpenAICompatibleMessages(messages: Message[]) {
    return messages.map(msg => {
      if (msg.images && msg.images.length > 0) {
        const content: Array<{type: string; text?: string; image_url?: {url: string}}> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        msg.images.forEach(image => {
          content.push({ type: 'image_url', image_url: { url: image } });
        });
        return { role: msg.role, content };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  async transcribeAudio(audioBlob: Blob, config: AudioServiceConfig): Promise<AudioTranscriptionResponse> {
    const apiKey = config.apiKey || this.config.apiKey || this.config.providerKeys?.['openai'] || '';
    const apiUrl = config.apiUrl || 'https://api.openai.com/v1';

    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const response = await axios.post(`${apiUrl}/audio/transcriptions`, formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
    });

    return {
      text: response.data.text,
      language: response.data.language,
      duration: response.data.duration,
    };
  }

  async textToSpeech(text: string, options: TTSOptions, config: AudioServiceConfig): Promise<Blob> {
    const apiKey = config.apiKey || this.config.apiKey || this.config.providerKeys?.['openai'] || '';
    const apiUrl = config.apiUrl || 'https://api.openai.com/v1';

    const response = await axios.post(`${apiUrl}/audio/speech`, {
      model: options.model || 'tts-1',
      input: text,
      voice: options.voice || 'alloy',
      speed: options.speed || 1.0,
      response_format: options.responseFormat || 'mp3',
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'blob',
    });

    return response.data;
  }
}
