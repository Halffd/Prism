import {
  loadCore,
  applyThinking,
  stripThinking,
  buildStreamBody,
  buildOllamaBody,
  parseModels,
  streamSseText,
  findProvider,
  type WasmCore,
  type WireMessage,
  type ChatConfig,
} from '@prism/ai-core';
import {
  Message,
  ContextData,
  ApiResponse,
  AIConfig,
  ChatSession,
  PromptShortcut,
  AICapability,
  ServiceConfig,
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
  hasActiveCustomModel,
  resolveRequestConfig,
} from '@prism/shared-types';
import { AIFactory } from '@prism/ai-factory';
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

/** Providers that answer on the user's own machine; they get the
 *  warmer default temperature. */
const LOCAL_PROVIDERS = new Set([
  'ollama',
  'llamacpp',
  'sglang',
  'koboldcpp',
  'transformers',
]);

export class UnifiedAIClient {
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
  private core?: WasmCore;
  private corePromise?: Promise<WasmCore | null>;

  constructor(options: UnifiedAIClientOptions = {}) {
    // A selected custom model is resolved right here, so that the client
    // addresses the user's own endpoint no matter how it was constructed.
    this.aiConfig = options.aiConfig
      ? resolveRequestConfig(options.aiConfig)
      : undefined;
    this.prismApiUrl = options.prismApiUrl;
    this.prismApiKey = options.prismApiKey;

    // Update the network status service with the API URL if provided
    if (this.prismApiUrl) {
      networkStatusService.updateApiUrl(this.prismApiUrl);
    }

    if (this.aiConfig) {
      // Ensure proper configuration for local providers
      const configForService = this.prepareConfigForService(this.aiConfig);
      this.initCapabilityServices(configForService);
    }
  }

  /** The core wasm, loaded once per client. A host that cannot
   *  instantiate it (no wasm support, blocked asset) falls back to the
   *  hosted API instead of the local-model path. */
  private async ensureCore(): Promise<WasmCore | null> {
    if (!this.corePromise) {
      this.corePromise = loadCore()
        .then((core) => {
          this.core = core;
          return core;
        })
        .catch((e) => {
          console.warn('core wasm unavailable, using hosted API:', e);
          return null;
        });
    }
    return this.corePromise;
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
  }

  /** Host configuration -> the core's request config. The endpoint
   *  travels as `baseUrl` (a custom model's own URL or a local
   *  server's URL) and the bearer token as `apiKey`; the core only
   *  sees the resolved target, never the provider's UI settings. */
  private toCoreConfig(config: AIConfig): ChatConfig {
    const provider = config.provider as string;
    return {
      provider,
      model: config.model,
      apiKey: config.providerKeys?.[config.provider] || config.apiKey || '',
      baseUrl: (config.localApiUrl || config.apiUrl || '').trim(),
      localBaseUrl: config.localApiUrl,
      // The core requires a temperature; local servers get the warmer
      // default, hosted providers the cooler one.
      temperature:
        config.temperature ?? (LOCAL_PROVIDERS.has(provider) ? 0.8 : 0.7),
      maxTokens: config.maxTokens ?? null,
      topP: config.topP ?? null,
      frequencyPenalty: config.frequencyPenalty ?? null,
      presencePenalty: config.presencePenalty ?? null,
      thinkingMode: config.thinkingMode ?? null,
    };
  }

  /** Core-owned chat completion: body built by the core wasm, HTTP
   *  driven here, bytes decoded by the core SSE decoder. */
  private async coreChatCompletion(request: {
    messages: Message[];
    context?: ContextData;
    config: AIConfig;
  }): Promise<{
    content: string;
    thinking?: string;
    tokensUsed?: number;
  }> {
    const core = await this.ensureCore();
    if (!core) {
      throw new Error('core wasm unavailable');
    }
    // The endpoint travels with the request: a custom model's own URL,
    // a local server's URL, or the provider table's default.
    const cfg = this.toCoreConfig(request.config);
    if (!cfg.model) {
      cfg.model = findProvider(core, cfg.provider)?.default_model ?? '';
    }
    const provider = cfg.provider;
    const isOllama = provider === 'ollama';
    let messages: WireMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
    }));
    const thinking = cfg.thinkingMode?.enabled === true;
    if (thinking) messages = applyThinking(core, messages);

    // Ollama speaks its native API; everything else is
    // OpenAI-compatible.
    const ollamaRoot = core.ollama_root_url(
      cfg.localBaseUrl || 'http://localhost:11434',
    );
    const base = isOllama
      ? ollamaRoot
      : (cfg.baseUrl ||
          findProvider(core, provider)?.base_url ||
          'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = isOllama
      ? `${base}/api/chat`
      : `${base}/chat/completions`;
    const apiKey = (cfg.apiKey ?? '').trim();
    const body = isOllama
      ? buildOllamaBody(core, {
          base_url: base,
          model: cfg.model ?? '',
          temperature: cfg.temperature,
          messages,
          max_tokens: cfg.maxTokens,
        })
      : buildStreamBody(core, {
          base_url: base,
          api_key: apiKey,
          model: cfg.model ?? '',
          temperature: cfg.temperature,
          max_tokens: cfg.maxTokens,
          top_p: cfg.topP,
          frequency_penalty: cfg.frequencyPenalty,
          presence_penalty: cfg.presencePenalty,
          messages,
        });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isOllama && apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${provider} HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    let content = '';
    for await (const ev of streamSseText(core, resp.body as ReadableStream<Uint8Array>)) {
      content += ev.delta;
    }

    if (thinking) {
      const [clean, reasoning] = stripThinking(core, content);
      return { content: clean, thinking: reasoning ?? undefined };
    }
    return { content };
  }

  /** Model list for a provider via the OpenAI-compatible /models endpoint. */
  private async coreGetModels(providerId?: string): Promise<string[]> {
    const core = await this.ensureCore();
    if (!core) {
      return [];
    }
    const provider = providerId ?? (this.aiConfig?.provider as string | undefined) ?? 'openai';
    const def = findProvider(core, provider);
    if (!def) return [];
    const apiKey = (this.aiConfig?.apiKey ?? '').trim();
    const resp = await fetch(`${def.base_url}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!resp.ok) return [];
    return parseModels(core, await resp.text());
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
    const core = await this.ensureCore();
    if (core && this.aiConfig) {
      try {
        // Check if provider is a local model or if we're offline
        const isLocalProvider = this.isLocalModelProvider(
          this.aiConfig.provider,
        );
        // A custom model is addressed at the user's own endpoint, which the
        // AI service talks to directly. It must not be sent to the Prism
        // API instead, even when the browser is online.
        const isCustomModel = hasActiveCustomModel(this.aiConfig);
        const shouldUseLocal = isLocalProvider || isCustomModel || !isOnline;

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

          const request = {
            messages: messagesToSend,
            context,
            config: this.aiConfig,
          };

          const startTime = Date.now();
          const response = await this.coreChatCompletion(request);
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
    if (core && this.aiConfig) {
      try {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content,
          images,
          context,
          timestamp: Date.now(),
        };

        const request = {
          messages: [userMessage],
          context,
          config: this.aiConfig,
        };

        const response = await this.coreChatCompletion(request);

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
    // A selected custom model is resolved here, so that the request is
    // addressed at the user's own endpoint instead of the hosted provider
    // that happens to be selected in the provider list.
    const resolvedConfig = resolveRequestConfig(config);
    this.aiConfig = resolvedConfig;
    if (!this.core) {
      void this.ensureCore();
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
    const core = await this.ensureCore();
    if (core) {
      return await this.coreGetModels();
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
          'llama-3.2-3b',
          'llama-3.2-1b',
          'llama-3.1-8b',
          'llama-3.3-70b',
          'mistral-7b',
          'mixtral-8x7b',
          'phi-3.5-mini',
          'gemma-2-9b',
          'gemma-2-27b',
        ];
      case 'llamacpp':
        return [
          'llama-3.2-3b',
          'llama-3.2-1b',
          'llama-3.1-8b',
          'llama-3.3-70b',
          'mistral-7b',
          'mixtral-8x7b',
          'phi-3.5-mini',
          'gemma-2-9b',
          'gemma-2-27b',
        ];
      case 'ollama':
        return [
          'llama3.2',
          'llama3.1',
          'llama3.2:3b',
          'llama3.2:1b',
          'qwen2.5',
          'qwen2.5:7b',
          'qwen2.5:3b',
          'mistral',
          'mixtral',
          'gemma2',
          'phi3.5',
          'phi3.5:mini',
        ];
      case 'sglang':
        return [
          'llama-3.2-3b',
          'llama-3.2-1b',
          'llama-3.1-8b',
          'llama-3.3-70b',
          'mistral-7b',
          'mixtral-8x7b',
          'phi-3.5-mini',
          'gemma-2-9b',
          'gemma-2-27b',
        ];
      case 'transformers':
        return [
          'microsoft/Phi-3.5-mini-instruct',
          'microsoft/Phi-3-mini-4k-instruct',
          'microsoft/Phi-3-medium-4k-instruct',
          'Qwen/Qwen2.5-1.5B-Instruct',
          'Qwen/Qwen2.5-7B-Instruct',
          'Qwen/Qwen2.5-32B-Instruct',
          'google/gemma-2-2b-it',
          'google/gemma-2-9b-it',
        ];
      case 'claude':
        return [
          'claude-opus-5-5',
          'claude-sonnet-5-5',
          'claude-haiku-5-5',
          'claude-fable-5-1',
          'claude-fable-5',
          'claude-opus-5',
          'claude-opus-4-8',
          'claude-opus-4-7',
          'claude-opus-4-6',
          'claude-opus-4-5',
          'claude-sonnet-5',
          'claude-sonnet-4-6',
          'claude-haiku-4-5',
        ];
      case 'deepseek':
        return ['deepseek-v3', 'deepseek-reasoner'];
      case 'grok':
        return ['grok-3', 'grok-2'];
      case 'openrouter':
        if (!core) {
          return [
            'openchat/openchat-7b',
            'neversleep/noromaid-mixtral-8x7b',
            'microsoft/wizardlm-2-8x22b',
          ];
        }
        return await this.coreGetModels('openrouter');
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

  /** Speech-to-text via the dedicated STT capability service. */
  async transcribeAudio(
    audio: Blob,
    language?: string,
    mimeType?: string,
  ): Promise<ApiResponse<{ text: string }>> {
    if (!this.sttService) {
      return {
        success: false,
        error:
          'STT service not initialized — use setCapabilityProvider("stt", provider)',
      };
    }
    try {
      const result = await this.sttService.transcribe({
        audio,
        ...(language ? { language } : {}),
        ...(mimeType ? { mimeType } : {}),
      });
      return this.capabilityResultToApiResponse(result);
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transcription failed',
      };
    }
  }

  /** Text-to-speech via the dedicated TTS capability service. */
  async textToSpeech(
    text: string,
    options?: {
      voice?: string;
      speed?: number;
      model?: string;
      responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
    },
  ): Promise<ApiResponse<{ audio: Blob; format: string }>> {
    if (!this.ttsService) {
      return {
        success: false,
        error:
          'TTS service not initialized — use setCapabilityProvider("tts", provider)',
      };
    }
    try {
      const result = await this.ttsService.synthesize({ text, ...(options ?? {}) });
      return this.capabilityResultToApiResponse(result);
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Text-to-speech failed',
      };
    }
  }

  private capabilityResultToApiResponse<T>(result: Result<T>): ApiResponse<T> {
    if (result.ok) {
      return { success: true, data: result.value };
    }
    return { success: false, error: result.error };
  }

  async ocr(request: OCRRequest): Promise<ApiResponse<OCRResult>> {
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
