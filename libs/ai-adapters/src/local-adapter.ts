import type {
  AIMode,
  AICapability,
  AdapterConfig,
  ServiceConfig,
  Result,
  LLMRequest,
  LLMResult,
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
  AgentRequest,
  AgentResult,
  WebSearchRequest,
  WebSearchResult,
  WebSearchResultItem,
  DeepSearchRequest,
  DeepSearchResult,
  DeepSearchPhase,
  LocalSearchProvider,
  Message,
  CouncilRequest,
  CouncilResponse,
  CouncilMemberResponse,
  CouncilVerdict,
  MultiSendRequest,
  MultiSendResponse,
  MultiSendTargetResponse,
  DebateRequest,
  DebateResult,
  DebateTurn,
} from '@prism/shared-types';
import type { AIAdapter } from './index';
import {
  DuckDuckGoSearchService,
  SearXNGSearchService,
} from '@prism/web-search';
import type { WebSearchService } from '@prism/web-search';

type LocalProvider = 'ollama' | 'llamacpp' | 'koboldcpp' | 'sglang';

const DEFAULT_PORTS: Record<LocalProvider, string> = {
  ollama: 'http://localhost:11434',
  llamacpp: 'http://localhost:8080',
  koboldcpp: 'http://localhost:5001',
  sglang: 'http://localhost:30000',
};





type StreamEvent = { Chunk: string } | 'Done' | { Error: string };

export class LocalAdapter implements AIAdapter {
  readonly mode: AIMode = 'local';
  private provider: LocalProvider;
  private baseUrl: string;
  private model?: string;
  private providerOverrides: Partial<
    Record<AICapability, { provider: string; config?: Partial<ServiceConfig> }>
  > = {};
  private searchProvider: LocalSearchProvider;
  private searxngUrl: string;
  private searchService?: WebSearchService;
  private hardware?: import('@prism/shared-types').HardwareProfile;

  constructor(config: AdapterConfig & { localProvider?: LocalProvider }) {
    this.provider = config.localProvider || 'ollama';
    this.baseUrl = config.localApiUrl || DEFAULT_PORTS[this.provider];
    this.model = undefined;
    this.searchProvider = config.localSearchProvider || 'duckduckgo';
    this.searxngUrl = config.searxngUrl || 'http://localhost:8080';
    this.hardware = config.hardware;
  }

  /** Hardware profile for GPU offload / context sizing on local servers. */
  setHardware(hardware: import('@prism/shared-types').HardwareProfile): void {
    this.hardware = hardware;
  }

  private getSearchService(): WebSearchService {
    if (!this.searchService) {
      const searchConfig: ServiceConfig = {
        apiKey: '',
        provider: this.searchProvider,
        apiUrl: this.searchProvider === 'searxng' ? this.searxngUrl : undefined,
      };
      this.searchService =
        this.searchProvider === 'searxng'
          ? new SearXNGSearchService(searchConfig)
          : new DuckDuckGoSearchService(searchConfig);
    }
    return this.searchService;
  }

  setSearchProvider(provider: LocalSearchProvider, searxngUrl?: string): void {
    this.searchProvider = provider;
    if (searxngUrl) {
      this.searxngUrl = searxngUrl;
    }
    this.searchService = undefined;
  }

  setProvider(
    capability: AICapability,
    provider: string,
    config?: Partial<ServiceConfig>,
  ): void {
    this.providerOverrides[capability] = { provider, config };
  }

  setModel(model: string): void {
    this.model = model;
  }



  private async unsupported(capability: AICapability): Promise<Result<never>> {
    return {
      ok: false,
      error: `Local mode does not support "${capability}" — only LLM completion, web-search (DuckDuckGo/SearXNG), council, multi-send, and debate are available for local providers`,
    };
  }

  /**
   * Core-mediated local chat: request bodies and stream decoders come
   * from prism-core (WASM). KoboldCpp uses its OpenAI-compatible /v1
   * endpoint (the legacy /api/v1/generate path is gone).
   */
  private async coreLLM(request: LLMRequest): Promise<Result<LLMResult>> {
    const { loadCore } = await import('@prism/llm-service');
    const core = await loadCore();
    let wire = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (request.thinking?.enabled) {
      wire = JSON.parse(core.apply_thinking(JSON.stringify(wire)));
    }

    if (this.provider === 'ollama') {
      const root = core.ollama_root_url(this.baseUrl);
      const bodyResult = JSON.parse(
        core.build_ollama_body(
          JSON.stringify({
            base_url: root,
            model: this.model || request.model || 'llama3',
            temperature: request.temperature,
            messages: wire,
            num_ctx: this.hardware?.contextTokens,
            num_gpu:
              this.hardware?.preferredCompute === 'cpu-only'
                ? 0
                : this.hardware?.gpuLayersOverride,
            max_tokens: request.maxTokens,
          }),
        ),
      ) as { Ok?: Record<string, unknown>; Err?: string };
      if (bodyResult.Err || !bodyResult.Ok) {
        return {
          ok: false,
          error: `core rejected request: ${bodyResult.Err ?? 'unknown'}`,
        };
      }
      const response = await fetch(`${root}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyResult.Ok),
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        return {
          ok: false,
          error: `Local server returned ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      const decoder = new core.NdjsonDecoder();
      let content = '';
      const finish = (): Result<LLMResult> => {
        let thinking: string | undefined;
        let finalContent = content;
        if (request.thinking?.enabled) {
          const [clean, reasoning] = JSON.parse(
            core.strip_thinking(content),
          ) as [string, string | null];
          finalContent = clean;
          thinking = reasoning ?? undefined;
        }
        return { ok: true, value: { content: finalContent, thinking } };
      };
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const events = JSON.parse(decoder.feed(chunk)) as (
          | { Chunk: string }
          | 'Done'
          | { Error: string }
        )[];
        for (const ev of events) {
          if (typeof ev === 'string') {
            if (ev === 'Done') return finish();
          } else if ('Chunk' in ev) {
            content += ev.Chunk;
          } else if ('Error' in ev) {
            return { ok: false, error: ev.Error };
          }
        }
      }
      JSON.parse(decoder.finish()) as StreamEvent[];
      return finish();
    }

    // llamacpp / sglang / koboldcpp: OpenAI-compatible /v1 endpoint.
    const trimmed = this.baseUrl.replace(/\/+$/, '');
    const base = trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
    const bodyResult = JSON.parse(
      core.build_stream_body(
        JSON.stringify({
          base_url: base,
          api_key: '',
          model: this.model || request.model || '',
          temperature: request.temperature,
          messages: wire,
          max_tokens: request.maxTokens,
        }),
      ),
    ) as { Ok?: Record<string, unknown>; Err?: string };
    if (bodyResult.Err || !bodyResult.Ok) {
      return {
        ok: false,
        error: `core rejected request: ${bodyResult.Err ?? 'unknown'}`,
      };
    }
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(bodyResult.Ok),
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Local server returned ${response.status}: ${text.slice(0, 300)}`,
      };
    }
    const decoder = new core.SseDecoder();
    let content = '';
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const events = JSON.parse(decoder.feed(chunk)) as (
        | { Chunk: string }
        | 'Done'
        | { Error: string }
      )[];
      for (const ev of events) {
        if (typeof ev === 'string') {
          if (ev === 'Done') return { ok: true, value: { content } };
        } else if ('Chunk' in ev) {
          content += ev.Chunk;
        } else if ('Error' in ev) {
          return { ok: false, error: ev.Error };
        }
      }
    }
    JSON.parse(decoder.finish()) as StreamEvent[];
    return { ok: true, value: { content } };
  }

  async llm(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      switch (this.provider) {
        case 'ollama':
        case 'koboldcpp':
        case 'llamacpp':
        case 'sglang':
          return await this.coreLLM(request);
        default:
          return {
            ok: false,
            error: `Unsupported local provider: ${this.provider}`,
          };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local adapter error: ${msg}` };
    }
  }


  async webSearch(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const service = this.getSearchService();
      return await service.search(request);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local web-search error: ${msg}` };
    }
  }

  async deepSearch(
    request: DeepSearchRequest,
  ): Promise<Result<DeepSearchResult>> {
    try {
      const searchService = this.getSearchService();
      const startTime = Date.now();
      const phases: DeepSearchPhase[] = [];
      const allSources: WebSearchResultItem[] = [];
      let totalSearches = 0;
      let totalExtractions = 0;

      const queryPhase: DeepSearchPhase = {
        id: `phase-${Date.now()}-query`,
        type: 'query',
        status: 'running',
        startedAt: Date.now(),
        query: request.query,
      };
      phases.push(queryPhase);
      request.onPhaseUpdate?.(queryPhase);

      const searchPhase: DeepSearchPhase = {
        id: `phase-${Date.now()}-search`,
        type: 'search',
        status: 'running',
        startedAt: Date.now(),
        query: request.query,
      };
      phases.push(searchPhase);
      request.onPhaseUpdate?.(searchPhase);

      const searchResult = await searchService.search({
        query: request.query,
        maxResults: request.maxSearches || 5,
        freshness: request.freshness,
        region: request.region,
        includeDomains: request.includeDomains,
        excludeDomains: request.excludeDomains,
      });

      totalSearches++;

      if (!searchResult.ok) {
        searchPhase.status = 'failed';
        searchPhase.error = searchResult.error;
        searchPhase.completedAt = Date.now();
        request.onPhaseUpdate?.(searchPhase);
        queryPhase.status = 'failed';
        queryPhase.error = 'Search failed';
        queryPhase.completedAt = Date.now();
        request.onPhaseUpdate?.(queryPhase);
        return {
          ok: false,
          error: `Deep search failed: ${searchResult.error}`,
        };
      }

      searchPhase.status = 'completed';
      searchPhase.searchResults = searchResult.value.results;
      searchPhase.completedAt = Date.now();
      request.onPhaseUpdate?.(searchPhase);

      queryPhase.status = 'completed';
      queryPhase.completedAt = Date.now();
      request.onPhaseUpdate?.(queryPhase);

      allSources.push(...searchResult.value.results);

      const extractedParts: string[] = [];
      const maxExtractions = request.maxExtractions || 3;
      const topResults = searchResult.value.results.slice(0, maxExtractions);

      for (const result of topResults) {
        totalExtractions++;
        const extractPhase: DeepSearchPhase = {
          id: `phase-${Date.now()}-extract-${totalExtractions}`,
          type: 'extract',
          status: 'running',
          startedAt: Date.now(),
          query: result.url,
        };
        phases.push(extractPhase);
        request.onPhaseUpdate?.(extractPhase);

        if (result.content) {
          extractedParts.push(
            `--- ${result.title} (${result.url}) ---\n${result.content}`,
          );
          extractPhase.status = 'completed';
          extractPhase.extractedContent =
            result.content.substring(0, 500) + '...';
        } else {
          try {
            const pageResponse = await fetch(result.url, {
              headers: { 'User-Agent': 'Prism/1.0 (DeepSearch)' },
              signal: AbortSignal.timeout(10000),
            });
            if (pageResponse.ok) {
              const text = await pageResponse.text();
              const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              const rawText = bodyMatch ? bodyMatch[1] : text;
              const cleanText = rawText
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              const truncated = cleanText.substring(0, 3000);
              extractedParts.push(
                `--- ${result.title} (${result.url}) ---\n${truncated}`,
              );
              extractPhase.extractedContent =
                truncated.substring(0, 500) + '...';
              extractPhase.status = 'completed';
            } else {
              extractPhase.status = 'failed';
              extractPhase.error = `HTTP ${pageResponse.status}`;
            }
          } catch (err) {
            extractPhase.status = 'failed';
            extractPhase.error = String(err);
          }
        }
        extractPhase.completedAt = Date.now();
        request.onPhaseUpdate?.(extractPhase);
      }

      const searchContext = extractedParts.join('\n\n');
      const systemPrompt = `You are a research assistant. Based on the following search results, provide a comprehensive answer to the user's question. Cite sources by referencing the URL in brackets like [https://example.com]. Be thorough and factual.

Search Results:
${searchContext}`;

      const synthesizePhase: DeepSearchPhase = {
        id: `phase-${Date.now()}-synthesize`,
        type: 'synthesize',
        status: 'running',
        startedAt: Date.now(),
      };
      phases.push(synthesizePhase);
      request.onPhaseUpdate?.(synthesizePhase);

      const llmMessages: Message[] = [
        {
          id: `ds-sys-${Date.now()}`,
          role: 'system',
          content: systemPrompt,
          timestamp: Date.now(),
        },
        {
          id: `ds-user-${Date.now()}`,
          role: 'user',
          content: request.query,
          timestamp: Date.now(),
        },
      ];

      const llmResult = await this.llm({
        messages: llmMessages,
        temperature: 0.3,
        maxTokens: request.targetTokens || 2000,
      });

      if (!llmResult.ok) {
        synthesizePhase.status = 'failed';
        synthesizePhase.error = llmResult.error;
        synthesizePhase.completedAt = Date.now();
        request.onPhaseUpdate?.(synthesizePhase);
        return {
          ok: false,
          error: `Deep search synthesis failed: ${llmResult.error}`,
        };
      }

      synthesizePhase.status = 'completed';
      synthesizePhase.synthesis = llmResult.value.content;
      synthesizePhase.completedAt = Date.now();
      request.onPhaseUpdate?.(synthesizePhase);

      const validatePhase: DeepSearchPhase = {
        id: `phase-${Date.now()}-validate`,
        type: 'validate',
        status: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      phases.push(validatePhase);
      request.onPhaseUpdate?.(validatePhase);

      return {
        ok: true,
        value: {
          answer: llmResult.value.content,
          sources: allSources,
          phases,
          totalSearches,
          totalExtractions,
          tokensUsed: llmResult.value.tokensUsed,
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local deep-search error: ${msg}` };
    }
  }

  async council(request: CouncilRequest): Promise<Result<CouncilResponse>> {
    try {
      const startTime = Date.now();
      const memberResponses: CouncilMemberResponse[] = [];

      for (const member of request.members) {
        request.onMemberUpdate?.(member, 'thinking');
        const messages: Message[] = [];
        if (request.systemPrompt) {
          messages.push({
            id: `council-sys-${Date.now()}`,
            role: 'system',
            content: request.systemPrompt,
            timestamp: Date.now(),
          });
        }
        messages.push({
          id: `council-user-${Date.now()}`,
          role: 'user',
          content: request.prompt,
          timestamp: Date.now(),
        });

        const result = await this.llm({
          messages,
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 1024,
          model: member.model,
        });

        if (result.ok) {
          const resp: CouncilMemberResponse = {
            provider: member.provider,
            model: member.model,
            label: member.label,
            content: result.value.content,
            tokensUsed: result.value.tokensUsed,
          };
          memberResponses.push(resp);
          request.onMemberUpdate?.(member, 'done', result.value.content);
        } else {
          memberResponses.push({
            provider: member.provider,
            model: member.model,
            label: member.label,
            content: '',
            error: result.error,
          });
          request.onMemberUpdate?.(member, 'failed', result.error);
        }
      }

      const validResponses = memberResponses.filter((r) => !r.error);
      if (validResponses.length === 0) {
        return { ok: false, error: 'All council members failed to respond' };
      }

      const verdict: CouncilVerdict = {
        winnerProvider: validResponses[0].provider,
        winnerModel: validResponses[0].model,
        winnerContent: validResponses[0].content,
        votes: [],
        strategy: request.votingStrategy || 'single-judge',
        reasoning:
          'Local council: fastest response selected (no judge LLM for voting)',
      };

      return {
        ok: true,
        value: {
          responses: memberResponses,
          verdict,
          totalTokensUsed: memberResponses.reduce(
            (sum, r) => sum + (r.tokensUsed || 0),
            0,
          ),
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local council error: ${msg}` };
    }
  }

  async multiSend(
    request: MultiSendRequest,
  ): Promise<Result<MultiSendResponse>> {
    try {
      const startTime = Date.now();
      const targetResponses: MultiSendTargetResponse[] = [];

      for (const target of request.targets) {
        request.onTargetUpdate?.(target, 'thinking');
        const messages: Message[] = [];
        if (request.systemPrompt) {
          messages.push({
            id: `ms-sys-${Date.now()}`,
            role: 'system',
            content: request.systemPrompt,
            timestamp: Date.now(),
          });
        }
        if (request.conversationHistory) {
          messages.push(...request.conversationHistory);
        }
        messages.push({
          id: `ms-user-${Date.now()}`,
          role: 'user',
          content: request.prompt,
          timestamp: Date.now(),
        });

        const targetStart = Date.now();
        const result = await this.llm({
          messages,
          temperature: request.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? 2048,
          model: target.model,
        });
        const latencyMs = Date.now() - targetStart;

        if (result.ok) {
          targetResponses.push({
            provider: target.provider,
            model: target.model,
            label: target.label,
            content: result.value.content,
            tokensUsed: result.value.tokensUsed,
            latencyMs,
          });
          request.onTargetUpdate?.(target, 'done', result.value.content);
        } else {
          targetResponses.push({
            provider: target.provider,
            model: target.model,
            label: target.label,
            content: '',
            error: result.error,
            latencyMs,
          });
          request.onTargetUpdate?.(target, 'failed', result.error);
        }
      }

      const validResponses = targetResponses.filter((r) => !r.error);
      if (validResponses.length === 0) {
        return { ok: false, error: 'All multi-send targets failed to respond' };
      }

      return {
        ok: true,
        value: {
          responses: targetResponses,
          totalTokensUsed: targetResponses.reduce(
            (sum, r) => sum + (r.tokensUsed || 0),
            0,
          ),
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local multi-send error: ${msg}` };
    }
  }

  async debate(request: DebateRequest): Promise<Result<DebateResult>> {
    try {
      const startTime = Date.now();
      const participants = request.participants;
      if (participants.length < 2) {
        return { ok: false, error: 'Debate requires at least 2 participants' };
      }

      const turns: DebateTurn[] = [];
      const maxTurns = request.maxTurns ?? participants.length * 2;
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
          {
            id: `debate-user-${turnIndex}-${Date.now()}`,
            role: 'user',
            content: turnPrompt,
            timestamp: Date.now(),
          },
        ];

        const turnStart = Date.now();
        const result = await this.llm({
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
          conversationLog.push(
            `[${participant.label || participant.provider}]: ${result.value.content}`,
          );
        } else {
          turn.error = result.error;
          conversationLog.push(
            `[${participant.label || participant.provider}]: [Error: ${result.error}]`,
          );
        }

        turns.push(turn);
        request.onTurnUpdate?.(turn, turnIndex + 1, maxTurns);
      }

      let summary: string | undefined;
      const summaryMessages: Message[] = [
        {
          id: `debate-sys-${Date.now()}`,
          role: 'system',
          content:
            'Summarize the key points from this debate in 3-5 bullet points.',
          timestamp: Date.now(),
        },
        {
          id: `debate-summary-${Date.now()}`,
          role: 'user',
          content: `Topic: ${request.topic}\n\nDebate transcript:\n${conversationLog.join('\n\n')}`,
          timestamp: Date.now(),
        },
      ];
      const summaryResult = await this.llm({
        messages: summaryMessages,
        temperature: 0.3,
        maxTokens: 512,
      });
      if (summaryResult.ok) {
        summary = summaryResult.value.content;
      }

      return {
        ok: true,
        value: {
          turns,
          summary,
          totalTokensUsed: turns.reduce(
            (sum, t) => sum + (t.tokensUsed || 0),
            0,
          ),
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Local debate error: ${msg}` };
    }
  }

  async ocr(_request: OCRRequest): Promise<Result<OCRResult>> {
    return this.unsupported('ocr');
  }
  async stt(_request: STTRequest): Promise<Result<STTResult>> {
    return this.unsupported('stt');
  }
  async tts(_request: TTSRequest): Promise<Result<TTSResult>> {
    return this.unsupported('tts');
  }
  async inpaint(_request: InpaintRequest): Promise<Result<InpaintResult>> {
    return this.unsupported('inpaint');
  }
  async modelGen(_request: ModelGenRequest): Promise<Result<ModelGenResult>> {
    return this.unsupported('model-gen');
  }
  async audioGen(_request: AudioGenRequest): Promise<Result<AudioGenResult>> {
    return this.unsupported('audio-gen');
  }
  async videoGen(_request: VideoGenRequest): Promise<Result<VideoGenResult>> {
    return this.unsupported('video-gen');
  }
  async agent(_request: AgentRequest): Promise<Result<AgentResult>> {
    return this.unsupported('agent');
  }
}
