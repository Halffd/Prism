import { readFile } from 'fs/promises';
import { basename } from 'path';
import {
  chunkDocument,
  embedTexts,
  retrieveRagContext,
  formatRagContext,
  InMemoryVectorStore,
  type EmbedConfig,
  type RagDocument,
} from '@prism/rag';

/**
 * TUI RAG session. Documents are ingested from local file paths (the TUI runs
 * on the host, so filesystem access is the point) and embeddings live in an
 * in-memory store for the session.
 */
export class TUIRagSession {
  private store = new InMemoryVectorStore();
  private embedConfig: EmbedConfig;
  documents: RagDocument[] = [];

  constructor(aiConfig: AIConfigLike) {
    const openaiKey = (aiConfig.providerKeys ?? {})['openai'] || '';
    this.embedConfig = {
      provider: openaiKey ? 'openai' : 'ollama',
      openaiApiKey: openaiKey || undefined,
      ollamaUrl:
        (aiConfig.providerKeys ?? {})['ollama'] || 'http://localhost:11434',
    };
  }

  /** Read a local file, chunk + embed it, and remember it in the session. */
  async ingestPath(path: string): Promise<RagDocument> {
    const text = await readFile(path, 'utf-8');
    const title = basename(path);
    const documentId = `tui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const chunks = chunkDocument(documentId, text);
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

    const doc: RagDocument = {
      id: documentId,
      title,
      createdAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };
    this.documents.push(doc);
    return doc;
  }

  async retrieve(query: string, k = 4): Promise<string> {
    const retrieval = await retrieveRagContext(
      query,
      this.store,
      this.embedConfig,
      { k },
    );
    return formatRagContext(retrieval);
  }
}

interface AIConfigLike {
  providerKeys?: Record<string, string | undefined>;
}
