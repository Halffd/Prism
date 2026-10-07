import type {
  AIMode,
  AICapability,
  AdapterConfig,
  ServiceConfig,
  Result,
  OCRRequest,
  OCRResult,
  STTRequest,
  STTResult,
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
} from '@prism/shared-types';
import type { AIAdapter } from './index';
import { DirectAPIAdapter } from './direct-api-adapter';
import { ServerAdapter } from './server-adapter';
import { LocalAdapter } from './local-adapter';

type CapabilityMethod = 'ocr' | 'stt' | 'tts' | 'inpaint' | 'modelGen' | 'audioGen' | 'videoGen' | 'llm' | 'agent' | 'webSearch' | 'deepSearch' | 'council' | 'multiSend' | 'debate';

export class AdapterRouter implements AIAdapter {
  readonly mode: AIMode;
  private adapters: Record<AIMode, AIAdapter>;
  private defaultMode: AIMode;
  private capabilityModes: Partial<Record<AICapability, AIMode>> = {};

  constructor(
    serviceConfig: ServiceConfig,
    adapterConfig: AdapterConfig,
  ) {
    this.defaultMode = adapterConfig.mode || 'api';
    this.mode = this.defaultMode;

    const localProvider = (adapterConfig.localApiUrl || serviceConfig.provider === 'ollama' || serviceConfig.provider === 'koboldcpp' || serviceConfig.provider === 'llamacpp' || serviceConfig.provider === 'sglang')
      ? serviceConfig.provider as 'ollama' | 'llamacpp' | 'koboldcpp' | 'sglang'
      : 'ollama';

    this.adapters = {
      api: new DirectAPIAdapter(serviceConfig),
      server: new ServerAdapter(adapterConfig),
      local: new LocalAdapter({ ...adapterConfig, localProvider }),
    };
  }

  setMode(mode: AIMode): void {
    this.defaultMode = mode;
  }

  setCapabilityMode(capability: AICapability, mode: AIMode): void {
    this.capabilityModes[capability] = mode;
  }

  getAdapter(capability: AICapability): AIAdapter {
    const mode = this.capabilityModes[capability] || this.defaultMode;
    return this.adapters[mode];
  }

  setProvider(capability: AICapability, provider: string, config?: Partial<ServiceConfig>): void {
    const mode = this.capabilityModes[capability] || this.defaultMode;
    this.adapters[mode].setProvider(capability, provider, config);
  }

  updateServerAuth(token: string): void {
    (this.adapters.server as ServerAdapter).setAuthToken(token);
  }

  updateSearchProvider(provider: string, searxngUrl?: string): void {
    (this.adapters.local as LocalAdapter).setSearchProvider(provider as 'duckduckgo' | 'searxng', searxngUrl);
  }

  updateLocalModel(model: string): void {
    (this.adapters.local as LocalAdapter).setModel(model);
  }

  private async call<C extends AICapability>(
    capability: C,
    method: CapabilityMethod,
    request: unknown,
  ): Promise<Result<unknown>> {
    const adapter = this.getAdapter(capability);
    const fn = (adapter as unknown as Record<string, (...args: unknown[]) => Promise<Result<unknown>>>)[method];
    if (!fn) {
      return { ok: false, error: `No method "${method}" on adapter mode "${this.mode}"` };
    }
    return fn.call(adapter, request);
  }

  async ocr(request: OCRRequest): Promise<Result<OCRResult>> { return this.call('ocr', 'ocr', request) as Promise<Result<OCRResult>>; }
  async stt(request: STTRequest): Promise<Result<STTResult>> { return this.call('stt', 'stt', request) as Promise<Result<STTResult>>; }
  async tts(request: TTSRequest): Promise<Result<TTSResult>> { return this.call('tts', 'tts', request) as Promise<Result<TTSResult>>; }
  async inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> { return this.call('inpaint', 'inpaint', request) as Promise<Result<InpaintResult>>; }
  async modelGen(request: ModelGenRequest): Promise<Result<ModelGenResult>> { return this.call('model-gen', 'modelGen', request) as Promise<Result<ModelGenResult>>; }
  async audioGen(request: AudioGenRequest): Promise<Result<AudioGenResult>> { return this.call('audio-gen', 'audioGen', request) as Promise<Result<AudioGenResult>>; }
  async videoGen(request: VideoGenRequest): Promise<Result<VideoGenResult>> { return this.call('video-gen', 'videoGen', request) as Promise<Result<VideoGenResult>>; }
  async llm(request: LLMRequest): Promise<Result<LLMResult>> { return this.call('llm', 'llm', request) as Promise<Result<LLMResult>>; }
  async agent(request: AgentRequest): Promise<Result<AgentResult>> { return this.call('agent', 'agent', request) as Promise<Result<AgentResult>>; }
  async webSearch(request: WebSearchRequest): Promise<Result<WebSearchResult>> { return this.call('web-search', 'webSearch', request) as Promise<Result<WebSearchResult>>; }
  async deepSearch(request: DeepSearchRequest): Promise<Result<DeepSearchResult>> { return this.call('deepsearch', 'deepSearch', request) as Promise<Result<DeepSearchResult>>; }
  async council(request: CouncilRequest): Promise<Result<CouncilResponse>> { return this.call('council', 'council', request) as Promise<Result<CouncilResponse>>; }
  async multiSend(request: MultiSendRequest): Promise<Result<MultiSendResponse>> { return this.call('llm', 'multiSend', request) as Promise<Result<MultiSendResponse>>; }
  async debate(request: DebateRequest): Promise<Result<DebateResult>> { return this.call('llm', 'debate', request) as Promise<Result<DebateResult>>; }
}
