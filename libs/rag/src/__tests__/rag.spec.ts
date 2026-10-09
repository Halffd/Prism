import { describe, expect, it } from '@jest/globals';
import {
  chunkDocument,
  InMemoryVectorStore,
  formatRagContext,
  type EmbeddedChunk,
} from '../index';

function mk(
  id: string,
  documentId: string,
  content: string,
  v: number[],
): EmbeddedChunk {
  return { id, documentId, content, index: 0, embedding: v };
}

describe('chunkDocument', () => {
  it('returns no chunks for empty text', () => {
    expect(chunkDocument('doc1', '')).toEqual([]);
  });

  it('splits on markdown headings', () => {
    const text = `Intro paragraph about apples.

## Section on Oranges

Oranges are citrus.`;
    const chunks = chunkDocument('doc1', text);
    expect(chunks.length).toBe(2);
    expect(chunks[0].content).toContain('apples');
    expect(chunks[1].content).toContain('Oranges are citrus');
  });

  it('applies a sliding window to long sections', () => {
    const text = 'word '.repeat(2000); // ~10k chars
    const chunks = chunkDocument('doc1', text, { maxTokens: 64 });
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: consecutive chunks share content
    const words0 = chunks[0].content.split(' ');
    const words1 = chunks[1].content.split(' ');
    const overlap = words1.filter((w) => words0.includes(w));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('produces stable, ordered ids', () => {
    const chunks = chunkDocument('d', 'one\n# H\n\ntwo\n# H2\n\nthree');
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.id).toBe(`d_chunk_${i}`);
    });
  });
});

describe('InMemoryVectorStore', () => {
  it('stores, filters by document, removes, and clears', async () => {
    const store = new InMemoryVectorStore();
    await store.add([
      mk('c1', 'fruit-doc', 'apples are red', [1, 0]),
      mk('c2', 'fruit-doc', 'bananas are yellow', [1, 0]),
      mk('c3', 'car-doc', 'cars have wheels', [0, 1]),
    ]);

    expect((await store.all()).length).toBe(3);
    expect((await store.all('fruit-doc')).length).toBe(2);

    await store.removeDocument('fruit-doc');
    const remaining = await store.all();
    expect(remaining.length).toBe(1);
    expect(remaining[0].documentId).toBe('car-doc');

    await store.clear();
    expect((await store.all()).length).toBe(0);
  });
});

describe('formatRagContext', () => {
  it('renders numbered chunks with document ids', () => {
    const text = formatRagContext({
      chunks: [
        {
          id: 'c1',
          documentId: 'docA',
          content: 'first chunk',
          index: 0,
          embedding: [],
        },
      ],
      scores: [0.9],
    });
    expect(text).toContain('[Retrieved Context]');
    expect(text).toContain('first chunk');
    expect(text).toContain('docA');
  });

  it('returns empty string for no chunks', () => {
    expect(formatRagContext({ chunks: [], scores: [] })).toBe('');
  });
});
