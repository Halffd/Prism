import type {
  AIConfig,
  AIMode,
  AICapability,
  Message,
  AdapterConfig,
  ServiceConfig,
  LocalSearchProvider,
  HardwareProfile,
  WebSearchRequest,
  WebSearchResult,
  DeepSearchRequest,
  DeepSearchResult,
  DeepSearchPhase,
  CouncilRequest,
  CouncilResponse,
  CouncilMember,
  MultiSendRequest,
  MultiSendResponse,
  MultiSendTarget,
  DebateRequest,
  DebateResult,
  DebateParticipant,
  AgentRequest,
  AgentResult,
  Result,
} from '@prism/shared-types';
import { AdapterRouter } from '@prism/ai-adapters';
import { coreChat, type CoreConnection } from './core-llm';
import { providerEnvKey } from './provider-env';
import { nanoid } from 'nanoid';

export interface TUIClientConfig {
  aiConfig: AIConfig;
  adapterMode: AIMode;
  capabilityModes: Partial<Record<AICapability, AIMode>>;
  localApiUrl?: string;
  localSearchProvider?: LocalSearchProvider;
  searxngUrl?: string;
  /** Hardware profile forwarded to the local adapter. */
  hardware?: HardwareProfile;
  prismApiUrl?: string;
  prismApiKey?: string;
}

export class TUIClient {
  private aiConfig: AIConfig;
  private adapterRouter: AdapterRouter;
  private adapterMode: AIMode;
  private capabilityModes: Partial<Record<AICapability, AIMode>>;
  private localApiUrl?: string;
  private hardware?: HardwareProfile;
  private prismApiUrl?: string;
  private prismApiKey?: string;

  constructor(config: TUIClientConfig) {
    this.aiConfig = config.aiConfig;
    this.adapterMode = config.adapterMode;
    this.capabilityModes = config.capabilityModes;
    this.localApiUrl = config.localApiUrl;
    this.hardware = config.hardware;
    this.prismApiUrl = config.prismApiUrl;
    this.prismApiKey = config.prismApiKey;

    const serviceConfig: ServiceConfig = {
      apiKey: resolveProviderKey(
        (config.aiConfig.providerKeys ?? {})[config.aiConfig.provider],
        config.aiConfig.provider,
      ),
      apiUrl: config.aiConfig.apiUrl,
      model: config.aiConfig.model,
      provider: config.aiConfig.provider,
    };

    const adapterConfig: AdapterConfig = {
      mode: this.adapterMode,
      prismApiUrl: config.prismApiUrl,
      prismApiKey: config.prismApiKey,
      localApiUrl: config.localApiUrl,
      localSearchProvider: config.localSearchProvider,
      searxngUrl: config.searxngUrl,
      providerKeys: config.aiConfig.providerKeys,
      hardware: config.hardware,
    };

    this.adapterRouter = new AdapterRouter(serviceConfig, adapterConfig);

    for (const [cap, mode] of Object.entries(this.capabilityModes)) {
      if (mode) {
        this.adapterRouter.setCapabilityMode(cap as AICapability, mode);
      }
    }
  }

  async chat(messages: Message[]): Promise<Message> {
    const connection: CoreConnection =
      this.adapterMode === 'server'
        ? 'server'
        : this.adapterMode === 'local'
          ? 'local'
          : 'api';

    let fullContent: string;
    try {
      fullContent = await coreChat({
        connection,
        provider: this.aiConfig.provider,
        apiKey: resolveProviderKey(
          (this.aiConfig.providerKeys ?? {})[this.aiConfig.provider] ??
            this.aiConfig.apiKey,
          this.aiConfig.provider,
        ),
        model: this.aiConfig.model || 'gpt-3.5-turbo',
        temperature: this.aiConfig.temperature ?? 0.7,
        maxTokens: this.aiConfig.maxTokens ?? 2048,
        apiUrl: this.aiConfig.apiUrl,
        localApiUrl: this.localApiUrl,
        hardware: this.hardware,
        prismApiUrl: this.prismApiUrl,
        prismApiKey: this.prismApiKey,
        messages: messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      });
    } catch (error: unknown) {
      fullContent = `[Error: ${error instanceof Error ? error.message : String(error)}]`;
    }

    return {
      id: `msg_${nanoid()}`,
      role: 'assistant',
      content: fullContent,
      timestamp: Date.now(),
    };
  }

  async webSearch(
    query: string,
    maxResults = 5,
  ): Promise<Result<WebSearchResult>> {
    const request: WebSearchRequest = { query, maxResults };
    return this.adapterRouter.webSearch(request);
  }

  async deepSearch(
    query: string,
    onPhaseUpdate?: (phase: DeepSearchPhase) => void,
  ): Promise<Result<DeepSearchResult>> {
    const request: DeepSearchRequest = {
      query,
      maxDepth: 3,
      maxSearches: 5,
      maxExtractions: 8,
      onPhaseUpdate,
    };
    return this.adapterRouter.deepSearch(request);
  }

  async council(
    query: string,
    members: CouncilMember[],
    votingStrategy?: 'single-judge' | 'peer-vote' | 'consensus',
  ): Promise<Result<CouncilResponse>> {
    const request: CouncilRequest = {
      prompt: query,
      members,
      votingStrategy: votingStrategy ?? 'single-judge',
      judgeProvider: this.aiConfig.provider,
      judgeModel: this.aiConfig.model,
    };
    return this.adapterRouter.council(request);
  }

  async multiSend(
    query: string,
    targets: MultiSendTarget[],
    conversationHistory?: Message[],
  ): Promise<Result<MultiSendResponse>> {
    const request: MultiSendRequest = {
      prompt: query,
      targets,
      conversationHistory,
      systemPrompt: this.aiConfig.systemPrompt,
    };
    return this.adapterRouter.multiSend(request);
  }

  async debate(
    topic: string,
    participants: DebateParticipant[],
    mode: 'dual' | 'group' = 'dual',
    maxTurns?: number,
    onTurnUpdate?: (
      turn: import('@prism/shared-types').DebateTurn,
      turnIndex: number,
      totalTurns: number,
    ) => void,
  ): Promise<Result<DebateResult>> {
    const request: DebateRequest = {
      topic,
      participants,
      mode,
      maxTurns: maxTurns ?? (mode === 'dual' ? 6 : participants.length * 2),
      systemPrompt: this.aiConfig.systemPrompt,
      onTurnUpdate,
    };
    return this.adapterRouter.debate(request);
  }

  async agent(request: AgentRequest): Promise<Result<AgentResult>> {
    return this.adapterRouter.agent(request);
  }

  updateConfig(config: Partial<TUIClientConfig>) {
    if (config.aiConfig) this.aiConfig = config.aiConfig;
    if (config.adapterMode) this.adapterMode = config.adapterMode;
    if (config.capabilityModes) this.capabilityModes = config.capabilityModes;
    if (config.hardware) this.adapterRouter.updateHardware(config.hardware);
  }
}

export function createTUIClient(config: TUIClientConfig): TUIClient {
  return new TUIClient(config);
}
