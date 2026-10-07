import type {
  AIMode,
  AICapability,
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

export type { AIMode, AdapterConfig, LocalSearchProvider } from '@prism/shared-types';

export interface AIAdapter {
  readonly mode: AIMode;
  ocr(request: OCRRequest): Promise<Result<OCRResult>>;
  stt(request: STTRequest): Promise<Result<STTResult>>;
  tts(request: TTSRequest): Promise<Result<TTSResult>>;
  inpaint(request: InpaintRequest): Promise<Result<InpaintResult>>;
  modelGen(request: ModelGenRequest): Promise<Result<ModelGenResult>>;
  audioGen(request: AudioGenRequest): Promise<Result<AudioGenResult>>;
  videoGen(request: VideoGenRequest): Promise<Result<VideoGenResult>>;
  llm(request: LLMRequest): Promise<Result<LLMResult>>;
  agent(request: AgentRequest): Promise<Result<AgentResult>>;
  webSearch(request: WebSearchRequest): Promise<Result<WebSearchResult>>;
  deepSearch(request: DeepSearchRequest): Promise<Result<DeepSearchResult>>;
  council(request: CouncilRequest): Promise<Result<CouncilResponse>>;
  multiSend(request: MultiSendRequest): Promise<Result<MultiSendResponse>>;
  debate(request: DebateRequest): Promise<Result<DebateResult>>;
  setProvider(capability: AICapability, provider: string, config?: Partial<ServiceConfig>): void;
}

export { DirectAPIAdapter } from './direct-api-adapter';
export { ServerAdapter } from './server-adapter';
export { LocalAdapter } from './local-adapter';
export { AdapterRouter } from './adapter-router';
