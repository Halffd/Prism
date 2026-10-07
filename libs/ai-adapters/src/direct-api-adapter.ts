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
  MultiSendTargetResponse,
  Message,
  DebateRequest,
  DebateResult,
  DebateTurn,
} from '@prism/shared-types';
import { AIFactory } from '@prism/ai-factory';
import type { AIAdapter } from './index';
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

type AnyService = OCRService | STTService | TTSService | InpaintService | ModelGenService | AudioGenService | VideoGenService | LLMService | AgentService | WebSearchService | DeepSearchService | CouncilService;

const METHOD_MAP: Record<AICapability, string> = {
  chat: '',
  ocr: 'recognize',
  stt: 'transcribe',
  tts: 'synthesize',
  'image-gen': '',
  inpaint: 'inpaint',
  'model-gen': 'generate',
  'audio-gen': 'generate',
  'video-gen': 'generate',
  llm: 'complete',
  agent: 'run',
  'web-search': 'search',
  deepsearch: 'research',
  council: 'deliberate',
  debate: 'debate',
};


export class DirectAPIAdapter implements AIAdapter {
  readonly mode: AIMode = 'api';
  private services: Partial<Record<AICapability, AnyService>> = {};
  private defaultConfig: ServiceConfig;

  constructor(defaultConfig: ServiceConfig) {
    this.defaultConfig = defaultConfig;
    this.initAll(defaultConfig);
  }

  private initAll(config: ServiceConfig): void {
    const provider = config.provider as string;
    const capabilities: AICapability[] = ['ocr', 'stt', 'tts', 'inpaint', 'model-gen', 'audio-gen', 'video-gen', 'llm', 'agent', 'web-search', 'deepsearch', 'council'];
    for (const cap of capabilities) {
      try {
        this.services[cap] = AIFactory.create(cap, provider, config);
      } catch {
        // provider unsupported for this capability — skip
      }
    }
  }

  setProvider(capability: AICapability, provider: string, config?: Partial<ServiceConfig>): void {
    const sc: ServiceConfig = {
      provider: config?.provider || this.defaultConfig.provider,
      apiKey: config?.apiKey || this.defaultConfig.apiKey,
      apiUrl: config?.apiUrl || this.defaultConfig.apiUrl,
      model: config?.model || this.defaultConfig.model,
    };
    this.services[capability] = AIFactory.create(capability, provider, sc);
  }

  private async call<C extends AICapability>(
    capability: C,
    request: unknown,
  ): Promise<Result<unknown>> {
    const service = this.services[capability];
    if (!service) {
      return { ok: false, error: `${capability} service not available for provider "${this.defaultConfig.provider}"` };
    }
    const method = METHOD_MAP[capability];
    try {
      const fn = (service as unknown as Record<string, (...args: unknown[]) => Promise<Result<unknown>>>)[method];
      if (!fn) {
        return { ok: false, error: `No method "${method}" on ${capability} service` };
      }
      return await fn.call(service, request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async ocr(request: OCRRequest): Promise<Result<OCRResult>> { return this.call('ocr', request) as Promise<Result<OCRResult>>; }
  async stt(request: STTRequest): Promise<Result<STTResult>> { return this.call('stt', request) as Promise<Result<STTResult>>; }
  async tts(request: TTSRequest): Promise<Result<TTSResult>> { return this.call('tts', request) as Promise<Result<TTSResult>>; }
  async inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> { return this.call('inpaint', request) as Promise<Result<InpaintResult>>; }
  async modelGen(request: ModelGenRequest): Promise<Result<ModelGenResult>> { return this.call('model-gen', request) as Promise<Result<ModelGenResult>>; }
  async audioGen(request: AudioGenRequest): Promise<Result<AudioGenResult>> { return this.call('audio-gen', request) as Promise<Result<AudioGenResult>>; }
  async videoGen(request: VideoGenRequest): Promise<Result<VideoGenResult>> { return this.call('video-gen', request) as Promise<Result<VideoGenResult>>; }
  async llm(request: LLMRequest): Promise<Result<LLMResult>> { return this.call('llm', request) as Promise<Result<LLMResult>>; }
  async agent(request: AgentRequest): Promise<Result<AgentResult>> { return this.call('agent', request) as Promise<Result<AgentResult>>; }
  async webSearch(request: WebSearchRequest): Promise<Result<WebSearchResult>> { return this.call('web-search', request) as Promise<Result<WebSearchResult>>; }
  async deepSearch(request: DeepSearchRequest): Promise<Result<DeepSearchResult>> { return this.call('deepsearch', request) as Promise<Result<DeepSearchResult>>; }
  async council(request: CouncilRequest): Promise<Result<CouncilResponse>> { return this.call('council', request) as Promise<Result<CouncilResponse>>; }

  async multiSend(request: MultiSendRequest): Promise<Result<MultiSendResponse>> {
    const startTime = Date.now();
    try {
      const targetResponses: MultiSendTargetResponse[] = await Promise.all(
        request.targets.map(async (target) => {
          request.onTargetUpdate?.(target, 'thinking');
          const llmService = AIFactory.create('llm', target.provider, {
            provider: target.provider,
            apiKey: this.defaultConfig.apiKey,
            apiUrl: this.defaultConfig.apiUrl,
            model: target.model || this.defaultConfig.model,
          });
          const messages: Message[] = [];
          if (request.systemPrompt) {
            messages.push({ id: `ms-sys-${Date.now()}`, role: 'system', content: request.systemPrompt, timestamp: Date.now() });
          }
          if (request.conversationHistory) {
            messages.push(...request.conversationHistory);
          }
          messages.push({ id: `ms-user-${Date.now()}`, role: 'user', content: request.prompt, timestamp: Date.now() });
          const targetStart = Date.now();
          const result = await llmService.complete({
            messages,
            temperature: request.temperature ?? 0.7,
            maxTokens: request.maxTokens ?? 2048,
            model: target.model,
          });
          const latencyMs = Date.now() - targetStart;
          if (!result.ok) {
            request.onTargetUpdate?.(target, 'failed', result.error);
            return { provider: target.provider, model: target.model, label: target.label, content: '', error: result.error, latencyMs };
          }
          request.onTargetUpdate?.(target, 'done', result.value.content);
          return { provider: target.provider, model: target.model, label: target.label, content: result.value.content, tokensUsed: result.value.tokensUsed, latencyMs };
        })
      );
      const totalTokensUsed = targetResponses.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
      return { ok: true, value: { responses: targetResponses, totalTokensUsed, latencyMs: Date.now() - startTime } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Multi-send failed: ${msg}` };
    }
  }

  async debate(request: DebateRequest): Promise<Result<DebateResult>> {
    const startTime = Date.now();
    try {
      const participants = request.participants;
      if (participants.length < 2) {
        return { ok: false, error: 'Debate requires at least 2 participants' };
      }

      const turns: DebateTurn[] = [];
      const maxTurns = request.maxTurns ?? (participants.length * 2);
      const conversationLog: string[] = [];

      if (request.systemPrompt) {
        conversationLog.push(`[System] ${request.systemPrompt}`);
      }

      conversationLog.push(`[Topic] ${request.topic}`);

      for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
        const participantIndex = turnIndex % participants.length;
        const participant = participants[participantIndex];

        const stanceInstruction = participant.stance
          ? ` Your stance on this topic is: ${participant.stance}.`
          : participantIndex === 0
            ? ' Present the strongest argument in favor.'
            : participantIndex === 1
              ? ' Present the strongest counter-argument.'
              : ' Add a new perspective or rebuttal.';

        const turnPrompt = `You are participating in a ${request.mode === 'dual' ? 'one-on-one' : 'group'} debate.

Topic: ${request.topic}

Conversation so far:
${conversationLog.join('\n\n')}

It is your turn to speak.${stanceInstruction}

Provide your argument concisely and persuasively.`;

        const messages: Message[] = [
          { id: `debate-user-${turnIndex}-${Date.now()}`, role: 'user', content: turnPrompt, timestamp: Date.now() },
        ];

        const llmService = AIFactory.create('llm', participant.provider, {
          provider: participant.provider,
          apiKey: this.defaultConfig.apiKey,
          apiUrl: this.defaultConfig.apiUrl,
          model: participant.model || this.defaultConfig.model,
        });

        const turnStart = Date.now();
        const result = await llmService.complete({
          messages,
          temperature: request.temperature ?? 0.8,
          maxTokens: request.maxTokens ?? 512,
          model: participant.model,
        });
        const latencyMs = Date.now() - turnStart;

        const turn: DebateTurn = {
          participantIndex,
          participant,
          content: '',
          latencyMs,
        };

        if (result.ok) {
          turn.content = result.value.content;
          turn.tokensUsed = result.value.tokensUsed;
          conversationLog.push(`[${participant.label || participant.provider}]: ${result.value.content}`);
        } else {
          turn.error = result.error;
          conversationLog.push(`[${participant.label || participant.provider}]: [Error: ${result.error}]`);
        }

        turns.push(turn);
        request.onTurnUpdate?.(turn, turnIndex + 1, maxTurns);
      }

      let summary: string | undefined;
      if (participants.length >= 2) {
        const summaryParticipant = participants[0];
        const summaryService = AIFactory.create('llm', summaryParticipant.provider, {
          provider: summaryParticipant.provider,
          apiKey: this.defaultConfig.apiKey,
          apiUrl: this.defaultConfig.apiUrl,
          model: summaryParticipant.model || this.defaultConfig.model,
        });
        const summaryMessages: Message[] = [
          { id: `debate-summary-${Date.now()}`, role: 'user', content: `Summarize the key points from this debate in 3-5 bullet points:\n\nTopic: ${request.topic}\n\nDebate transcript:\n${conversationLog.join('\n\n')}`, timestamp: Date.now() },
        ];
        const summaryResult = await summaryService.complete({
          messages: summaryMessages,
          temperature: 0.3,
          maxTokens: 512,
          model: summaryParticipant.model,
        });
        if (summaryResult.ok) {
          summary = summaryResult.value.content;
        }
      }

      return {
        ok: true,
        value: {
          turns,
          summary,
          totalTokensUsed: turns.reduce((sum, t) => sum + (t.tokensUsed || 0), 0),
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Debate failed: ${msg}` };
    }
  }
}