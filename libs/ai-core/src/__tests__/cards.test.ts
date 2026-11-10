// Card/prompt-engine tests over the core wasm pkg (node target).
//
// The Rust side owns the logic (crates/prism-core/src/cards.rs, 13
// tests); these assert the TS binding marshals correctly.

import {
  loadCoreNode,
  parseCharacterCard,
  expandMacros,
  scanLore,
  emptyLoreScan,
  macroContext,
  buildPrompt,
  lorePositionLabels,
  validateLoreEntry,
  type CoreCharacterCard,
  type CoreCharacterBook,
  type CoreLoreEntry,
  type CorePersona,
} from '../index';

const core = loadCoreNode();

describe('character cards (core bindings)', () => {
  const cardJson = JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      description: 'A starship engineer.',
      personality: 'witty, cautious',
      scenario: 'Aboard the reactor deck',
      first_mes: '*looks up* Need something?',
      mes_example: '<START>\n{{user}}: Hi\n{{char}}: *waves*',
      alternate_greetings: ['*welding*'],
    },
  });

  it('parses a V2 card file', () => {
    const card = parseCharacterCard(core, cardJson);
    expect(card.name).toBe('Aria');
    expect(card.description).toBe('A starship engineer.');
    expect(card.alternate_greetings).toEqual(['*welding*']);
  });

  it('parses V1 cards (flat fields)', () => {
    const card = parseCharacterCard(
      core,
      JSON.stringify({ name: 'Old', description: 'd', personality: 'p' }),
    );
    expect(card.name).toBe('Old');
    expect(card.personality).toBe('p');
  });

  it('rejects non-Prism documents', () => {
    expect(() => parseCharacterCard(core, 'not json')).toThrow();
    expect(() => parseCharacterCard(core, '{"app":"other"}')).toThrow();
  });

  it('expands all macros and leaves unknown ones verbatim', () => {
    const ctx = macroContext(
      { name: 'Aria', description: 'eng', personality: 'witty', scenario: 'deck' },
      { name: 'Sam', description: 'a pilot' },
    );
    const out = expandMacros(
      core,
      '{{char}}|{{user}}|{{persona}}|{{description}}|{{personality}}|{{scenario}}|{{nope}}',
      ctx,
    );
    expect(out).toBe('Aria|Sam|Sam: a pilot|eng|witty|deck|{{nope}}');
  });

  it('lore position labels come from the core', () => {
    const labels = lorePositionLabels(core);
    expect(labels).toEqual([
      { position: 'before_char', label: 'Before character' },
      { position: 'after_char', label: 'After character' },
    ]);
  });

  it('validates lore entries', () => {
    expect(
      validateLoreEntry(core, { keys: ['reactor'], content: 'hum' }),
    ).toBeNull();
    expect(
      validateLoreEntry(core, { keys: [], content: 'no keys' }),
    ).toMatch(/keys|constant/);
  });
});

describe('lore scanning (core bindings)', () => {
  const book: CoreCharacterBook = {
    entries: [
      { keys: ['reactor'], content: 'The reactor hums.', enabled: true },
      { constant: true, content: 'Day 3 on deck.', enabled: true },
      { keys: ['absent'], content: 'never', enabled: true },
    ],
  };

  it('matches keyword + constant entries and skips absent ones', () => {
    const scan = scanLore(core, 'Check the reactor!', [], book);
    const before = scan.before_char.map((e) => e.content);
    expect(before).toContain('The reactor hums.');
    expect(before).toContain('Day 3 on deck.');
    expect(before).not.toContain('never');
  });

  it('respects the token budget and reports drops', () => {
    const tight: CoreCharacterBook = {
      token_budget: 50,
      entries: [
        { constant: true, content: 'x'.repeat(80) },
        { constant: true, content: 'y'.repeat(80) },
        { constant: true, content: 'z'.repeat(80) },
      ],
    };
    const scan = scanLore(core, '', [], tight);
    expect(scan.before_char.length).toBe(2);
    expect(scan.dropped_for_budget).toBe(1);
  });

  it('emptyLoreScan is a valid empty scan', () => {
    const scan = emptyLoreScan(core);
    expect(scan.before_char).toEqual([]);
    expect(scan.after_char).toEqual([]);
    expect(scan.dropped_for_budget).toBe(0);
  });

  it('keyword entries match within scan_depth history', () => {
    const scan = scanLore(core, 'nothing', ['a reactor!', 'other'], book);
    expect(scan.before_char.map((e) => e.content)).toContain('The reactor hums.');
  });
});

describe('prompt assembly (core bindings)', () => {
  const card: CoreCharacterCard = {
    name: 'Aria',
    description: 'engineer',
    personality: 'witty',
    scenario: 'deck',
    mes_example: '<START>\n{{user}}: hi\n{{char}}: yo',
    post_history_instructions: 'Stay in character as {{char}}.',
  };
  const persona: CorePersona = { name: 'Sam', description: 'a pilot' };

  it('assembles system, lore, examples, then the conversation', () => {
    const book: CoreCharacterBook = {
      entries: [
        { constant: true, content: 'Lore line', position: 'after_char', enabled: true },
      ],
    };
    const lore = scanLore(core, '', [], book);
    const msgs = buildPrompt(core, {
      card,
      persona,
      history: [{ role: 'user', content: 'Hello' }],
      lore,
      user_input: 'Need help',
    });

    // Last message is the user turn.
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'Need help' });
    // Character block expanded.
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('engineer');
    expect(joined).toContain('witty');
    // Lore landed after the character.
    expect(joined).toContain('Lore line');
    // Example dialogue and post-history are macro-expanded.
    expect(joined).toContain('Sam: hi');
    expect(joined).toContain('Stay in character as Aria.');
    // No raw macros survive.
    expect(joined).not.toContain('{{char}}');
    expect(joined).not.toContain('{{user}}');
  });

  it('system_override replaces the card system prompt', () => {
    const msgs = buildPrompt(core, {
      card: { ...card, system_prompt: 'card system' },
      persona,
      history: [],
      lore: emptyLoreScan(core),
      user_input: '',
      system_override: 'host system',
    });
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain('host system');
    expect(contents).not.toContain('card system');
  });

  it('preserves message images in history', () => {
    const msgs = buildPrompt(core, {
      card,
      persona,
      history: [{ role: 'user', content: 'look', images: ['data:image/png;base64,AA'] }],
      lore: emptyLoreScan(core),
      user_input: '',
    });
    const user = msgs.find((m) => m.content === 'look');
    expect(user?.images).toEqual(['data:image/png;base64,AA']);
  });

  it('accepts a null lore scan (no book yet)', () => {
    const msgs = buildPrompt(core, {
      card,
      persona,
      history: [],
      lore: null,
      user_input: 'hello',
    });
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('reports errors on bad input instead of returning junk', () => {
    expect(() =>
      buildPrompt(core, {
        // Missing required `card.name`
        card: { ...card, name: undefined } as unknown as CoreCharacterCard,
        persona,
        history: [],
        lore: emptyLoreScan(core),
        user_input: '',
      }),
    ).toThrow();
  });
});
