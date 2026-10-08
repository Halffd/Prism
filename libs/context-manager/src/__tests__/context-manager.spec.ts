import { describe, expect, it } from '@jest/globals';
import {
  assembleContext,
  estimateTokens,
  truncateToTokenBudget,
  importV2CharacterCard,
  exportV2CharacterCard,
} from '../lib/context-manager';
import type { Message, CharacterCard } from '@prism/shared-types';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with word count', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens(
      'the quick brown fox jumps over the lazy dog again and again',
    );
    expect(long).toBeGreaterThan(short);
  });
});

describe('truncateToTokenBudget', () => {
  it('keeps text within budget', () => {
    const text = 'word '.repeat(2000); // ~2000 tokens
    const result = truncateToTokenBudget(text, 100);
    expect(estimateTokens(result)).toBeLessThanOrEqual(120);
  });

  it('returns text unchanged when under budget', () => {
    expect(truncateToTokenBudget('short', 100)).toBe('short');
  });
});

describe('assembleContext', () => {
  const messages: Message[] = [
    { id: '1', role: 'user', content: 'first', timestamp: 1 },
    { id: '2', role: 'assistant', content: 'second', timestamp: 2 },
  ];

  it('includes system prompt and history', () => {
    const result = assembleContext({
      systemPrompt: 'You are helpful.',
      messages,
      userMessage: 'tell me more',
    });
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('injects world info entries matching keywords into system prompt', () => {
    const result = assembleContext({
      systemPrompt: 'sys',
      messages,
      userMessage: 'tell me about dragons',
      worldInfoEntries: [
        {
          id: 'wi1',
          worldInfoId: 'w',
          keys: ['dragon'],
          secondaryKeys: [],
          content: 'Dragons are fire-breathing reptiles.',
          comment: '',
          enabled: true,
          position: 'before-char',
          insertionOrder: 0,
          caseSensitive: false,
          matchWholeWords: false,
          useGroupScoring: false,
          scanDepth: 50,
          preventRecursion: false,
          delayUntilRecursion: 0,
          role: 'system',
          probability: 1,
          extensions: {},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(result.systemPrompt).toContain('fire-breathing');
    expect(result.activatedWorldInfoEntries?.length ?? 0).toBe(1);
    expect(result.activatedWorldInfoEntries?.[0].keys).toContain('dragon');
  });
});

describe('character card v2 round-trip', () => {
  const card: CharacterCard = {
    id: 'c1',
    name: 'Test Char',
    description: 'A test character',
    personality: 'friendly',
    scenario: 'testing',
    firstMessage: 'hi',
    createdAt: 1,
    updatedAt: 1,
  };

  it('exportV2CharacterCard produces v2 spec data', () => {
    const v2 = exportV2CharacterCard(card);
    expect(v2).toBeDefined();
    expect(v2.spec).toBe('chara_card_v2');
  });

  it('importV2CharacterCard reads exported data back', () => {
    const v2 = exportV2CharacterCard(card);
    const parsed = importV2CharacterCard(JSON.parse(JSON.stringify(v2)));
    expect(parsed.name).toBe('Test Char');
  });
});
