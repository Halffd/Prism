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
import { applyThinkingToMessages, stripThinkingFromContent } from './thinking';
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

function extractBase64(data: string): string {
  if (data.startsWith('data:image/')) {
    return data.split(',')[1];
  }
  return data;
}

function toOpenAIMessages(request: LLMRequest): Array<Record<string, unknown>> {
  const messages = applyThinkingToMessages(request.messages, request.thinking);
  return messages.map((msg) => {
    if (msg.images && msg.images.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const img of msg.images) {
        content.push({ type: 'image_url', image_url: { url: img } });
      }
      return { role: msg.role, content };
    }
    return { role: msg.role, content: msg.content };
  });
}

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

  constructor(config: AdapterConfig & { localProvider?: LocalProvider }) {
    this.provider = config.localProvider || 'ollama';
    this.baseUrl = config.localApiUrl || DEFAULT_PORTS[this.provider];
    this.model = undefined;
    this.searchProvider = config.localSearchProvider || 'duckduckgo';
    this.searxngUrl = config.searxngUrl || 'http://localhost:8080';
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

  private async ollamaLLM(request: LLMRequest): Promise<Result<LLMResult>> {
    const ollamaMessages = applyThinkingToMessages(
      request.messages,
      request.thinking,
    ).map((msg) => {
      if (msg.images && msg.images.length > 0) {
        return {
          role: msg.role,
          content: msg.content,
          images: msg.images.map(extractBase64),
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model || request.model || 'llama3',
        messages: ollamaMessages,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Ollama returned ${response.status}`;
      try {
        const e = (await response.json()) as Record<string, unknown>;
        errorMsg = (e.error as string) || errorMsg;
      } catch {
        /* ignore */
      }
      return { ok: false, error: errorMsg };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const message = data.message as Record<string, unknown>;
    const stripped = stripThinkingFromContent(
      (message.content as string) ?? '',
    );
    return {
      ok: true,
      value: {
        content: stripped.content,
        thinking: stripped.thinking,
        model: (data.model as string) || this.model || 'llama3',
        tokensUsed: (data.eval_count as number) || undefined,
      },
    };
  }

  private async openAICompatLLM(
    request: LLMRequest,
  ): Promise<Result<LLMResult>> {
    const messages = toOpenAIMessages(request);
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model || request.model || '',
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Local server returned ${response.status}`;
      try {
        const e = (await response.json()) as Record<string, unknown>;
        errorMsg = (e.error as string) || errorMsg;
      } catch {
        /* ignore */
      }
      return { ok: false, error: errorMsg };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices?.[0];
    const choiceMessage = choice?.message as
      Record<string, unknown> | undefined;
    const usage = data.usage as Record<string, unknown> | undefined;

    return {
      ok: true,
      value: {
        content: (choiceMessage?.content as string) || '',
        model: (data.model as string) || this.model || '',
        tokensUsed: (usage?.total_tokens as number) || undefined,
      },
    };
  }

  private async koboldCppLLM(request: LLMRequest): Promise<Result<LLMResult>> {
    const prompt =
      request.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n') +
      '\n\nassistant:';
    const response = await fetch(`${this.baseUrl}/api/v1/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_length: request.maxTokens || 200,
        temperature: request.temperature || 0.8,
      }),
    });

    if (!response.ok) {
      let errorMsg = `KoboldCpp returned ${response.status}`;
      try {
        const e = (await response.json()) as Record<string, unknown>;
        errorMsg = (e.error as string) || errorMsg;
      } catch {
        /* ignore */
      }
      return { ok: false, error: errorMsg };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const results = data.results as Array<Record<string, unknown>>;

    return {
      ok: true,
      value: {
        content: (results?.[0]?.text as string) || '',
        model: this.model || 'koboldcpp',
      },
    };
  }

  private async unsupported(capability: AICapability): Promise<Result<never>> {
    return {
      ok: false,
      error: `Local mode does not support "${capability}" — only LLM completion, web-search (DuckDuckGo/SearXNG), council, multi-send, and debate are available for local providers`,
    };
  }

  async llm(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      switch (this.provider) {
        case 'ollama':
          return await this.ollamaLLM(request);
        case 'koboldcpp':
          return await this.koboldCppLLM(request);
        case 'llamacpp':
        case 'sglang':
          return await this.openAICompatLLM(request);
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
