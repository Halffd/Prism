import type {
  WebSearchRequest,
  WebSearchResult,
  WebSearchResultItem,
  ServiceConfig,
  Result,
} from '@prism/shared-types';

export interface WebSearchService {
  readonly provider: string;
  search(request: WebSearchRequest): Promise<Result<WebSearchResult>>;
}

export class BraveSearchService implements WebSearchService {
  readonly provider = 'brave';
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.search.brave.com';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const params = new URLSearchParams({
        q: request.query,
        count: String(request.maxResults ?? 10),
      });
      if (request.freshness && request.freshness !== 'all') {
        params.set('freshness', request.freshness);
      }
      if (request.region) {
        params.set('country', request.region);
      }
      if (request.safeSearch === false) {
        params.set('safesearch', '0');
      }

      const response = await fetch(`${this.apiUrl}/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Brave API ${response.status}: ${body}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const web = (data.web as Record<string, unknown>)?.results as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (web ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
        snippet: String(item.description ?? ''),
        publishedDate: item.age ? String(item.age) : undefined,
        domain: new URL(String(item.url ?? '')).hostname,
      }));

      return {
        ok: true,
        value: {
          results,
          query: request.query,
          totalResults: typeof data.web === 'object' && data.web !== null
            ? (data.web as Record<string, unknown>).numResults as number | undefined
            : undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class GoogleSearchService implements WebSearchService {
  readonly provider = 'google';
  private apiKey: string;
  private cx: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.cx = config.model ?? '';
    this.apiUrl = config.apiUrl || 'https://www.googleapis.com';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      if (!this.cx) {
        return { ok: false, error: 'Google Custom Search requires a CX (custom search engine ID) set as model' };
      }
      const params = new URLSearchParams({
        key: this.apiKey,
        cx: this.cx,
        q: request.query,
        num: String(request.maxResults ?? 10),
      });
      if (request.safeSearch === false) {
        params.set('safe', 'off');
      }

      const response = await fetch(`${this.apiUrl}/customsearch/v1?${params}`);
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Google API ${response.status}: ${body}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const items = data.items as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (items ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.link ?? ''),
        snippet: String(item.snippet ?? ''),
  content: (() => {
          try {
            const pagemap = item.pagemap as Record<string, Record<string, unknown>[]> | undefined;
            return pagemap?.metatags?.[0]?.['og:description'] ? String(pagemap.metatags[0]['og:description']) : undefined;
          } catch { return undefined; }
        })(),
        domain: new URL(String(item.link ?? '')).hostname,
      }));

      return {
        ok: true,
        value: {
          results,
          query: request.query,
          totalResults: typeof data.searchInformation === 'object' && data.searchInformation !== null
            ? Number((data.searchInformation as Record<string, unknown>).totalResults ?? 0)
            : undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class SearXNGSearchService implements WebSearchService {
  readonly provider = 'searxng';
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiUrl = config.apiUrl || 'http://localhost:8080';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const params = new URLSearchParams({
        q: request.query,
        format: 'json',
        pageno: '1',
      });
      if (request.freshness && request.freshness !== 'all') {
        params.set('time_range', request.freshness);
      }
      if (request.region) {
        params.set('language', request.region);
      }
      if (request.safeSearch === false) {
        params.set('safesearch', '0');
      }

      const response = await fetch(`${this.apiUrl}/search?${params}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `SearXNG API ${response.status}: ${body}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const items = data.results as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (items ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
        snippet: String(item.content ?? ''),
        publishedDate: item.publishedDate ? String(item.publishedDate) : undefined,
        domain: new URL(String(item.url ?? '')).hostname,
        score: typeof item.score === 'number' ? item.score : undefined,
      }));

      return {
        ok: true,
        value: {
          results,
          query: request.query,
          totalResults: typeof data.number_of_results === 'number' ? data.number_of_results : undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class TavilySearchService implements WebSearchService {
  readonly provider = 'tavily';
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.tavily.com';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const body: Record<string, unknown> = {
        api_key: this.apiKey,
        query: request.query,
        max_results: request.maxResults ?? 10,
        include_answer: false,
        include_raw_content: false,
      };
      if (request.includeDomains?.length) {
        body.include_domains = request.includeDomains;
      }
      if (request.excludeDomains?.length) {
        body.exclude_domains = request.excludeDomains;
      }

      const response = await fetch(`${this.apiUrl}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Tavily API ${response.status}: ${text}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const items = data.results as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (items ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
        snippet: String(item.content ?? ''),
        content: item.raw_content ? String(item.raw_content) : undefined,
        publishedDate: item.published_date ? String(item.published_date) : undefined,
        domain: new URL(String(item.url ?? '')).hostname,
        score: typeof item.score === 'number' ? item.score : undefined,
      }));

      return {
        ok: true,
        value: { results, query: request.query },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class SerperSearchService implements WebSearchService {
  readonly provider = 'serper';
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://google.serper.dev';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const body: Record<string, unknown> = {
        q: request.query,
        num: request.maxResults ?? 10,
      };
      if (request.freshness && request.freshness !== 'all') {
        body.tbs = `qdr:${request.freshness.charAt(0)}`;
      }
      if (request.region) {
        body.gl = request.region;
      }

      const response = await fetch(`${this.apiUrl}/search`, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Serper API ${response.status}: ${text}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const organic = data.organic as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (organic ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.link ?? ''),
        snippet: String(item.snippet ?? ''),
        publishedDate: item.date ? String(item.date) : undefined,
        domain: new URL(String(item.link ?? '')).hostname,
      }));

      return {
        ok: true,
        value: {
          results,
          query: request.query,
          totalResults: typeof data.searchInformation === 'object' && data.searchInformation !== null
            ? Number((data.searchInformation as Record<string, unknown>).totalResults ?? 0)
            : undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class BingSearchService implements WebSearchService {
  readonly provider = 'bing';
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.bing.microsoft.com';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const params = new URLSearchParams({
        q: request.query,
        count: String(request.maxResults ?? 10),
      });
      if (request.freshness && request.freshness !== 'all') {
        params.set('freshness', request.freshness);
      }
      if (request.region) {
        params.set('cc', request.region);
      }
      if (request.safeSearch === false) {
        params.set('safeSearch', 'Off');
      }

      const response = await fetch(`${this.apiUrl}/v7.0/search?${params}`, {
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Bing API ${response.status}: ${text}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const webPages = data.webPages as Record<string, unknown> | undefined;
      const values = webPages?.value as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (values ?? []).map((item) => ({
        title: String(item.name ?? ''),
        url: String(item.url ?? ''),
        snippet: String(item.snippet ?? ''),
        publishedDate: item.dateLastCrawled ? String(item.dateLastCrawled) : undefined,
        domain: new URL(String(item.url ?? '')).hostname,
      }));

      return {
        ok: true,
        value: {
          results,
          query: request.query,
          totalResults: webPages?.totalEstimatedMatches as number | undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class DuckDuckGoSearchService implements WebSearchService {
  readonly provider = 'duckduckgo';
  private apiUrl: string;

  constructor(_config: ServiceConfig) {
    this.apiUrl = 'https://html.duckduckgo.com';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const response = await fetch(`${this.apiUrl}/html/?q=${encodeURIComponent(request.query)}`, {
        headers: { 'User-Agent': 'Prism/1.0' },
      });

      if (!response.ok) {
        return { ok: false, error: `DuckDuckGo ${response.status}` };
      }

      const html = await response.text();
      const results: WebSearchResultItem[] = [];
      const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      const links = [...html.matchAll(linkRegex)];
      const snippets = [...html.matchAll(snippetRegex)];

      for (let i = 0; i < Math.min(links.length, request.maxResults ?? 10); i++) {
        const url = links[i][1];
        const title = links[i][2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippets[i]?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
        if (url && title) {
          try {
            results.push({
              title,
              url,
              snippet,
              domain: new URL(url).hostname,
            });
          } catch { /* skip malformed URLs */ }
        }
      }

      return {
        ok: true,
        value: { results, query: request.query },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class JinaSearchService implements WebSearchService {
  readonly provider = 'jina';
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://s.jina.ai';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const params = new URLSearchParams({
        q: request.query,
        num: String(request.maxResults ?? 10),
      });

      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.apiUrl}?${params}`, { headers });
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Jina API ${response.status}: ${text}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const items = data.data as Record<string, unknown>[] | undefined;
      const results: WebSearchResultItem[] = (items ?? []).map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
        snippet: String(item.description ?? ''),
        content: item.content ? String(item.content) : undefined,
        publishedDate: item.date ? String(item.date) : undefined,
        domain: new URL(String(item.url ?? '')).hostname,
      }));

      return {
        ok: true,
        value: { results, query: request.query },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export class PerplexitySearchService implements WebSearchService {
  readonly provider = 'perplexity';
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor(config: ServiceConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.perplexity.ai';
    this.model = config.model || 'sonar';
  }

  async search(request: WebSearchRequest): Promise<Result<WebSearchResult>> {
    try {
      const body = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Return search results as a JSON array. Each result must have: title, url, snippet, domain.',
          },
          { role: 'user', content: request.query },
        ],
        return_citations: true,
        search_domain_filter: request.includeDomains?.length
          ? request.includeDomains
          : undefined,
      };

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Perplexity API ${response.status}: ${text}` };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const citations = data.citations as string[] | undefined;
      const choices = data.choices as Record<string, unknown>[] | undefined;
      const content = choices?.[0]
        ? ((choices[0].message as Record<string, unknown>).content as string)
        : '';

      const results: WebSearchResultItem[] = (citations ?? []).map((url, i) => ({
        title: `Source ${i + 1}`,
        url,
        snippet: '',
        domain: new URL(url).hostname,
      }));

      if (content && results.length > 0) {
        results[0].content = content;
      }

      return {
        ok: true,
        value: { results, query: request.query },
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

export interface WebSearchServiceFactory {
  provider: string;
  create(config: ServiceConfig): WebSearchService;
}

export const webSearchFactories: Record<string, WebSearchServiceFactory> = {
  brave: { provider: 'brave', create: (c) => new BraveSearchService(c) },
  google: { provider: 'google', create: (c) => new GoogleSearchService(c) },
  searxng: { provider: 'searxng', create: (c) => new SearXNGSearchService(c) },
  tavily: { provider: 'tavily', create: (c) => new TavilySearchService(c) },
  serper: { provider: 'serper', create: (c) => new SerperSearchService(c) },
  bing: { provider: 'bing', create: (c) => new BingSearchService(c) },
  duckduckgo: { provider: 'duckduckgo', create: (c) => new DuckDuckGoSearchService(c) },
  jina: { provider: 'jina', create: (c) => new JinaSearchService(c) },
  perplexity: { provider: 'perplexity', create: (c) => new PerplexitySearchService(c) },
};

export function createWebSearchService(provider: string, config: ServiceConfig): WebSearchService {
  const factory = webSearchFactories[provider];
  if (!factory) {
    throw new Error(`Unknown web-search provider: ${provider}. Available: ${Object.keys(webSearchFactories).join(', ')}`);
  }
  return factory.create(config);
}
