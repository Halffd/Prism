import type { EmbeddedChunk } from '@prism/rag';
import type { VectorStore } from '@prism/rag';

/**
 * IndexedDB-backed vector store via Dexie. Persists embedded chunks across
 * sessions so documents are only ingested once.
 */
export class DexieVectorStore implements VectorStore {
  private dbPromise: Promise<DexieVectorDb>;

  constructor(dbName = 'PrismRAG') {
    this.dbPromise = import('dexie').then(({ Dexie }) => {
      const db = new Dexie(dbName) as unknown as DexieVectorDb;
      db.version(1).stores({
        chunks: 'id, documentId',
      });
      return db;
    });
  }

  async add(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = await this.dbPromise;
    await db.chunks.bulkPut(chunks);
  }

  async all(documentId?: string): Promise<EmbeddedChunk[]> {
    const db = await this.dbPromise;
    if (documentId === undefined) {
      return db.chunks.toArray();
    }
    return db.chunks.where('documentId').equals(documentId).toArray();
  }

  async removeDocument(documentId: string): Promise<void> {
    const db = await this.dbPromise;
    await db.chunks.where('documentId').equals(documentId).delete();
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.chunks.clear();
  }
}

/** Minimal typed Dexie surface for the chunks table. */
interface DexieVectorDb {
  version(n: number): { stores(s: Record<string, string>): unknown };
  chunks: {
    bulkPut(items: EmbeddedChunk[]): Promise<void>;
    toArray(): Promise<EmbeddedChunk[]>;
    where(index: string): {
      equals(value: string): {
        toArray(): Promise<EmbeddedChunk[]>;
        delete(): Promise<void>;
      };
    };
    clear(): Promise<void>;
  };
}
