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
  AudioServiceConfig,
  AICapability,
  ServiceConfig,
  AIMode,
  AdapterConfig,
  OCRRequest,
  OCRResult,
  STTRequest,
  STTResult,
  ResponseMetrics,
  TTSRequest,
  TTSResult,
  InpaintRequest,
  InpaintResult,
  ModelGenRequest,
  ModelGenResult,
  AudioGenRequest,
  AudioGenResult,
  VideoGenRequest,
  VideoGenResult,
  LLMRequest,
  LLMResult,
  AgentRequest,
  AgentResult,
  WebSearchRequest,
  WebSearchResult,
  DeepSearchRequest,
  DeepSearchResult,
  CouncilRequest,
  CouncilResponse,
  MultiSendRequest,
  MultiSendResponse,
  DebateRequest,
  DebateResult,
  MessageSwipe,
  Result,
  GroupChatResponse,
  GroupChatMode,
  CharacterCard,
  AssembledContext,
} from '@prism/shared-types';
import { AIFactory } from '@prism/ai-factory';
import { AdapterRouter } from '@prism/ai-adapters';
import type { OCRService } from '@prism/ocr';
import type { STTService } from '@prism/stt';
import type { TTSService } from '@prism/tts';
import type { InpaintService } from '@prism/inpaint';
import type { ModelGenService } from '@prism/model-gen';
import type { AudioGenService } from '@prism/audio-gen';
import type { VideoGenService } from '@prism/video-gen';
import type { LLMService } from '@prism/llm';
import type { AgentService } from '@prism/agent';
import type { WebSearchService } from '@prism/web-search';
import type { DeepSearchService } from '@prism/deepsearch';
import type { CouncilService } from '@prism/council';
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
  private ocrService?: OCRService;
  private sttService?: STTService;
  private ttsService?: TTSService;
  private inpaintService?: InpaintService;
  private modelGenService?: ModelGenService;
  private audioGenService?: AudioGenService;
  private videoGenService?: VideoGenService;
  private llmService?: LLMService;
  private agentService?: AgentService;
  private webSearchService?: WebSearchService;
  private deepSearchService?: DeepSearchService;
  private councilService?: CouncilService;
  private adapterRouter?: AdapterRouter;

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
      this.initCapabilityServices(configForService);
      this.initAdapterRouter(configForService);
    }
  }

  private toServiceConfig(config: AIConfig): ServiceConfig {
    return {
      provider: config.provider,
      apiKey: config.providerKeys?.[config.provider] || config.apiKey || '',
      apiUrl: config.apiUrl,
      model: config.model,
    };
  }

  private initCapabilityServices(config: AIConfig): void {
    const sc = this.toServiceConfig(config);
    const provider = config.provider as string;

    try {
      this.ocrService = AIFactory.create('ocr', provider, sc);
    } catch {
      /* provider not supported for this capability */
    }
    try {
      this.sttService = AIFactory.create('stt', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.ttsService = AIFactory.create('tts', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.inpaintService = AIFactory.create('inpaint', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.modelGenService = AIFactory.create('model-gen', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.audioGenService = AIFactory.create('audio-gen', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.videoGenService = AIFactory.create('video-gen', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.llmService = AIFactory.create('llm', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.agentService = AIFactory.create('agent', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.webSearchService = AIFactory.create('web-search', provider, sc);
    } catch {
      /* provider not supported */
    }
    try {
      this.deepSearchService = AIFactory.create('deepsearch', provider, sc);
    } catch {
      /* provider not supported */
    }
  }

  private initAdapterRouter(config: AIConfig): void {
    const sc = this.toServiceConfig(config);
    const adapterConfig: AdapterConfig = {
      mode: config.mode || 'api',
      prismApiUrl: this.prismApiUrl,
      prismApiKey: this.prismApiKey,
      localApiUrl: config.localApiUrl,
      providerKeys: config.providerKeys,
    };
    this.adapterRouter = new AdapterRouter(sc, adapterConfig);
  }

  setCapabilityProvider(
    capability: AICapability,
    provider: string,
    config?: Partial<ServiceConfig>,
  ): void {
    const sc: ServiceConfig = {
      provider: (config?.provider ||
        this.aiConfig?.provider ||
        'openai') as AIConfig['provider'],
      apiKey:
        config?.apiKey ||
        this.aiConfig?.providerKeys?.[this.aiConfig?.provider] ||
        this.aiConfig?.apiKey ||
        '',
      apiUrl: config?.apiUrl || this.aiConfig?.apiUrl,
      model: config?.model || this.aiConfig?.model,
    };
    const service = AIFactory.create(capability, provider, sc);
    switch (capability) {
      case 'ocr':
        this.ocrService = service as OCRService;
        break;
      case 'stt':
        this.sttService = service as STTService;
        break;
      case 'tts':
        this.ttsService = service as TTSService;
        break;
      case 'inpaint':
        this.inpaintService = service as InpaintService;
        break;
      case 'model-gen':
        this.modelGenService = service as ModelGenService;
        break;
      case 'audio-gen':
        this.audioGenService = service as AudioGenService;
        break;
      case 'video-gen':
        this.videoGenService = service as VideoGenService;
        break;
      case 'llm':
        this.llmService = service as LLMService;
        break;
      case 'agent':
        this.agentService = service as AgentService;
        break;
      case 'web-search':
        this.webSearchService = service as WebSearchService;
        break;
      case 'deepsearch':
        this.deepSearchService = service as DeepSearchService;
        break;
    }
    this.adapterRouter?.setProvider(capability, provider, sc);
  }

  setMode(mode: AIMode): void {
    this.adapterRouter?.setMode(mode);
  }

  setCapabilityMode(capability: AICapability, mode: AIMode): void {
    this.adapterRouter?.setCapabilityMode(capability, mode);
  }

  getAdapterRouter(): AdapterRouter | undefined {
    return this.adapterRouter;
  }

  private prepareConfigForService(config: AIConfig): AIConfig {
    // Create a copy of the config to avoid modifying the original
    const serviceConfig = { ...config };

    // Set the appropriate API key based on the provider
    if (serviceConfig.providerKeys) {
      serviceConfig.apiKey =
        serviceConfig.providerKeys[serviceConfig.provider] || '';
    }

    // Set the appropriate API URL based on the provider (for local providers)
    if (
      serviceConfig.provider === 'koboldcpp' ||
      serviceConfig.provider === 'llamacpp' ||
      serviceConfig.provider === 'ollama' ||
      serviceConfig.provider === 'sglang'
    ) {
      serviceConfig.localApiUrl =
        serviceConfig.providerKeys?.[serviceConfig.provider] ||
        serviceConfig.localApiUrl ||
        serviceConfig.apiUrl;
    }

    // Set the appropriate API URL based on the provider (for OpenRouter)
    if (serviceConfig.provider === 'openrouter') {
      serviceConfig.apiUrl = 'https://openrouter.ai/api/v1';
    }

    // Set API URLs for new providers
    if (serviceConfig.provider === 'nvidia-nim') {
      serviceConfig.apiUrl =
        serviceConfig.apiUrl || 'https://integrate.api.nvidia.com/v1';
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
      serviceConfig.apiUrl =
        serviceConfig.apiUrl ||
        'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run';
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
    conversationHistory?: Message[],
  ): Promise<ApiResponse<Message>> {
    // Check network status
    const isOnline = networkStatusService.isCurrentlyOnline();

    // If we have an AI service (local models) or we're offline, use the local AI service
    if (this.aiService && this.aiConfig) {
      try {
        // Check if provider is a local model or if we're offline
        const isLocalProvider = this.isLocalModelProvider(
          this.aiConfig.provider,
        );
        const shouldUseLocal = isLocalProvider || !isOnline;

        if (shouldUseLocal) {
          // Use local AI service (offline first approach)
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content,
            images,
            context,
            timestamp: Date.now(),
          };

          // Prepare the messages array with conversation history if provided
          const messagesToSend = conversationHistory
            ? [...conversationHistory, userMessage]
            : [userMessage];

          const request: ChatCompletionRequest = {
            messages: messagesToSend,
            context,
            config: this.aiConfig,
          };

          const startTime = Date.now();
          const response = await this.aiService.chatCompletion(request);
          const latencyMs = Date.now() - startTime;

          const promptTokens = response.tokensUsed
            ? Math.max(
                0,
                response.tokensUsed - Math.ceil(response.content.length / 4),
              )
            : undefined;
          const completionTokens = response.tokensUsed
            ? Math.ceil(response.content.length / 4)
            : undefined;
          const totalTokens = response.tokensUsed;
          const messagesWithContext = conversationHistory
            ? conversationHistory.length + 1
            : 1;
          const charsInContext = messagesToSend.reduce(
            (acc, m) => acc + m.content.length,
            0,
          );
          const contextSize = Math.ceil(charsInContext / 4);
          const tokensPerSecond =
            latencyMs > 0 && completionTokens
              ? completionTokens / (latencyMs / 1000)
              : undefined;

          const assistantMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
            context,
            tokens: response.tokensUsed,
            metrics: {
              latencyMs,
              promptTokens,
              completionTokens,
              totalTokens,
              contextSize,
              tokensPerSecond,
              model: this.aiConfig.model,
              provider: this.aiConfig.provider as string,
            },
          } as Message & { metrics: ResponseMetrics };

          void messagesWithContext;

          return {
            success: true,
            data: assistantMessage,
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
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        let supabaseToken: string | null = null;
        if (!sessionError && session) {
          supabaseToken = session.access_token;
        }

        const firebaseToken = await getFirebaseIdToken();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
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
        const messagesToSend = conversationHistory
          ? [
              ...conversationHistory,
              {
                id: Date.now().toString(),
                role: 'user',
                content,
                images,
                context,
                timestamp: Date.now(),
              },
            ]
          : [
              {
                id: Date.now().toString(),
                role: 'user',
                content,
                images,
                context,
                timestamp: Date.now(),
              },
            ];

        const response = await fetch(`${this.prismApiUrl}/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: messagesToSend,
            context,
            sessionId,
            thinkingMode: this.aiConfig?.thinkingMode,
          }),
        });

        return (await response.json()) as Promise<ApiResponse<Message>>;
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
          timestamp: Date.now(),
        };

        const request: ChatCompletionRequest = {
          messages: [userMessage],
          context,
          config: this.aiConfig,
        };

        const response = await this.aiService.chatCompletion(request);

        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          context,
          tokens: response.tokensUsed,
        };

        return {
          success: true,
          data: assistantMessage,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to get response from AI provider',
        };
      }
    }

    // Finally, return an error if no method worked
    return {
      success: false,
      error: isOnline
        ? 'No API configuration found and local model failed'
        : 'Offline and no local model configured or available',
    };
  }

  /**
   * Send a message in group chat mode with hybrid LLM strategy:
   * - round-robin: single LLM call with next-character prompt appended
   * - reactive: sequential per-character calls, each character sees the previous responses
   * - selective: sequential calls only for @mentioned characters (or the addressed ones)
   */
  async sendGroupMessage(
    content: string,
    mode: GroupChatMode,
    characters: CharacterCard[],
    assembledContext: AssembledContext,
    sessionId?: string,
    images?: string[],
    options?: {
      speakingCharacterId?: string; // For round-robin: which character speaks next
      addressedCharacterIds?: string[]; // For selective: which characters were @mentioned
      allowSelfInteractions?: boolean; // Whether characters can reference each other
      maxResponsesPerTurn?: number; // Limit responses in reactive mode
    },
  ): Promise<ApiResponse<GroupChatResponse>> {
    const respondingCharacterIds: string[] = [];
    const messages: Message[] = [];

    try {
      if (mode === 'round-robin') {
        // Single LLM call with next-character prompt appended
        const speakingId = options?.speakingCharacterId ?? characters[0]?.id;
        if (!speakingId) {
          return {
            success: false,
            error: 'No speaking character specified for round-robin mode',
          };
        }
        const speakingChar = characters.find((c) => c.id === speakingId);
        if (!speakingChar) {
          return { success: false, error: `Character ${speakingId} not found` };
        }

        const userMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'user',
          content,
          images,
          context:
            assembledContext.messages.length > 0
              ? assembledContext.messages[0]?.context
              : undefined,
          timestamp: Date.now(),
        };

        const messagesToSend = [...assembledContext.messages, userMessage];

        // Use the underlying AI service or API
        const result = await this.sendMessage(
          content,
          undefined,
          sessionId,
          images,
          messagesToSend,
        );

        if (result.success && result.data) {
          const assistantMessage: Message = {
            ...result.data,
            characterId: speakingId,
          };
          respondingCharacterIds.push(speakingId);
          messages.push(assistantMessage);
        } else {
          return {
            success: false,
            error: result.error || 'Round-robin group message failed',
          };
        }
      } else if (mode === 'reactive') {
        // Sequential per-character calls; each sees the previous character's response
        const maxResponses = options?.maxResponsesPerTurn ?? characters.length;
        const charsToRespond = characters.slice(0, maxResponses);

        for (const char of charsToRespond) {
          const userMsg: Message = {
            id: `${Date.now()}-user`,
            role: 'user',
            content,
            images,
            timestamp: Date.now(),
          };

          // Include prior group responses in the conversation history
          const historyWithPriorResponses = [
            ...assembledContext.messages,
            userMsg,
            ...messages,
          ];

          const result = await this.sendMessage(
            content,
            undefined,
            sessionId,
            images,
            historyWithPriorResponses,
          );

          if (result.success && result.data) {
            const charMessage: Message = {
              ...result.data,
              characterId: char.id,
            };
            respondingCharacterIds.push(char.id);
            messages.push(charMessage);
          }
          // Continue even if one character fails -- best-effort
        }
      } else if (mode === 'selective') {
        // Only addressed characters respond
        const addressedIds = options?.addressedCharacterIds ?? [];
        const charsToRespond = characters.filter((c) =>
          addressedIds.includes(c.id),
        );

        if (charsToRespond.length === 0) {
          return {
            success: false,
            error: 'No addressed characters specified for selective mode',
          };
        }

        for (const char of charsToRespond) {
          const userMsg: Message = {
            id: `${Date.now()}-user`,
            role: 'user',
            content,
            images,
            timestamp: Date.now(),
          };

          const historyWithPriorResponses = [
            ...assembledContext.messages,
            userMsg,
            ...messages,
          ];

          const result = await this.sendMessage(
            content,
            undefined,
            sessionId,
            images,
            historyWithPriorResponses,
          );

          if (result.success && result.data) {
            const charMessage: Message = {
              ...result.data,
              characterId: char.id,
            };
            respondingCharacterIds.push(char.id);
            messages.push(charMessage);
          }
        }
      }

      return {
        success: true,
        data: {
          messages,
          mode,
          respondingCharacterIds,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Group chat message failed',
      };
    }
  }

  // Helper method to check if provider is a local model
  private isLocalModelProvider(provider: string): boolean {
    const localProviders = [
      'koboldcpp',
      'llamacpp',
      'ollama',
      'sglang',
      'transformers',
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
    switch (this.aiConfig?.provider) {
      case 'openai':
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
      case 'gemini':
        return ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'];
      case 'qwen':
        return ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-7b', 'qwen-14b'];
      case 'prism-api':
        return [
          'gpt-3.5-turbo',
          'gpt-4',
          'gpt-4o',
          'gemini-pro',
          'gemini-1.5-pro',
          'qwen-max',
          'qwen-plus',
        ];
      case 'koboldcpp':
        return [
          'llama-2-7b',
          'llama-2-13b',
          'llama-2-70b',
          'mistral-7b',
          'mixtral-8x7b',
          'vicuna-7b',
          'vicuna-13b',
        ];
      case 'llamacpp':
        return [
          'llama-2-7b',
          'llama-2-13b',
          'llama-3-8b',
          'mistral-7b',
          'mixtral-8x7b',
          'phi-2',
          'gemma-2b',
          'gemma-7b',
        ];
      case 'ollama':
        return ['llama2', 'llama3', 'mistral', 'mixtral', 'gemma', 'phi'];
      case 'sglang':
        return [
          'llama-2-7b',
          'llama-2-13b',
          'llama-3-8b',
          'mistral-7b',
          'mixtral-8x7b',
        ];
      case 'transformers':
        return [
          'microsoft/DialoGPT-medium',
          'microsoft/DialoGPT-large',
          'facebook/blenderbot-400M-distill',
          'gpt2',
        ];
      case 'claude':
        return [
          'claude-3-5-sonnet-20241022',
          'claude-3-sonnet-20240229',
          'claude-3-opus-20240229',
          'claude-3-haiku-20240307',
        ];
      case 'deepseek':
        return ['deepseek-chat', 'deepseek-coder'];
      case 'grok':
        return ['grok-beta', 'grok-1', 'grok-1.5'];
      case 'openrouter':
        if (!this.aiService) {
          return [
            'openchat/openchat-7b',
            'neversleep/noromaid-mixtral-8x7b',
            'microsoft/wizardlm-2-8x22b',
          ];
        }
        return await (this.aiService as any).getOpenrouterModels();
      case 'poe':
        return ['poe', 'sage', 'dragonfruit', 'citrine'];
      default:
        return [];
    }
  }

  // Sync methods for chat history and configuration
  async syncMessages(
    messages: Message[],
  ): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found',
      };
    }

    try {
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
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
        body: JSON.stringify({ messages }),
      });

      return (await response.json()) as Promise<
        ApiResponse<{ message: string; count: number }>
      >;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync messages',
      };
    }
  }

  async syncSessions(
    sessions: ChatSession[],
  ): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found',
      };
    }

    try {
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
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
        body: JSON.stringify({ sessions }),
      });

      return (await response.json()) as Promise<
        ApiResponse<{ message: string; count: number }>
      >;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync sessions',
      };
    }
  }

  async syncPrompts(
    prompts: PromptShortcut[],
  ): Promise<ApiResponse<{ message: string; count: number }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found',
      };
    }

    try {
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
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
        body: JSON.stringify({ prompts }),
      });

      return (await response.json()) as Promise<
        ApiResponse<{ message: string; count: number }>
      >;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to sync prompts',
      };
    }
  }

  async getSyncedData(): Promise<
    ApiResponse<{
      messages: Message[];
      sessions: ChatSession[];
      prompts: PromptShortcut[];
    }>
  > {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found',
      };
    }

    try {
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
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
        headers,
      });

      return (await response.json()) as Promise<
        ApiResponse<{
          messages: Message[];
          sessions: ChatSession[];
          prompts: PromptShortcut[];
        }>
      >;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get synced data',
      };
    }
  }

  async clearSyncedData(): Promise<ApiResponse<{ message: string }>> {
    if (!this.prismApiUrl) {
      return {
        success: false,
        error: 'No API configuration found',
      };
    }

    try {
      // Get tokens from authentication providers - prioritize Supabase, then Firebase, then API key
      const supabase = await getSupabaseClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      let supabaseToken: string | null = null;
      if (!sessionError && session) {
        supabaseToken = session.access_token;
      }

      const firebaseToken = await getFirebaseIdToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
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
        headers,
      });

      return (await response.json()) as Promise<
        ApiResponse<{ message: string }>
      >;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to clear synced data',
      };
    }
  }

  async transcribeAudio(
    audioBlob: Blob,
  ): Promise<ApiResponse<AudioTranscriptionResponse>> {
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

  async textToSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<ApiResponse<Blob>> {
    try {
      if (!this.aiService) {
        return { success: false, error: 'AI service not initialized' };
      }

      const config = this.getAudioServiceConfig();
      const audioBlob = await this.aiService.textToSpeech(
        text,
        options || {},
        config,
      );
      return { success: true, data: audioBlob };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Text-to-speech failed',
      };
    }
  }

  private getAudioServiceConfig(): AudioServiceConfig {
    const config = this.aiConfig || ({} as AIConfig);
    return {
      apiKey: config.providerKeys?.['openai'] || config.apiKey || '',
      apiUrl: config.apiUrl || 'https://api.openai.com/v1',
      provider: config.provider,
    };
  }

  private capabilityResultToApiResponse<T>(result: Result<T>): ApiResponse<T> {
    if (result.ok) {
      return { success: true, data: result.value };
    }
    return { success: false, error: result.error };
  }

  async ocr(request: OCRRequest): Promise<ApiResponse<OCRResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.ocr(request),
      );
    }
    if (!this.ocrService) {
      return {
        success: false,
        error:
          'OCR service not initialized — use setCapabilityProvider("ocr", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.ocrService.recognize(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'OCR failed' };
    }
  }

  async stt(request: STTRequest): Promise<ApiResponse<STTResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.stt(request),
      );
    }
    if (!this.sttService) {
      return {
        success: false,
        error:
          'STT service not initialized — use setCapabilityProvider("stt", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.sttService.transcribe(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'STT failed' };
    }
  }

  async tts(request: TTSRequest): Promise<ApiResponse<TTSResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.tts(request),
      );
    }
    if (!this.ttsService) {
      return {
        success: false,
        error:
          'TTS service not initialized — use setCapabilityProvider("tts", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.ttsService.synthesize(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'TTS failed' };
    }
  }

  async inpaint(request: InpaintRequest): Promise<ApiResponse<InpaintResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.inpaint(request),
      );
    }
    if (!this.inpaintService) {
      return {
        success: false,
        error:
          'Inpaint service not initialized — use setCapabilityProvider("inpaint", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.inpaintService.inpaint(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'Inpaint failed' };
    }
  }

  async modelGen(
    request: ModelGenRequest,
  ): Promise<ApiResponse<ModelGenResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.modelGen(request),
      );
    }
    if (!this.modelGenService) {
      return {
        success: false,
        error:
          'Model-gen service not initialized — use setCapabilityProvider("model-gen", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.modelGenService.generate(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Model generation failed',
      };
    }
  }

  async audioGen(
    request: AudioGenRequest,
  ): Promise<ApiResponse<AudioGenResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.audioGen(request),
      );
    }
    if (!this.audioGenService) {
      return {
        success: false,
        error:
          'Audio-gen service not initialized — use setCapabilityProvider("audio-gen", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.audioGenService.generate(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Audio generation failed',
      };
    }
  }

  async videoGen(
    request: VideoGenRequest,
  ): Promise<ApiResponse<VideoGenResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.videoGen(request),
      );
    }
    if (!this.videoGenService) {
      return {
        success: false,
        error:
          'Video-gen service not initialized — use setCapabilityProvider("video-gen", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.videoGenService.generate(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Video generation failed',
      };
    }
  }

  async llm(request: LLMRequest): Promise<ApiResponse<LLMResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.llm(request),
      );
    }
    if (!this.llmService) {
      return {
        success: false,
        error:
          'LLM service not initialized — use setCapabilityProvider("llm", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.llmService.complete(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'LLM completion failed',
      };
    }
  }

  async agent(request: AgentRequest): Promise<ApiResponse<AgentResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.agent(request),
      );
    }
    if (!this.agentService) {
      return {
        success: false,
        error:
          'Agent service not initialized — use setCapabilityProvider("agent", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.agentService.run(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Agent execution failed',
      };
    }
  }

  async webSearch(
    request: WebSearchRequest,
  ): Promise<ApiResponse<WebSearchResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.webSearch(request),
      );
    }
    if (!this.webSearchService) {
      return {
        success: false,
        error:
          'Web-search service not initialized — use setCapabilityProvider("web-search", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.webSearchService.search(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'Web search failed' };
    }
  }

  async deepSearch(
    request: DeepSearchRequest,
  ): Promise<ApiResponse<DeepSearchResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.deepSearch(request),
      );
    }
    if (!this.deepSearchService) {
      return {
        success: false,
        error:
          'Deepsearch service not initialized — use setCapabilityProvider("deepsearch", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.deepSearchService.research(request),
      );
    } catch (error: any) {
      return { success: false, error: error.message || 'Deep search failed' };
    }
  }

  async council(
    request: CouncilRequest,
  ): Promise<ApiResponse<CouncilResponse>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.council(request),
      );
    }
    if (!this.councilService) {
      return {
        success: false,
        error:
          'Council service not initialized — use setCapabilityProvider("council", provider)',
      };
    }
    try {
      return this.capabilityResultToApiResponse(
        await this.councilService.deliberate(request),
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Council deliberation failed',
      };
    }
  }

  async multiSend(
    request: MultiSendRequest,
  ): Promise<ApiResponse<MultiSendResponse>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.multiSend(request),
      );
    }
    return {
      success: false,
      error:
        'Multi-send requires adapter router — initialize UnifiedAIClient with adapterConfig',
    };
  }

  multiSendToSwipes(response: MultiSendResponse): MessageSwipe[] {
    return response.responses
      .filter((r) => !r.error && r.content)
      .map((r, i) => ({
        id: `ms_${Date.now()}_${i}`,
        content: r.content,
        tokens: r.tokensUsed,
        selected: i === 0,
      }));
  }

  async debate(request: DebateRequest): Promise<ApiResponse<DebateResult>> {
    if (this.adapterRouter) {
      return this.capabilityResultToApiResponse(
        await this.adapterRouter.debate(request),
      );
    }
    return {
      success: false,
      error:
        'Debate requires adapter router — initialize UnifiedAIClient with adapterConfig',
    };
  }

  debateToMessages(result: DebateResult): Message[] {
    return result.turns
      .filter((t) => !t.error && t.content)
      .map((t, i) => ({
        id: `debate_${Date.now()}_${i}`,
        role: 'assistant' as const,
        content: `**${t.participant.label || t.participant.provider}**: ${t.content}`,
        timestamp: Date.now(),
      }));
  }
}
