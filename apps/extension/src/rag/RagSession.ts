import {
  chunkDocument,
  embedTexts,
  retrieveRagContext,
  formatRagContext,
  type EmbedConfig,
  type RagDocument,
} from '@prism/rag';
import { DexieVectorStore } from './DexieVectorStore';

/**
 * Extension-side RAG session: ingest documents (chunks + embeddings persisted
 * in IndexedDB), then retrieve formatted context for a query.
 */
export class RagSession {
  private store: DexieVectorStore;
  private embedConfig: EmbedConfig;

  constructor(embedConfig?: Partial<EmbedConfig>) {
    this.store = new DexieVectorStore();
    this.embedConfig = {
      provider: embedConfig?.openaiApiKey ? 'openai' : 'ollama',
      ...embedConfig,
    };
  }

  /** Chunk + embed a document and persist its chunks. Returns the document. */
  async ingest(
    title: string,
    text: string,
    options?: { maxTokens?: number; overlapTokens?: number },
  ): Promise<RagDocument> {
    const documentId = `doc_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const chunks = chunkDocument(documentId, text, options);
    const embeddings =
      chunks.length > 0
        ? await embedTexts(
            chunks.map((c) => c.content),
            this.embedConfig,
          )
        : [];
    await this.store.add(
      chunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] ?? [] })),
    );
    return {
      id: documentId,
      title,
      createdAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };
  }

  /** Top-k formatted context for a query, ready to inject into a prompt. */
  async retrieve(query: string, k = 4): Promise<string> {
    const retrieval = await retrieveRagContext(
      query,
      this.store,
      this.embedConfig,
      { k },
    );
    return formatRagContext(retrieval);
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.store.removeDocument(documentId);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
