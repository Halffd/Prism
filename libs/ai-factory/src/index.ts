import type { AICapability, ServiceConfig } from '@prism/shared-types';
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
import {
  OpenAIOCRService,
  GeminiOCRService,
  ClaudeOCRService,
  GroqOCRService,
  DeepSeekOCRService,
  QwenOCRService,
  MistralOCRSService,
  OpenRouterOCRService,
} from '@prism/ocr';
import {
  OpenAISTTService,
  GeminiSTTService,
  GroqSTTService,
  DeepSeekSTTService,
  FireworksSTTService,
} from '@prism/stt';
import {
  OpenAITTSService,
  ElevenLabsTTSService,
  GroqTTSService,
  DeepSeekTTSService,
  FireworksTTSService,
  MistralTTSService,
} from '@prism/tts';
import {
  StabilityInpaintService,
  HuggingFaceInpaintService,
  FireworksInpaintService,
} from '@prism/inpaint';
import { MeshyModelGenService, TripoModelGenService } from '@prism/model-gen';
import {
  ElevenLabsAudioGenService,
  StabilityAudioGenService,
  HuggingFaceAudioGenService,
} from '@prism/audio-gen';
import {
  RunwayVideoGenService,
  KlingVideoGenService,
  LumaVideoGenService,
} from '@prism/video-gen';
import {
  OpenAILLMService,
  ClaudeLLMService,
  GeminiLLMService,
  GroqLLMService,
  DeepSeekLLMService,
  GrokLLMService,
  OpenRouterLLMService,
  PoeLLMService,
  NvidiaNimLLMService,
  CerebrasLLMService,
  CloudflareWorkersLLMService,
  FireworksLLMService,
  ZaiLLMService,
  QwenLLMService,
  TransformersLLMService,
  MistralLLMService,
  CohereLLMService,
  TogetherLLMService,
  PerplexityLLMService,
} from '@prism/llm';
import {
  OpenAIAgentService,
  ClaudeAgentService,
  GeminiAgentService,
  GroqAgentService,
  DeepSeekAgentService,
  GrokAgentService,
  OpenRouterAgentService,
  PoeAgentService,
  NvidiaNimAgentService,
  CerebrasAgentService,
  CloudflareWorkersAgentService,
  FireworksAgentService,
  ZaiAgentService,
  QwenAgentService,
  TransformersAgentService,
  MistralAgentService,
  CohereAgentService,
  TogetherAgentService,
  PerplexityAgentService,
} from '@prism/agent';
import {
  BraveSearchService,
  GoogleSearchService,
  SearXNGSearchService,
  TavilySearchService,
  SerperSearchService,
  BingSearchService,
  DuckDuckGoSearchService,
  JinaSearchService,
  PerplexitySearchService,
} from '@prism/web-search';
import { ReActDeepSearchService } from '@prism/deepsearch';
import {
  OpenAICouncilService,
  ClaudeCouncilService,
  GeminiCouncilService,
  GroqCouncilService,
  DeepSeekCouncilService,
  GrokCouncilService,
  OpenRouterCouncilService,
  PoeCouncilService,
  NvidiaNimCouncilService,
  CerebrasCouncilService,
  CloudflareWorkersCouncilService,
  FireworksCouncilService,
  ZaiCouncilService,
  QwenCouncilService,
  TransformersCouncilService,
  MistralCouncilService,
  CohereCouncilService,
  TogetherCouncilService,
  PerplexityCouncilService,
} from '@prism/council';

export type AIServiceType<T extends AICapability> = T extends 'ocr'
  ? OCRService
  : T extends 'stt'
    ? STTService
    : T extends 'tts'
      ? TTSService
      : T extends 'inpaint'
        ? InpaintService
        : T extends 'model-gen'
          ? ModelGenService
          : T extends 'audio-gen'
            ? AudioGenService
            : T extends 'video-gen'
              ? VideoGenService
              : T extends 'llm'
                ? LLMService
                : T extends 'agent'
                  ? AgentService
                  : T extends 'web-search'
                    ? WebSearchService
                    : T extends 'deepsearch'
                      ? DeepSearchService
                      : T extends 'council'
                        ? CouncilService
                        : never;

interface ServiceFactory<T> {
  create(config: ServiceConfig): T;
}

const ocrFactories: Record<string, ServiceFactory<OCRService>> = {
  openai: { create: (c) => new OpenAIOCRService(c) },
  gemini: { create: (c) => new GeminiOCRService(c) },
  claude: { create: (c) => new ClaudeOCRService(c) },
  groq: { create: (c) => new GroqOCRService(c) },
  deepseek: { create: (c) => new DeepSeekOCRService(c) },
  qwen: { create: (c) => new QwenOCRService(c) },
  mistral: { create: (c) => new MistralOCRSService(c) },
  openrouter: { create: (c) => new OpenRouterOCRService(c) },
};

const sttFactories: Record<string, ServiceFactory<STTService>> = {
  openai: { create: (c) => new OpenAISTTService(c) },
  gemini: { create: (c) => new GeminiSTTService(c) },
  groq: { create: (c) => new GroqSTTService(c) },
  deepseek: { create: (c) => new DeepSeekSTTService(c) },
  fireworks: { create: (c) => new FireworksSTTService(c) },
};

const ttsFactories: Record<string, ServiceFactory<TTSService>> = {
  openai: { create: (c) => new OpenAITTSService(c) },
  elevenlabs: { create: (c) => new ElevenLabsTTSService(c) },
  groq: { create: (c) => new GroqTTSService(c) },
  deepseek: { create: (c) => new DeepSeekTTSService(c) },
  fireworks: { create: (c) => new FireworksTTSService(c) },
  mistral: { create: (c) => new MistralTTSService(c) },
};

const inpaintFactories: Record<string, ServiceFactory<InpaintService>> = {
  stability: { create: (c) => new StabilityInpaintService(c) },
  huggingface: { create: (c) => new HuggingFaceInpaintService(c) },
  fireworks: { create: (c) => new FireworksInpaintService(c) },
};

const modelGenFactories: Record<string, ServiceFactory<ModelGenService>> = {
  meshy: { create: (c) => new MeshyModelGenService(c) },
  tripo: { create: (c) => new TripoModelGenService(c) },
};

const audioGenFactories: Record<string, ServiceFactory<AudioGenService>> = {
  elevenlabs: { create: (c) => new ElevenLabsAudioGenService(c) },
  stability: { create: (c) => new StabilityAudioGenService(c) },
  huggingface: { create: (c) => new HuggingFaceAudioGenService(c) },
};

const videoGenFactories: Record<string, ServiceFactory<VideoGenService>> = {
  runway: { create: (c) => new RunwayVideoGenService(c) },
  kling: { create: (c) => new KlingVideoGenService(c) },
  luma: { create: (c) => new LumaVideoGenService(c) },
};

const llmFactories: Record<string, ServiceFactory<LLMService>> = {
  openai: { create: (c) => new OpenAILLMService(c) },
  claude: { create: (c) => new ClaudeLLMService(c) },
  gemini: { create: (c) => new GeminiLLMService(c) },
  groq: { create: (c) => new GroqLLMService(c) },
  deepseek: { create: (c) => new DeepSeekLLMService(c) },
  grok: { create: (c) => new GrokLLMService(c) },
  openrouter: { create: (c) => new OpenRouterLLMService(c) },
  poe: { create: (c) => new PoeLLMService(c) },
  'nvidia-nim': { create: (c) => new NvidiaNimLLMService(c) },
  cerebras: { create: (c) => new CerebrasLLMService(c) },
  'cloudflare-workers': { create: (c) => new CloudflareWorkersLLMService(c) },
  fireworks: { create: (c) => new FireworksLLMService(c) },
  zai: { create: (c) => new ZaiLLMService(c) },
  qwen: { create: (c) => new QwenLLMService(c) },
  transformers: { create: (c) => new TransformersLLMService(c) },
  mistral: { create: (c) => new MistralLLMService(c) },
  cohere: { create: (c) => new CohereLLMService(c) },
  together: { create: (c) => new TogetherLLMService(c) },
  perplexity: { create: (c) => new PerplexityLLMService(c) },
};

const agentFactories: Record<string, ServiceFactory<AgentService>> = {
  openai: { create: (c) => new OpenAIAgentService(c) },
  claude: { create: (c) => new ClaudeAgentService(c) },
  gemini: { create: (c) => new GeminiAgentService(c) },
  groq: { create: (c) => new GroqAgentService(c) },
  deepseek: { create: (c) => new DeepSeekAgentService(c) },
  grok: { create: (c) => new GrokAgentService(c) },
  openrouter: { create: (c) => new OpenRouterAgentService(c) },
  poe: { create: (c) => new PoeAgentService(c) },
  'nvidia-nim': { create: (c) => new NvidiaNimAgentService(c) },
  cerebras: { create: (c) => new CerebrasAgentService(c) },
  'cloudflare-workers': { create: (c) => new CloudflareWorkersAgentService(c) },
  fireworks: { create: (c) => new FireworksAgentService(c) },
  zai: { create: (c) => new ZaiAgentService(c) },
  qwen: { create: (c) => new QwenAgentService(c) },
  transformers: { create: (c) => new TransformersAgentService(c) },
  mistral: { create: (c) => new MistralAgentService(c) },
  cohere: { create: (c) => new CohereAgentService(c) },
  together: { create: (c) => new TogetherAgentService(c) },
  perplexity: { create: (c) => new PerplexityAgentService(c) },
};

const webSearchFactories: Record<string, ServiceFactory<WebSearchService>> = {
  brave: { create: (c) => new BraveSearchService(c) },
  google: { create: (c) => new GoogleSearchService(c) },
  searxng: { create: (c) => new SearXNGSearchService(c) },
  tavily: { create: (c) => new TavilySearchService(c) },
  serper: { create: (c) => new SerperSearchService(c) },
  bing: { create: (c) => new BingSearchService(c) },
  duckduckgo: { create: (c) => new DuckDuckGoSearchService(c) },
  jina: { create: (c) => new JinaSearchService(c) },
  perplexity: { create: (c) => new PerplexitySearchService(c) },
};

const councilFactories: Record<string, ServiceFactory<CouncilService>> = {
  openai: { create: (c) => new OpenAICouncilService(c) },
  claude: { create: (c) => new ClaudeCouncilService(c) },
  gemini: { create: (c) => new GeminiCouncilService(c) },
  groq: { create: (c) => new GroqCouncilService(c) },
  deepseek: { create: (c) => new DeepSeekCouncilService(c) },
  grok: { create: (c) => new GrokCouncilService(c) },
  openrouter: { create: (c) => new OpenRouterCouncilService(c) },
  poe: { create: (c) => new PoeCouncilService(c) },
  'nvidia-nim': { create: (c) => new NvidiaNimCouncilService(c) },
  cerebras: { create: (c) => new CerebrasCouncilService(c) },
  'cloudflare-workers': {
    create: (c) => new CloudflareWorkersCouncilService(c),
  },
  fireworks: { create: (c) => new FireworksCouncilService(c) },
  zai: { create: (c) => new ZaiCouncilService(c) },
  qwen: { create: (c) => new QwenCouncilService(c) },
  transformers: { create: (c) => new TransformersCouncilService(c) },
  mistral: { create: (c) => new MistralCouncilService(c) },
  cohere: { create: (c) => new CohereCouncilService(c) },
  together: { create: (c) => new TogetherCouncilService(c) },
  perplexity: { create: (c) => new PerplexityCouncilService(c) },
};

const deepSearchFactories: Record<string, ServiceFactory<DeepSearchService>> = {
  'react-deepsearch': {
    create: (c) => {
      const searchService = new BraveSearchService(c);
      const llmService = new OpenAILLMService(c);
      return new ReActDeepSearchService(searchService, llmService);
    },
  },
};

const capabilityFactories: Record<
  AICapability,
  Record<string, ServiceFactory<unknown>>
> = {
  chat: {},
  ocr: ocrFactories,
  stt: sttFactories,
  tts: ttsFactories,
  'image-gen': {},
  inpaint: inpaintFactories,
  'model-gen': modelGenFactories,
  'audio-gen': audioGenFactories,
  'video-gen': videoGenFactories,
  llm: llmFactories,
  agent: agentFactories,
  'web-search': webSearchFactories,
  deepsearch: deepSearchFactories,
  council: councilFactories,
  debate: {},
};

export class AIFactory {
  static create<T extends AICapability>(
    capability: T,
    provider: string,
    config: ServiceConfig,
  ): AIServiceType<T> {
    const factories = capabilityFactories[capability as AICapability];
    const factory = factories[provider];
    if (!factory) {
      const available = Object.keys(factories);
      throw new Error(
        `No ${capability} service for provider "${provider}". Available: ${available.join(', ') || 'none'}`,
      );
    }
    return factory.create(config) as AIServiceType<T>;
  }

  static providersFor(capability: AICapability): string[] {
    return Object.keys(capabilityFactories[capability]);
  }

  static capabilities(): AICapability[] {
    return Object.keys(capabilityFactories) as AICapability[];
  }

  static register<T extends AICapability>(
    capability: T,
    provider: string,
    factory: ServiceFactory<AIServiceType<T>>,
  ): void {
    capabilityFactories[capability as AICapability][provider] =
      factory as ServiceFactory<unknown>;
  }
}
