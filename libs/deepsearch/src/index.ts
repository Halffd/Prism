import type {
  DeepSearchRequest,
  DeepSearchResult,
  DeepSearchPhase,
  WebSearchResultItem,
  LLMRequest,
  LLMResult,
  Result,
  ServiceConfig,
} from '@prism/shared-types';
import type { WebSearchService } from '@prism/web-search';
import type { LLMService } from '@prism/llm';
import { nanoid } from 'nanoid';

export interface DeepSearchService {
  readonly provider: string;
  research(request: DeepSearchRequest): Promise<Result<DeepSearchResult>>;
}

const SYNTHESIZE_PROMPT = `You are a research synthesizer. Given the following search results and extracted content, produce a comprehensive, well-structured answer to the user's query.

Rules:
- Cite sources using [N] notation where N is the source number
- Be factual and precise; do not hallucinate information not in the sources
- Organize the answer with clear sections
- If there are conflicting findings, present all sides
- At the end, list any gaps in the research that would benefit from further investigation

Search Results:
{SEARCH_RESULTS}

Extracted Content:
{EXTRACTED_CONTENT}

Query: {QUERY}

Provide a comprehensive answer:`;

const GAP_ANALYSIS_PROMPT = `You are a research gap analyst. Given the original query and the current research findings, identify specific knowledge gaps that need further investigation.

Original Query: {QUERY}

Current Findings:
{FINDINGS}

List the top 3-5 specific sub-queries that would fill knowledge gaps. Be precise and actionable. Return as a JSON array of strings, e.g. ["sub-query 1", "sub-query 2"]`;

const QUERY_GENERATION_PROMPT = `You are a search query optimizer. Given a research question, generate 3-5 optimized search queries that would find the most relevant and comprehensive information.

Research question: {QUERY}

Return queries as a JSON array of strings, e.g. ["query 1", "query 2"]`;

const EXTRACTION_PROMPT = `Extract the key facts, data points, and claims from the following web page content. Focus on information relevant to this query: {QUERY}

Content from {URL}:
{CONTENT}

Extract key information as structured bullet points:`;

export class ReActDeepSearchService implements DeepSearchService {
  readonly provider = 'react-deepsearch';
  private searchService: WebSearchService;
  private llmService: LLMService;

  constructor(searchService: WebSearchService, llmService: LLMService) {
    this.searchService = searchService;
    this.llmService = llmService;
  }

  async research(request: DeepSearchRequest): Promise<Result<DeepSearchResult>> {
    const startTime = Date.now();
    const phases: DeepSearchPhase[] = [];
    let totalSearches = 0;
    let totalExtractions = 0;
    const allSources: WebSearchResultItem[] = [];
    const allExtractedContent: string[] = [];
    const maxDepth = request.maxDepth ?? 3;
    const maxSearches = request.maxSearches ?? 10;
    const maxExtractions = request.maxExtractions ?? 5;

    try {
      const queryGenPhase = this.createPhase('query', 'Generate search queries');
      request.onPhaseUpdate?.(queryGenPhase);
      queryGenPhase.status = 'running';
      queryGenPhase.startedAt = Date.now();
      request.onPhaseUpdate?.(queryGenPhase);
      phases.push(queryGenPhase);

      const queries = await this.generateQueries(request.query);
      queryGenPhase.status = 'completed';
      queryGenPhase.completedAt = Date.now();
      queryGenPhase.query = queries.join(' | ');
      request.onPhaseUpdate?.(queryGenPhase);

      const visitedUrls = new Set<string>();

      for (let depth = 0; depth < maxDepth; depth++) {
        const depthQueries = depth === 0 ? queries : await this.analyzeGaps(
          request.query,
          allExtractedContent.join('\n\n'),
        );

        if (depthQueries.length === 0) break;

        for (const query of depthQueries.slice(0, maxSearches - totalSearches)) {
          if (totalSearches >= maxSearches) break;

          const searchPhase = this.createPhase('search', `Search: "${query}"`);
          searchPhase.status = 'running';
          searchPhase.startedAt = Date.now();
          searchPhase.query = query;
          request.onPhaseUpdate?.(searchPhase);
          phases.push(searchPhase);

          const searchResult = await this.searchService.search({
            query,
            maxResults: 8,
            freshness: request.freshness,
            region: request.region,
            includeDomains: request.includeDomains,
            excludeDomains: request.excludeDomains,
          });

          totalSearches++;

          if (searchResult.ok) {
            searchPhase.searchResults = searchResult.value.results;
            const newResults = searchResult.value.results.filter(
              (r) => !visitedUrls.has(r.url),
            );
            for (const r of newResults) {
              visitedUrls.add(r.url);
              allSources.push(r);
            }
          } else {
            searchPhase.error = searchResult.error;
          }

          searchPhase.status = 'completed';
          searchPhase.completedAt = Date.now();
          request.onPhaseUpdate?.(searchPhase);
        }

        const sourcesToExtract = allSources
          .filter((s) => s.content || s.snippet.length > 100)
          .slice(0, maxExtractions - totalExtractions);

        for (const source of sourcesToExtract) {
          if (totalExtractions >= maxExtractions) break;

          const extractPhase = this.createPhase('extract', `Extract: ${source.title}`);
          extractPhase.status = 'running';
          extractPhase.startedAt = Date.now();
          request.onPhaseUpdate?.(extractPhase);
          phases.push(extractPhase);

          const content = source.content ?? source.snippet;
          const extracted = await this.extractContent(request.query, source.url, content);
          totalExtractions++;

          extractPhase.extractedContent = extracted;
          extractPhase.status = 'completed';
          extractPhase.completedAt = Date.now();
          request.onPhaseUpdate?.(extractPhase);

          allExtractedContent.push(`[Source: ${source.url}]\n${extracted}`);
        }

        if (depth < maxDepth - 1) {
          const gapPhase = this.createPhase('validate', 'Analyze knowledge gaps');
          gapPhase.status = 'running';
          gapPhase.startedAt = Date.now();
          request.onPhaseUpdate?.(gapPhase);
          phases.push(gapPhase);

          const gaps = await this.analyzeGaps(request.query, allExtractedContent.join('\n\n'));
          gapPhase.gaps = gaps;
          gapPhase.status = 'completed';
          gapPhase.completedAt = Date.now();
          request.onPhaseUpdate?.(gapPhase);

          if (gaps.length === 0) break;
        }
      }

      const synthesizePhase = this.createPhase('synthesize', 'Synthesize final answer');
      synthesizePhase.status = 'running';
      synthesizePhase.startedAt = Date.now();
      request.onPhaseUpdate?.(synthesizePhase);
      phases.push(synthesizePhase);

      const answer = await this.synthesize(
        request.query,
        allSources,
        allExtractedContent,
      );

      synthesizePhase.synthesis = answer;
      synthesizePhase.status = 'completed';
      synthesizePhase.completedAt = Date.now();
      request.onPhaseUpdate?.(synthesizePhase);

      const finalGaps = await this.analyzeGaps(request.query, answer);

      return {
        ok: true,
        value: {
          answer,
          sources: allSources,
          phases,
          totalSearches,
          totalExtractions,
          latencyMs: Date.now() - startTime,
          gaps: finalGaps,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private createPhase(
    type: DeepSearchPhase['type'],
    description: string,
  ): DeepSearchPhase {
    return {
      id: `phase_${nanoid()}`,
      type,
      status: 'pending',
      query: description,
    };
  }

  private async generateQueries(query: string): Promise<string[]> {
    const prompt = QUERY_GENERATION_PROMPT.replace('{QUERY}', query);
    const result = await this.callLLM(prompt);

    try {
      const parsed = JSON.parse(result) as string[];
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [query];
    } catch {
      return [query];
    }
  }

  private async analyzeGaps(query: string, findings: string): Promise<string[]> {
    if (findings.length < 100) return [query];

    const prompt = GAP_ANALYSIS_PROMPT
      .replace('{QUERY}', query)
      .replace('{FINDINGS}', findings.slice(0, 4000));

    const result = await this.callLLM(prompt);

    try {
      const parsed = JSON.parse(result) as string[];
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  }

  private async extractContent(query: string, url: string, content: string): Promise<string> {
    const prompt = EXTRACTION_PROMPT
      .replace('{QUERY}', query)
      .replace('{URL}', url)
      .replace('{CONTENT}', content.slice(0, 8000));

    return this.callLLM(prompt);
  }

  private async synthesize(
    query: string,
    sources: WebSearchResultItem[],
    extractedContent: string[],
  ): Promise<string> {
    const searchResults = sources
      .slice(0, 15)
      .map((s, i) => `[${i + 1}] ${s.title} (${s.domain}): ${s.snippet}`)
      .join('\n');

    const extracted = extractedContent
      .slice(0, 5)
      .join('\n---\n')
      .slice(0, 12000);

    const prompt = SYNTHESIZE_PROMPT
      .replace('{SEARCH_RESULTS}', searchResults)
      .replace('{EXTRACTED_CONTENT}', extracted)
      .replace('{QUERY}', query);

    return this.callLLM(prompt);
  }

  private async callLLM(prompt: string): Promise<string> {
    const request: LLMRequest = {
      messages: [{ id: `deepsearch-${Date.now()}`, role: 'user' as const, content: prompt, timestamp: Date.now() }],
      temperature: 0.3,
      maxTokens: 2048,
    };

    const result: Result<LLMResult> = await this.llmService.complete(request);
    if (result.ok) {
      return result.value.content;
    }
    throw new Error(`LLM call failed: ${result.error}`);
  }
}

export interface DeepSearchServiceFactory {
  provider: string;
  create(searchService: WebSearchService, llmService: LLMService, config?: ServiceConfig): DeepSearchService;
}

export const deepSearchFactories: Record<string, DeepSearchServiceFactory> = {
  'react-deepsearch': {
    provider: 'react-deepsearch',
    create: (searchService, llmService) => new ReActDeepSearchService(searchService, llmService),
  },
};

export function createDeepSearchService(
  provider: string,
  searchService: WebSearchService,
  llmService: LLMService,
  config?: ServiceConfig,
): DeepSearchService {
  const factory = deepSearchFactories[provider];
  if (!factory) {
    throw new Error(`Unknown deepsearch provider: ${provider}. Available: ${Object.keys(deepSearchFactories).join(', ')}`);
  }
  return factory.create(searchService, llmService, config);
}
