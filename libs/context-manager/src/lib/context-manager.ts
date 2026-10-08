import type {
  CharacterCard,
  PersonaProfile,
  PromptPreset,
  WorldInfoEntry,
  Message,
  PromptPosition,
  AssembledContext,
  ContextAssemblerConfig,
} from '@prism/shared-types';

const DEFAULT_ASSEMBLER_CONFIG: ContextAssemblerConfig = {
  maxTokens: 4096,
  systemPromptPosition: 'system',
  characterCardPosition: 'after-char',
  personaPosition: 'before-char',
  worldInfoPosition: 'after-system',
  presetPosition: 'before-char',
  includeWorldInfo: true,
  includeCharacterCard: true,
  includePersona: true,
  includePreset: true,
  worldInfoScanDepth: 50,
  worldInfoTokenBudget: 2048,
  worldInfoRecursive: true,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function truncateToTokenBudget(text: string, budget: number): string {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= budget) return text;
  const maxChars = Math.floor(budget * 3.5);
  return text.slice(0, maxChars);
}

function scanWorldInfo(
  entries: WorldInfoEntry[],
  text: string,
  scanDepth: number,
  recursive: boolean,
  tokenBudget: number,
): { activated: WorldInfoEntry[]; tokensUsed: number } {
  const scanText = text.slice(0, scanDepth * 200);
  const activated: WorldInfoEntry[] = [];
  let tokensUsed = 0;
  const visited = new Set<string>();

  const checkEntry = (entry: WorldInfoEntry): boolean => {
    if (!entry.enabled || visited.has(entry.id)) return false;
    if (entry.probability < 1 && Math.random() > entry.probability)
      return false;

    const haystack = entry.caseSensitive ? scanText : scanText.toLowerCase();
    const keys = entry.caseSensitive
      ? entry.keys
      : entry.keys.map((k) => k.toLowerCase());

    const primaryMatch = keys.some((k) => {
      if (entry.matchWholeWords) {
        const regex = new RegExp(
          `\\b${escapeRegex(k)}\\b`,
          entry.caseSensitive ? '' : 'i',
        );
        return regex.test(haystack);
      }
      return haystack.includes(k);
    });

    if (!primaryMatch) return false;

    if (entry.secondaryKeys.length > 0) {
      const secondaryHaystack = entry.caseSensitive
        ? scanText
        : scanText.toLowerCase();
      const secondaryKeys = entry.caseSensitive
        ? entry.secondaryKeys
        : entry.secondaryKeys.map((k) => k.toLowerCase());
      const secondaryMatch = secondaryKeys.some((k) =>
        entry.matchWholeWords
          ? new RegExp(
              `\\b${escapeRegex(k)}\\b`,
              entry.caseSensitive ? '' : 'i',
            ).test(secondaryHaystack)
          : secondaryHaystack.includes(k),
      );
      if (!secondaryMatch) return false;
    }

    return true;
  };

  const pass = (remaining: number): void => {
    let changed = false;
    for (const entry of entries.sort(
      (a, b) => a.insertionOrder - b.insertionOrder,
    )) {
      if (visited.has(entry.id)) continue;
      if (tokensUsed >= tokenBudget) break;

      if (checkEntry(entry)) {
        const entryTokens = estimateTokens(entry.content);
        if (tokensUsed + entryTokens <= tokenBudget) {
          activated.push(entry);
          visited.add(entry.id);
          tokensUsed += entryTokens;
          changed = true;
        }
      }
    }
    if (changed && recursive && remaining > 0) {
      pass(remaining - 1);
    }
  };

  pass(recursive ? 10 : 0);

  return { activated, tokensUsed };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function assembleContext(params: {
  systemPrompt: string;
  messages: Message[];
  character?: CharacterCard;
  characters?: CharacterCard[]; // Multiple characters for group chat
  persona?: PersonaProfile;
  preset?: PromptPreset;
  worldInfoEntries?: WorldInfoEntry[];
  userMessage?: string;
  config?: Partial<ContextAssemblerConfig>;
}): AssembledContext {
  const cfg = { ...DEFAULT_ASSEMBLER_CONFIG, ...params.config };
  const activatedWorldInfo: WorldInfoEntry[] = [];
  const breakdown = {
    system: 0,
    character: 0,
    characters: {} as Record<string, number>,
    persona: 0,
    worldInfo: 0,
    preset: 0,
    history: 0,
    input: 0,
  };

  const sections: {
    position: PromptPosition;
    role: 'system' | 'user' | 'assistant';
    text: string;
    key: 'system' | 'character' | 'persona' | 'worldInfo' | 'preset';
  }[] = [];

  sections.push({
    position: 'system',
    role: 'system',
    text: params.systemPrompt,
    key: 'system',
  });

  // Multi-character group chat mode
  if (
    cfg.includeCharacterCard &&
    params.characters &&
    params.characters.length > 1
  ) {
    const charBudget = cfg.groupChat?.characterTokenBudget ?? 1024;
    const separator = cfg.groupChat?.characterSeparator ?? '\n---\n';
    const multiCharText = buildMultiCharacterPrompt(
      params.characters,
      charBudget,
      separator,
    );
    // Track per-character token counts
    for (const card of params.characters) {
      breakdown.characters[card.id] = estimateTokens(
        truncateToTokenBudget(buildCharacterPrompt(card), charBudget),
      );
    }
    sections.push({
      position: cfg.characterCardPosition,
      role: 'system',
      text: multiCharText,
      key: 'character',
    });
  } else if (cfg.includeCharacterCard && params.character) {
    // Single character mode (original behavior)
    const charText = buildCharacterPrompt(params.character);
    sections.push({
      position: cfg.characterCardPosition,
      role: 'system',
      text: charText,
      key: 'character',
    });
  }

  if (cfg.includePersona && params.persona) {
    const personaText = buildPersonaPrompt(params.persona);
    sections.push({
      position: cfg.personaPosition,
      role: 'system',
      text: personaText,
      key: 'persona',
    });
  }

  if (cfg.includePreset && params.preset) {
    const presetText = buildPresetPrompt(params.preset);
    sections.push({
      position: cfg.presetPosition,
      role: 'system',
      text: presetText,
      key: 'preset',
    });
  }

  if (
    cfg.includeWorldInfo &&
    params.worldInfoEntries &&
    params.worldInfoEntries.length > 0
  ) {
    const scanText =
      params.messages
        .slice(-5)
        .map((m) => m.content)
        .join('\n') + (params.userMessage ? '\n' + params.userMessage : '');
    const { activated, tokensUsed } = scanWorldInfo(
      params.worldInfoEntries,
      scanText,
      cfg.worldInfoScanDepth,
      cfg.worldInfoRecursive,
      cfg.worldInfoTokenBudget,
    );
    if (activated.length > 0) {
      const wiText = activated.map((e) => e.content).join('\n\n');
      sections.push({
        position: cfg.worldInfoPosition,
        role: 'system',
        text: wiText,
        key: 'worldInfo',
      });
      breakdown.worldInfo = tokensUsed;
      activatedWorldInfo.push(...activated);
    }
  }

  const orderedSections = sections.sort(
    (a, b) => positionOrder(a.position) - positionOrder(b.position),
  );

  let systemPrompt = '';
  for (const section of orderedSections) {
    if (section.text) {
      breakdown[section.key] = estimateTokens(section.text);
      systemPrompt += section.text + '\n\n';
    }
  }

  breakdown.history = params.messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );
  if (params.userMessage) {
    breakdown.input = estimateTokens(params.userMessage);
  }

  // Calculate total token count, excluding the characters sub-object
  const { characters: charBreakdown, ...numericBreakdown } = breakdown;
  const charTotal = charBreakdown
    ? Object.values(charBreakdown).reduce((sum, v) => sum + v, 0)
    : 0;
  const numericTotal = Object.values(numericBreakdown).reduce(
    (sum, v) => sum + v,
    0,
  );

  return {
    systemPrompt: systemPrompt.trim(),
    messages: params.messages,
    tokenCount: numericTotal + charTotal,
    tokenBreakdown: breakdown,
    activatedWorldInfoEntries: activatedWorldInfo,
  };
}

function positionOrder(pos: PromptPosition): number {
  const order: Record<PromptPosition, number> = {
    system: 0,
    'before-system': 1,
    'after-system': 2,
    'before-char': 3,
    'after-char': 4,
    'before-history': 5,
    'after-history': 6,
    'before-input': 7,
    'after-input': 8,
  };
  return order[pos] ?? 5;
}

function buildCharacterPrompt(card: CharacterCard): string {
  const parts: string[] = [];
  if (card.name) parts.push(`[Character: ${card.name}]`);
  if (card.description) parts.push(card.description);
  if (card.personality) parts.push(`Personality: ${card.personality}`);
  if (card.scenario) parts.push(`Scenario: ${card.scenario}`);
  if (card.mesExample) parts.push(`Example messages:\n${card.mesExample}`);
  if (card.systemPrompt) parts.push(card.systemPrompt);
  if (card.postHistoryInstructions) parts.push(card.postHistoryInstructions);
  return parts.join('\n\n');
}

/**
 * Build a combined prompt for multiple characters in group chat mode.
 * Each character card is rendered individually with its name header,
 * then all are joined with a separator.
 */
function buildMultiCharacterPrompt(
  cards: CharacterCard[],
  tokenBudgetPerChar: number = 1024,
  separator: string = '\n---\n',
): string {
  const rendered = cards.map((card) => {
    const fullPrompt = buildCharacterPrompt(card);
    return truncateToTokenBudget(fullPrompt, tokenBudgetPerChar);
  });
  return rendered.join(separator);
}

function buildPersonaPrompt(persona: PersonaProfile): string {
  const parts: string[] = [];
  if (persona.name) parts.push(`[User Persona: ${persona.name}]`);
  if (persona.description) parts.push(persona.description);
  if (persona.personality) parts.push(`Personality: ${persona.personality}`);
  if (persona.scenario) parts.push(`Scenario: ${persona.scenario}`);
  return parts.join('\n\n');
}

function buildPresetPrompt(preset: PromptPreset): string {
  const enabled = preset.prompts
    .filter((p) => p.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return enabled.map((p) => p.content).join('\n\n');
}

export interface V2CharacterData {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
  };
}

export function importV2CharacterCard(json: unknown): CharacterCard {
  const raw = json as V2CharacterData;
  const d = raw.data;
  const now = Date.now();
  return {
    id: `char_${now}_${Math.random().toString(36).slice(2, 8)}`,
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: d.name ?? 'Unnamed',
    description: d.description ?? '',
    personality: d.personality ?? '',
    scenario: d.scenario ?? '',
    firstMes: d.first_mes ?? '',
    mesExample: d.mes_example ?? '',
    creatorNotes: d.creator_notes ?? '',
    systemPrompt: d.system_prompt ?? '',
    postHistoryInstructions: d.post_history_instructions ?? '',
    alternateGreetings: d.alternate_greetings ?? [],
    tags: d.tags ?? [],
    creator: d.creator ?? '',
    characterVersion: d.character_version ?? '',
    extensions: d.extensions ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

export function exportV2CharacterCard(card: CharacterCard): V2CharacterData {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMes,
      mes_example: card.mesExample,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings,
      tags: card.tags,
      creator: card.creator,
      character_version: card.characterVersion,
      extensions: card.extensions,
    },
  };
}

export async function importPngCharacterCard(
  file: File,
): Promise<CharacterCard> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const tEXtMarker = [0x74, 0x45, 0x58, 0x74];
  let charaChunkStart = -1;
  for (let i = 8; i < bytes.length - 8; i++) {
    if (
      bytes[i] === tEXtMarker[0] &&
      bytes[i + 1] === tEXtMarker[1] &&
      bytes[i + 2] === tEXtMarker[2] &&
      bytes[i + 3] === tEXtMarker[3]
    ) {
      const keyword = new TextDecoder().decode(bytes.slice(i + 4, i + 12));
      if (keyword.startsWith('chara\0')) {
        charaChunkStart = i + 12;
        break;
      }
    }
  }

  if (charaChunkStart === -1) {
    throw new Error(
      'No character card data found in PNG. The file may not contain an embedded character card.',
    );
  }

  let chunkEnd = charaChunkStart;
  while (chunkEnd < bytes.length && bytes[chunkEnd] !== 0) {
    chunkEnd++;
  }
  if (chunkEnd >= bytes.length) {
    const pngTextChunks = await extractPngTextChunks(bytes);
    const charaBase64 = pngTextChunks.get('chara');
    if (!charaBase64) {
      throw new Error('Could not extract character card data from PNG.');
    }
    const jsonStr = atob(charaBase64);
    const json = JSON.parse(jsonStr);
    return importV2CharacterCard(json);
  }

  const base64Str = new TextDecoder().decode(
    bytes.slice(charaChunkStart, chunkEnd),
  );
  const jsonStr = atob(base64Str);
  const json = JSON.parse(jsonStr);
  return importV2CharacterCard(json);
}

async function extractPngTextChunks(
  bytes: Uint8Array,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let offset = 8;

  while (offset < bytes.length) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (type === 'tEXt') {
      const chunkData = bytes.slice(offset + 8, offset + 8 + length);
      const nullIndex = chunkData.indexOf(0);
      if (nullIndex !== -1) {
        const keyword = new TextDecoder().decode(chunkData.slice(0, nullIndex));
        const value = new TextDecoder().decode(chunkData.slice(nullIndex + 1));
        result.set(keyword, value);
      }
    }

    if (type === 'IEND') break;
    offset += 12 + length;
  }

  return result;
}

export {
  DEFAULT_ASSEMBLER_CONFIG,
  estimateTokens,
  truncateToTokenBudget,
  buildMultiCharacterPrompt,
};
