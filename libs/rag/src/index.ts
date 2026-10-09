/**
 * RAG (retrieval-augmented generation) for Prism.
 *
 * Pipeline: document → heading-aware chunks → embeddings → vector store →
 * top-k retrieval injected into the prompt.
 *
 * Embeddings use Ollama's /api/embed by default (local, no API key). When an
 * OpenAI key is provided, text-embedding-3-small is used instead.
 */

export interface RagChunk {
  id: string;
  documentId: string;
  content: string;
  /** 0-based position of the chunk within its document. */
  index: number;
}

export interface RagDocument {
  id: string;
  title: string;
  /** ISO timestamp of ingestion. */
  createdAt: string;
  chunkCount: number;
}

export interface EmbeddedChunk extends RagChunk {
  embedding: number[];
}

export interface EmbedConfig {
  /** 'ollama' (local, default) or 'openai'. */
  provider: 'ollama' | 'openai';
  /** Base URL for Ollama (default http://localhost:11434). */
  ollamaUrl?: string;
  /** OpenAI API key — required when provider is 'openai'. */
  openaiApiKey?: string;
  /** OpenAI embedding model (default text-embedding-3-small). */
  openaiModel?: string;
  /** Ollama embedding model (default nomic-embed-text). */
  ollamaModel?: string;
}

export interface RetrieveOptions {
  /** How many chunks to return. Default 4. */
  k?: number;
  /** Minimum cosine similarity [0..1]. Default 0.15. */
  threshold?: number;
}

export interface RetrievalResult {
  chunks: EmbeddedChunk[];
  /** Similarity scores aligned with chunks. */
  scores: number[];
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split a document into overlapping chunks. Headings (markdown # lines and
 * ALL-CAPS lines) start new chunks so topical boundaries survive; long
 * sections are additionally split with a sliding window.
 */
export function chunkDocument(
  documentId: string,
  text: string,
  options: { maxTokens?: number; overlapTokens?: number } = {},
): RagChunk[] {
  const maxTokens = options.maxTokens ?? 256;
  const overlap = options.overlapTokens ?? 48;
  // ~4 chars per token; chunk by characters for simplicity and determinism
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;

  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of lines) {
    const isHeading =
      /^#{1,6}\s/.test(line) ||
      (/^[A-Z0-9 ,.'-]{12,}$/.test(line.trim()) && line.trim().length < 80);
    if (isHeading && current.length > 0) {
      flush();
    }
    current.push(line);
    // Hard split inside very long sections
    if (current.join('\n').length >= maxChars) {
      flush();
    }
  }
  flush();

  // Sliding-window overlap for long sections
  const chunks: RagChunk[] = [];
  let index = 0;
  for (const section of sections) {
    if (section.length <= maxChars) {
      if (section.trim().length === 0) continue;
      chunks.push({
        id: `${documentId}_chunk_${index}`,
        documentId,
        content: section.trim(),
        index: index++,
      });
      continue;
    }
    const step = Math.max(1, maxChars - overlapChars);
    for (let start = 0; start < section.length; start += step) {
      const slice = section.slice(start, start + maxChars).trim();
      if (slice.length === 0) continue;
      chunks.push({
        id: `${documentId}_chunk_${index}`,
        documentId,
        content: slice,
        index: index++,
      });
      if (start + maxChars >= section.length) break;
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

export async function embedTexts(
  texts: string[],
  config: EmbedConfig,
): Promise<number[][]> {
  if (config.provider === 'openai') {
    return embedOpenAI(texts, config);
  }
  return embedOllama(texts, config);
}

async function embedOllama(
  texts: string[],
  config: EmbedConfig,
): Promise<number[][]> {
  const url = config.ollamaUrl || 'http://localhost:11434';
  const model = config.ollamaModel || 'nomic-embed-text';
  const response = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embedding failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings;
}

async function embedOpenAI(
  texts: string[],
  config: EmbedConfig,
): Promise<number[][]> {
  const model = config.openaiModel || 'text-embedding-3-small';
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `OpenAI embedding failed: ${body.error?.message ?? response.status}`,
    );
  }
  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data.map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Vector stores
// ---------------------------------------------------------------------------

export interface VectorStore {
  add(chunks: EmbeddedChunk[]): Promise<void>;
  /** All chunks (optionally limited to one document). */
  all(documentId?: string): Promise<EmbeddedChunk[]>;
  removeDocument(documentId: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store. Useful for tests and ephemeral sessions. */
export class InMemoryVectorStore implements VectorStore {
  private chunks: EmbeddedChunk[] = [];

  async add(chunks: EmbeddedChunk[]): Promise<void> {
    this.chunks.push(...chunks);
  }

  async all(documentId?: string): Promise<EmbeddedChunk[]> {
    if (documentId === undefined) return [...this.chunks];
    return this.chunks.filter((c) => c.documentId === documentId);
  }

  async removeDocument(documentId: string): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.documentId !== documentId);
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Embed the query and return the top-k most similar chunks. */
export async function retrieveRagContext(
  query: string,
  store: VectorStore,
  embedConfig: EmbedConfig,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const k = options.k ?? 4;
  const threshold = options.threshold ?? 0.15;

  const [queryEmbedding] = await embedTexts([query], embedConfig);
  const chunks = await store.all();

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return {
    chunks: scored.map((s) => s.chunk),
    scores: scored.map((s) => s.score),
  };
}

/** Format retrieved chunks for injection into a system prompt. */
export function formatRagContext(retrieval: RetrievalResult): string {
  if (retrieval.chunks.length === 0) return '';
  const parts = retrieval.chunks.map(
    (chunk, i) => `[${i + 1}] (document ${chunk.documentId})\n${chunk.content}`,
  );
  return `[Retrieved Context]\n${parts.join('\n\n')}`;
}
