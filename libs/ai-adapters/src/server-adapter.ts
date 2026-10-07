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

type CapabilityRequest = OCRRequest | STTRequest | TTSRequest | InpaintRequest | ModelGenRequest | AudioGenRequest | VideoGenRequest | LLMRequest | AgentRequest | WebSearchRequest | DeepSearchRequest | CouncilRequest | MultiSendRequest | DebateRequest;
type CapabilityResult = OCRResult | STTResult | TTSResult | InpaintResult | ModelGenResult | AudioGenResult | VideoGenResult | LLMResult | AgentResult | WebSearchResult | DeepSearchResult | CouncilResponse | MultiSendResponse | DebateResult;

const CAPABILITY_ENDPOINTS: Record<string, string> = {
  ocr: '/api/ai/ocr',
  stt: '/api/ai/stt',
  tts: '/api/ai/tts',
  inpaint: '/api/ai/inpaint',
  'model-gen': '/api/ai/model-gen',
  'audio-gen': '/api/ai/audio-gen',
  'video-gen': '/api/ai/video-gen',
  llm: '/api/ai/llm',
  agent: '/api/ai/agent',
  'web-search': '/api/ai/web-search',
  deepsearch: '/api/ai/deepsearch',
  council: '/api/ai/council',
  'multi-send': '/api/ai/multi-send',
  debate: '/api/ai/debate',
};

export class ServerAdapter implements AIAdapter {
  readonly mode: AIMode = 'server';
  private baseUrl: string;
  private authToken?: string;
  private apiKey?: string;
  private providerOverrides: Partial<Record<AICapability, { provider: string; config?: Partial<ServiceConfig> }>> = {};

  constructor(config: AdapterConfig) {
    this.baseUrl = config.prismApiUrl || '';
    this.authToken = config.authToken;
    this.apiKey = config.prismApiKey;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  setProvider(capability: AICapability, provider: string, config?: Partial<ServiceConfig>): void {
    this.providerOverrides[capability] = { provider, config };
  }

  private async call<C extends AICapability>(
    capability: C,
    request: CapabilityRequest,
  ): Promise<Result<CapabilityResult>> {
    if (!this.baseUrl) {
      return { ok: false, error: 'Server mode requires prismApiUrl — set it in AIConfig or AdapterConfig' };
    }

    const endpoint = CAPABILITY_ENDPOINTS[capability];
    if (!endpoint) {
      return { ok: false, error: `No server endpoint for capability "${capability}"` };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    } else if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const override = this.providerOverrides[capability];
    const body = {
      capability,
      request,
      ...(override ? { provider: override.provider, providerConfig: override.config } : {}),
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorMsg = `Server returned ${response.status}`;
        try {
          const errBody = await response.json() as Record<string, unknown>;
          errorMsg = (errBody.error as string) || (errBody.message as string) || errorMsg;
        } catch { /* response body not JSON */ }
        return { ok: false, error: errorMsg };
      }

      const data = await response.json() as Record<string, unknown>;
      if (data.ok === true && 'value' in data) {
        return data as unknown as Result<CapabilityResult>;
      }
      return { ok: true, value: data as unknown as CapabilityResult };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Server adapter error: ${msg}` };
    }
  }

  ocr(request: OCRRequest): Promise<Result<OCRResult>> { return this.call('ocr', request) as Promise<Result<OCRResult>>; }
  stt(request: STTRequest): Promise<Result<STTResult>> { return this.call('stt', request) as Promise<Result<STTResult>>; }
  tts(request: TTSRequest): Promise<Result<TTSResult>> { return this.call('tts', request) as Promise<Result<TTSResult>>; }
  inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> { return this.call('inpaint', request) as Promise<Result<InpaintResult>>; }
  modelGen(request: ModelGenRequest): Promise<Result<ModelGenResult>> { return this.call('model-gen', request) as Promise<Result<ModelGenResult>>; }
  audioGen(request: AudioGenRequest): Promise<Result<AudioGenResult>> { return this.call('audio-gen', request) as Promise<Result<AudioGenResult>>; }
  videoGen(request: VideoGenRequest): Promise<Result<VideoGenResult>> { return this.call('video-gen', request) as Promise<Result<VideoGenResult>>; }
  llm(request: LLMRequest): Promise<Result<LLMResult>> { return this.call('llm', request) as Promise<Result<LLMResult>>; }
  agent(request: AgentRequest): Promise<Result<AgentResult>> { return this.call('agent', request) as Promise<Result<AgentResult>>; }
  webSearch(request: WebSearchRequest): Promise<Result<WebSearchResult>> { return this.call('web-search', request) as Promise<Result<WebSearchResult>>; }
  deepSearch(request: DeepSearchRequest): Promise<Result<DeepSearchResult>> { return this.call('deepsearch', request) as Promise<Result<DeepSearchResult>>; }
  council(request: CouncilRequest): Promise<Result<CouncilResponse>> { return this.call('council', request) as Promise<Result<CouncilResponse>>; }
  multiSend(request: MultiSendRequest): Promise<Result<MultiSendResponse>> { return this.call('multi-send' as AICapability, request) as Promise<Result<MultiSendResponse>>; }
  debate(request: DebateRequest): Promise<Result<DebateResult>> { return this.call('debate' as AICapability, request) as Promise<Result<DebateResult>>; }
}
