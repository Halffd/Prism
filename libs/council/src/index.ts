import type {
  CouncilRequest,
  CouncilResponse,
  CouncilMemberResponse,
  CouncilMember,
  CouncilVote,
  CouncilVerdict,
  Result,
  ServiceConfig,
  AIProvider,
  Message,
} from '@prism/shared-types';
import type { LLMService } from '@prism/llm';
import {
  OpenAILLMService, ClaudeLLMService, GeminiLLMService, GroqLLMService,
  DeepSeekLLMService, GrokLLMService, OpenRouterLLMService, PoeLLMService,
  NvidiaNimLLMService, CerebrasLLMService, CloudflareWorkersLLMService, FireworksLLMService,
  ZaiLLMService, QwenLLMService, TransformersLLMService, MistralLLMService,
  CohereLLMService, TogetherLLMService, PerplexityLLMService,
} from '@prism/llm';

export interface CouncilService {
  readonly provider: string;
  deliberate(request: CouncilRequest): Promise<Result<CouncilResponse>>;
}

const PROVIDER_LLM_MAP: Record<string, new (config: ServiceConfig) => LLMService> = {
  openai: OpenAILLMService,
  claude: ClaudeLLMService,
  gemini: GeminiLLMService,
  groq: GroqLLMService,
  deepseek: DeepSeekLLMService,
  grok: GrokLLMService,
  openrouter: OpenRouterLLMService,
  poe: PoeLLMService,
  'nvidia-nim': NvidiaNimLLMService,
  cerebras: CerebrasLLMService,
  'cloudflare-workers': CloudflareWorkersLLMService,
  fireworks: FireworksLLMService,
  zai: ZaiLLMService,
  qwen: QwenLLMService,
  transformers: TransformersLLMService,
  mistral: MistralLLMService,
  cohere: CohereLLMService,
  together: TogetherLLMService,
  perplexity: PerplexityLLMService,
};

function createLLMForMember(member: CouncilMember, config: ServiceConfig): LLMService | null {
  const LLMClass = PROVIDER_LLM_MAP[member.provider];
  if (!LLMClass) return null;
  const memberConfig: ServiceConfig = {
    provider: member.provider,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    model: member.model || config.model,
  };
  return new LLMClass(memberConfig);
}

async function queryMember(
  llm: LLMService,
  request: CouncilRequest,
  member: CouncilMember,
): Promise<CouncilMemberResponse> {
  const start = Date.now();
  const messages: Message[] = [];
  if (request.systemPrompt) {
    messages.push({ id: `council-sys-${Date.now()}`, role: 'system', content: request.systemPrompt, timestamp: Date.now() });
  }
  messages.push({ id: `council-user-${Date.now()}`, role: 'user', content: request.prompt, timestamp: Date.now() });

  const result = await llm.complete({
    messages,
    temperature: request.temperature ?? 0.7,
    maxTokens: request.maxTokens ?? 1024,
    model: member.model,
  });

  const latencyMs = Date.now() - start;
  if (!result.ok) {
    return { provider: member.provider, model: member.model, label: member.label, content: '', error: result.error, latencyMs };
  }
  return { provider: member.provider, model: member.model, label: member.label, content: result.value.content, tokensUsed: result.value.tokensUsed, latencyMs };
}

function buildJudgePrompt(request: CouncilRequest, responses: CouncilMemberResponse[]): string {
  const responseSections = responses
    .filter(r => !r.error)
    .map((r, i) => `--- Response ${i + 1} [${r.label || r.provider}${r.model ? '/' + r.model : ''}] ---\n${r.content}`)
    .join('\n\n');

  return `You are a judge evaluating multiple AI responses to the same prompt. Rank each response from best (1) to worst.

Criteria: accuracy, completeness, clarity, and helpfulness.

Original prompt:
${request.prompt}

Responses:
${responseSections}

Respond in EXACTLY this JSON format (no other text):
{"rankings":[{"rank":1,"provider":"<provider>","model":"<model>","reason":"<brief reason>"},{"rank":2,"provider":"<provider>","model":"<model>","reason":"<brief reason>"}],"overall_reasoning":"<2-3 sentence explanation of why the top response won>"}`;
}

function buildPeerVotePrompt(request: CouncilRequest, voterResponse: CouncilMemberResponse, otherResponses: CouncilMemberResponse[]): string {
  const otherSections = otherResponses
    .filter(r => !r.error && r.provider !== voterResponse.provider)
    .map((r, i) => `Response ${i + 1} [${r.label || r.provider}${r.model ? '/' + r.model : ''}]:\n${r.content.substring(0, 800)}`)
    .join('\n\n');

  return `You previously answered this prompt: "${request.prompt}"

Your answer: ${voterResponse.content.substring(0, 500)}

Now rank ALL responses (including yours) from best (1) to worst. Be objective — you may rank another response above yours.

Other responses:
${otherSections}

Respond in EXACTLY this JSON format:
{"rankings":[{"rank":1,"provider":"<provider>","model":"<model>"},{"rank":2,"provider":"<provider>","model":"<model>"}],"reasoning":"<brief explanation>"}`;
}

function parseRankings(raw: string): { rankings: Array<{ rank: number; provider: string; model?: string; reason?: string }>; overall_reasoning?: string; reasoning?: string } | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as { rankings: Array<{ rank: number; provider: string; model?: string; reason?: string }>; overall_reasoning?: string };
  } catch {
    return null;
  }
}

export class DefaultCouncilService implements CouncilService {
  readonly provider = 'council';
  private defaultConfig: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.defaultConfig = config;
  }

  async deliberate(request: CouncilRequest): Promise<Result<CouncilResponse>> {
    const startTime = Date.now();
    try {
      const memberResponses = await this.queryAllMembers(request);
      const validResponses = memberResponses.filter(r => !r.error);
      if (validResponses.length === 0) {
        return { ok: false, error: 'All council members failed to respond' };
      }

      const strategy = request.votingStrategy || 'single-judge';
      let verdict: CouncilVerdict;

      switch (strategy) {
        case 'single-judge':
          verdict = await this.singleJudgeVote(request, validResponses);
          break;
        case 'peer-vote':
          verdict = await this.peerVote(request, validResponses, memberResponses);
          break;
        case 'consensus':
          verdict = await this.consensusVote(request, validResponses, memberResponses);
          break;
        default:
          verdict = await this.singleJudgeVote(request, validResponses);
      }

      const totalTokensUsed = memberResponses.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
      return {
        ok: true,
        value: {
          responses: memberResponses,
          verdict,
          totalTokensUsed,
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Council deliberation failed: ${msg}` };
    }
  }

  private async queryAllMembers(request: CouncilRequest): Promise<CouncilMemberResponse[]> {
    const tasks = request.members.map(async (member) => {
      request.onMemberUpdate?.(member, 'thinking');
      const llm = createLLMForMember(member, this.defaultConfig);
      if (!llm) {
        request.onMemberUpdate?.(member, 'failed');
        return { provider: member.provider, model: member.model, label: member.label, content: '', error: `No LLM service for provider "${member.provider}"` } as CouncilMemberResponse;
      }
      const response = await queryMember(llm, request, member);
      if (response.error) {
        request.onMemberUpdate?.(member, 'failed', response.error);
      } else {
        request.onMemberUpdate?.(member, 'done', response.content);
      }
      return response;
    });
    return Promise.all(tasks);
  }

  private async singleJudgeVote(request: CouncilRequest, responses: CouncilMemberResponse[]): Promise<CouncilVerdict> {
    const judgeProvider = request.judgeProvider || 'openai';
    const judgeModel = request.judgeModel;
    const judgeMember: CouncilMember = { provider: judgeProvider, model: judgeModel, label: 'Judge' };
    const judgeLLM = createLLMForMember(judgeMember, this.defaultConfig);

    if (!judgeLLM) {
      return this.fallbackVerdict(responses, 'single-judge', 'Judge LLM unavailable, selected by shortest latency');
    }

    const judgePrompt = buildJudgePrompt(request, responses);
    const judgeResult = await judgeLLM.complete({
      messages: [{ id: `judge-${Date.now()}`, role: 'user', content: judgePrompt, timestamp: Date.now() }],
      temperature: 0,
      maxTokens: 1024,
      model: judgeModel,
    });

    if (!judgeResult.ok) {
      return this.fallbackVerdict(responses, 'single-judge', `Judge failed: ${judgeResult.error}`);
    }

    const parsed = parseRankings(judgeResult.value.content);
    if (!parsed || !parsed.rankings || parsed.rankings.length === 0) {
      return this.fallbackVerdict(responses, 'single-judge', 'Judge response unparseable');
    }

    const winner = parsed.rankings[0];
    const winnerResponse = responses.find(r => r.provider === winner.provider && (r.model === winner.model || (!r.model && !winner.model)));
    const winnerContent = winnerResponse?.content || responses[0].content;

    const vote: CouncilVote = {
      voterProvider: judgeProvider,
      voterModel: judgeModel,
      rankedResponses: parsed.rankings.map(r => ({ rank: r.rank, provider: r.provider as AIProvider, model: r.model })),
      reasoning: parsed.overall_reasoning || winner.reason || 'Judge evaluation',
    };

    return {
      winnerProvider: winner.provider as AIProvider,
      winnerModel: winner.model,
      winnerContent,
      votes: [vote],
      strategy: 'single-judge',
      reasoning: parsed.overall_reasoning || 'Single judge evaluation',
    };
  }

  private async peerVote(request: CouncilRequest, validResponses: CouncilMemberResponse[], allResponses: CouncilMemberResponse[]): Promise<CouncilVerdict> {
    const voteTasks = validResponses.map(async (response) => {
      const llm = createLLMForMember({ provider: response.provider, model: response.model }, this.defaultConfig);
      if (!llm) return null;

      const votePrompt = buildPeerVotePrompt(request, response, allResponses);
      const result = await llm.complete({
        messages: [{ id: `peer-vote-${Date.now()}`, role: 'user', content: votePrompt, timestamp: Date.now() }],
        temperature: 0,
        maxTokens: 512,
        model: response.model,
      });
      if (!result.ok) return null;

      const parsed = parseRankings(result.value.content);
      if (!parsed || !parsed.rankings) return null;

      return {
        voterProvider: response.provider,
        voterModel: response.model,
        rankedResponses: parsed.rankings.map((r: { rank: number; provider: string; model?: string }) => ({ rank: r.rank, provider: r.provider as AIProvider, model: r.model })),
        reasoning: parsed.reasoning || '',
      } as CouncilVote;
    });

    const votes = (await Promise.all(voteTasks)).filter((v): v is CouncilVote => v !== null);
    if (votes.length === 0) {
      return this.fallbackVerdict(validResponses, 'peer-vote', 'All peer votes failed');
    }

    return this.tallyVotes(votes, validResponses, 'peer-vote');
  }

  private async consensusVote(request: CouncilRequest, validResponses: CouncilMemberResponse[], allResponses: CouncilMemberResponse[]): Promise<CouncilVerdict> {
    const peerVerdict = await this.peerVote(request, validResponses, allResponses);

    const judgeProvider = request.judgeProvider || 'openai';
    const judgeModel = request.judgeModel;
    const judgeLLM = createLLMForMember({ provider: judgeProvider, model: judgeModel }, this.defaultConfig);

    if (!judgeLLM) return peerVerdict;

    const peerRankings = peerVerdict.votes.flatMap(v => v.rankedResponses.map(r => `${r.provider}${r.model ? '/' + r.model : ''}: rank ${r.rank}`)).join(', ');
    const judgePrompt = `Peer voting results for the prompt "${request.prompt}":\n\n${peerRankings}\n\nPeer reasoning summary: ${peerVerdict.reasoning}\n\nAs a tiebreaker judge, pick the best response. Respond with the provider name and a brief reason in JSON:\n{"winner_provider":"<provider>","winner_model":"<model>","reasoning":"<brief>"}`;

    const judgeResult = await judgeLLM.complete({
      messages: [{ id: `consensus-judge-${Date.now()}`, role: 'user', content: judgePrompt, timestamp: Date.now() }],
      temperature: 0,
      maxTokens: 256,
      model: judgeModel,
    });

    if (!judgeResult.ok) return peerVerdict;

    const parsed = parseRankings(`{${judgeResult.value.content.match(/\{[\s\S]*\}/)?.[0]?.replace(/^\{/, '').replace(/\}$/, '') || ''}}`);
    if (!parsed || !parsed.rankings || parsed.rankings.length === 0) return peerVerdict;

    const winner = parsed.rankings[0];
    const winnerResponse = validResponses.find(r => r.provider === winner.provider);

    const judgeVote: CouncilVote = {
      voterProvider: judgeProvider,
      voterModel: judgeModel,
      rankedResponses: [{ rank: 1, provider: winner.provider as AIProvider, model: winner.model }],
      reasoning: winner.reason || 'Consensus tiebreaker',
    };

    return {
      winnerProvider: (winner.provider as AIProvider) || peerVerdict.winnerProvider,
      winnerModel: winner.model || peerVerdict.winnerModel,
      winnerContent: winnerResponse?.content || peerVerdict.winnerContent,
      votes: [...peerVerdict.votes, judgeVote],
      strategy: 'consensus',
      reasoning: `Consensus: ${winner.reason || peerVerdict.reasoning}`,
    };
  }

  private tallyVotes(votes: CouncilVote[], responses: CouncilMemberResponse[], strategy: 'peer-vote' | 'consensus'): CouncilVerdict {
    const scoreMap = new Map<string, number>();
    const key = (provider: string, model?: string) => `${provider}${model ? '/' + model : ''}`;

    for (const vote of votes) {
      for (const ranking of vote.rankedResponses) {
        const k = key(ranking.provider, ranking.model);
        const current = scoreMap.get(k) || 0;
        scoreMap.set(k, current + (responses.length - ranking.rank + 1));
      }
    }

    let bestKey = '';
    let bestScore = -1;
    for (const [k, score] of scoreMap) {
      if (score > bestScore) {
        bestScore = score;
        bestKey = k;
      }
    }

    const [winnerProvider, winnerModel] = bestKey.split('/');
    const winnerResponse = responses.find(r => r.provider === winnerProvider && (r.model === winnerModel || (!r.model && !winnerModel)));
    const reasoning = votes.map(v => `${v.voterProvider}: ${v.reasoning}`).join('; ');

    return {
      winnerProvider: winnerProvider as AIProvider,
      winnerModel: winnerModel || undefined,
      winnerContent: winnerResponse?.content || responses[0].content,
      votes,
      strategy,
      reasoning,
    };
  }

  private fallbackVerdict(responses: CouncilMemberResponse[], strategy: CouncilVerdict['strategy'], reason: string): CouncilVerdict {
    const sorted = [...responses].sort((a, b) => (a.latencyMs || Infinity) - (b.latencyMs || Infinity));
    const winner = sorted[0];
    return {
      winnerProvider: winner.provider,
      winnerModel: winner.model,
      winnerContent: winner.content,
      votes: [],
      strategy,
      reasoning: `Fallback: ${reason}`,
    };
  }
}

function createCouncilClass(providerName: string, LLMClass: new (config: ServiceConfig) => LLMService) {
  return class implements CouncilService {
    readonly provider = providerName;
    readonly config: ServiceConfig;
    constructor(config: ServiceConfig) {
      this.config = config;
    }
    async deliberate(request: CouncilRequest): Promise<Result<CouncilResponse>> {
      const service = new DefaultCouncilService(this.config);
      return service.deliberate(request);
    }
  };
}

export const OpenAICouncilService = createCouncilClass('openai', OpenAILLMService);
export const ClaudeCouncilService = createCouncilClass('claude', ClaudeLLMService);
export const GeminiCouncilService = createCouncilClass('gemini', GeminiLLMService);
export const GroqCouncilService = createCouncilClass('groq', GroqLLMService);
export const DeepSeekCouncilService = createCouncilClass('deepseek', DeepSeekLLMService);
export const GrokCouncilService = createCouncilClass('grok', GrokLLMService);
export const OpenRouterCouncilService = createCouncilClass('openrouter', OpenRouterLLMService);
export const PoeCouncilService = createCouncilClass('poe', PoeLLMService);
export const NvidiaNimCouncilService = createCouncilClass('nvidia-nim', NvidiaNimLLMService);
export const CerebrasCouncilService = createCouncilClass('cerebras', CerebrasLLMService);
export const CloudflareWorkersCouncilService = createCouncilClass('cloudflare-workers', CloudflareWorkersLLMService);
export const FireworksCouncilService = createCouncilClass('fireworks', FireworksLLMService);
export const ZaiCouncilService = createCouncilClass('zai', ZaiLLMService);
export const QwenCouncilService = createCouncilClass('qwen', QwenLLMService);
export const TransformersCouncilService = createCouncilClass('transformers', TransformersLLMService);
export const MistralCouncilService = createCouncilClass('mistral', MistralLLMService);
export const CohereCouncilService = createCouncilClass('cohere', CohereLLMService);
export const TogetherCouncilService = createCouncilClass('together', TogetherLLMService);
export const PerplexityCouncilService = createCouncilClass('perplexity', PerplexityLLMService);
