/**
 * Emoji, icon and shape palettes for the prompt composer.
 *
 * The data is bundled rather than fetched so the picker works offline and
 * opens instantly. Emoji come from a curated list grouped into the
 * categories people actually reach for; shapes are Unicode geometric and
 * symbol characters that render as text in any input.
 *
 * Blaze has no emoji/icon/shape palette at all — this is a Prism addition
 * that fills the gap the user asked for.
 */

export type PaletteKind = 'emoji' | 'shape';

export interface PaletteCategory {
  id: string;
  label: string;
  /** Emoji or shape characters belonging to this category. */
  items: string[];
  /** Short label used for the category chip. */
  shortLabel?: string;
}

/**
 * Emoji categories. Each list is intentionally short: these are the
 * characters people reach for while writing prompts, not the full Unicode
 * set.
 */
export const EMOJI_CATEGORIES: PaletteCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys & People',
    shortLabel: '😀',
    items: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐',
      '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔',
      '😪', '🤤', '😴', '😷', '🤒', '🤕', '🥵', '🥶', '🥴', '😵',
      '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures & Body',
    shortLabel: '👋',
    items: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
      '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏',
      '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '👃',
      '🧠', '🫀', '👀', '👁️', '👅', '👄', '💋', '🧑', '👨', '👩',
    ],
  },
  {
    id: 'animals',
    label: 'Animals & Nature',
    shortLabel: '🐻',
    items: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆',
      '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋',
      '🐌', '🐞', '🐜', '🕷️', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐',
      '🐠', '🐟', '🐬', '🐳', '🦈', '🌵', '🌲', '🌴', '🌱', '🌿',
      '☘️', '🍀', '🌸', '🌺', '🌻', '🌹', '🌷', '💐', '🌾', '🌳',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    shortLabel: '🍎',
    items: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈',
      '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦',
      '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐',
      '🍞', '🥖', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🍔', '🍟',
      '🍕', '🌭', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍣',
      '🍰', '🎂', '🧁', '🍪', '🍩', '🍫', '🍬', '☕', '🍵', '🧋',
    ],
  },
  {
    id: 'activity',
    label: 'Activity & Travel',
    shortLabel: '⚽',
    items: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
      '🪀', '🏓', '🏸', '🏒', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹',
      '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌',
      '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾',
      '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚴', '🏆',
      '🎯', '🎮', '🎲', '🧩', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    shortLabel: '🚀',
    items: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐',
      '🛻', '🚚', '🚛', '🚜', '🛵', '🏍️', '🛺', '🚲', '🛴', '🛹',
      '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝',
      '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶',
      '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🗺️', '🧭',
      '🏔️', '⛰️', '🌋', '🗻', '🏕️', '🏖️', '🏜️', '🏝️', '🏙️', '🏠',
    ],
  },
  {
    id: 'objects',
    label: 'Objects & Tools',
    shortLabel: '💡',
    items: [
      '⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🕹️', '💽', '💾',
      '💿', '📀', '📷', '📸', '📹', '🎥', '📞', '☎️', '📟', '📠',
      '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏰', '⌛', '🔋',
      '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶',
      '💷', '🪙', '💰', '💳', '🧾', '💎', '⚖️', '🪜', '🧰', '🪛',
      '🔧', '🔨', '⚒️', '🛠️', '🗡️', '⚔️', '🪓', '🏹', '🛡️', '🔗',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    shortLabel: '❤️',
    items: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
      '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
      '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐',
      '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳',
      '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️',
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺',
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    shortLabel: '🏳️',
    items: [
      '🏳️', '🏴', '🏁', '🚩', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷',
      '🇪🇸', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇲🇽', '🇿🇦', '🇳🇬',
      '🇰🇪', '🇸🇦', '🇦🇪', '🇹🇷', '🇵🇱', '🇺🇦', '🇳🇴', '🇸🇪', '🇫🇮', '🇩🇰',
      '🇵🇹', '🇮🇪', '🇵🇭', '🇮🇩', '🇻🇳', '🇹🇭', '🇲🇾', '🇸🇬', '🇳🇿', '🇵🇦',
    ],
  },
];

/**
 * Unicode geometric and symbol characters usable as inline shapes.
 *
 * These are plain characters, so they paste into any text field, including
 * code editors and terminals.
 */
export const SHAPE_CATEGORIES: PaletteCategory[] = [
  {
    id: 'geometry',
    label: 'Geometric',
    shortLabel: '◆',
    items: [
      '◆', '◇', '◈', '◉', '◎', '●', '○', '◍', '◌', '◊',
      '■', '□', '▣', '▤', '▥', '▦', '▧', '▨', '▩', '▪',
      '▫', '▬', '▭', '▮', '▯', '▰', '▱', '▲', '△', '▴',
      '▵', '▶', '▷', '▸', '▹', '►', '▻', '▼', '▽', '▾',
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    shortLabel: '→',
    items: [
      '←', '↑', '→', '↓', '↔', '↕', '↖', '↗', '↘', '↙',
      '↩', '↪', '⇐', '⇑', '⇒', '⇓', '⇔', '⇕', '⇠', '⇡',
      '⇢', '⇣', '⇤', '⇥', '⇦', '⇧', '⇨', '⇩', '⇪', '⇫',
      '⟵', '⟶', '⟷', '⟹', '⟺', '⇚', '⇛', '⬅', '➡', '⬆',
    ],
  },
  {
    id: 'math',
    label: 'Math & Logic',
    shortLabel: '∑',
    items: [
      '∀', '∁', '∂', '∃', '∄', '∅', '∇', '∈', '∉', '∋',
      '∏', '∑', '−', '∓', '∔', '∕', '∗', '∘', '∙', '√',
      '∛', '∜', '∞', '∝', '∠', '∡', '∢', '∣', '∥', '∩',
      '∪', '∫', '∬', '∭', '∮', '∴', '∵', '∶', '∼', '≅',
      '≈', '≠', '≡', '≤', '≥', '≪', '≫', '⊂', '⊃', '⊆',
    ],
  },
  {
    id: 'blocks',
    label: 'Blocks & Bars',
    shortLabel: '█',
    items: [
      '█', '▓', '▒', '░', '▀', '▄', '▌', '▐', '▁', '▂',
      '▃', '▅', '▆', '▇', '▉', '▊', '▋', '▍', '▎', '▏',
      '▔', '▕', '│', '┃', '┌', '┐', '└', '┘', '├', '┤',
      '┬', '┴', '┼', '╭', '╮', '╯', '╰', '═', '║', '╬',
    ],
  },
  {
    id: 'weather',
    label: 'Weather & Sky',
    shortLabel: '☀',
    items: [
      '☀', '☁', '☂', '☃', '☄', '★', '☆', '✦', '✧', '✩',
      '✪', '✫', '✬', '✭', '✮', '✯', '✰', '☾', '☽', '☼',
      '⚡', '❄', '❅', '❆', '❇', '❈', '❉', '❊', '❋', '☘',
      '♁', '♂', '♃', '♄', '♅', '♆', '♇', '♈', '♉', '♊',
    ],
  },
];

/**
 * Flat list of every palette entry, used for search.
 */
export function allPaletteItems(kind: PaletteKind): string[] {
  const categories =
    kind === 'emoji' ? EMOJI_CATEGORIES : SHAPE_CATEGORIES;
  return categories.flatMap((category) => category.items);
}

/**
 * Searches palette entries by name or keyword.
 *
 * The emoji list has no names attached (it is a plain character list), so
 * search matches the character itself or one of its keywords. Shapes carry
 * a descriptive keyword map so they can be found by meaning.
 */
export function searchPalette(
  kind: PaletteKind,
  query: string,
): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return allPaletteItems(kind);
  }

  const keywords = SHAPE_KEYWORDS;

  return allPaletteItems(kind).filter((item) => {
    if (item.toLowerCase().includes(normalized)) {
      return true;
    }
    const itemKeywords = keywords[item];
    return itemKeywords ? itemKeywords.some((word) => word.includes(normalized)) : false;
  });
}

/**
 * Search keywords for the shape characters, keyed by the character itself.
 *
 * Only shapes that are hard to identify by sight need an entry.
 */
const SHAPE_KEYWORDS: Record<string, string[]> = {
  '◆': ['filled diamond', 'diamond', 'rhombus'],
  '◇': ['outline diamond', 'hollow diamond', 'diamond'],
  '●': ['filled circle', 'dot', 'circle'],
  '○': ['outline circle', 'hollow circle', 'circle'],
  '■': ['filled square', 'square', 'box'],
  '□': ['outline square', 'hollow square', 'box'],
  '▲': ['filled triangle up', 'triangle', 'up'],
  '▼': ['filled triangle down', 'triangle', 'down'],
  '▶': ['filled triangle right', 'play', 'triangle', 'right'],
  '◀': ['filled triangle left', 'triangle', 'left'],
  '★': ['filled star', 'star'],
  '☆': ['outline star', 'star'],
  '→': ['right arrow', 'arrow', 'right'],
  '←': ['left arrow', 'arrow', 'left'],
  '↑': ['up arrow', 'arrow', 'up'],
  '↓': ['down arrow', 'arrow', 'down'],
  '↔': ['left right arrow', 'arrow', 'both'],
  '█': ['full block', 'block', 'bar', 'solid'],
  '░': ['light shade', 'block', 'shade'],
  '▒': ['medium shade', 'block', 'shade'],
  '▓': ['dark shade', 'block', 'shade'],
  '│': ['vertical line', 'line', 'box drawing'],
  '─': ['horizontal line', 'line', 'box drawing'],
  '∑': ['sum', 'sigma', 'math'],
  '√': ['square root', 'root', 'math'],
  '∞': ['infinity', 'infinite', 'math'],
  '≠': ['not equal', 'math'],
  '≤': ['less than or equal', 'math'],
  '≥': ['greater than or equal', 'math'],
  '±': ['plus minus', 'math'],
  '×': ['multiply', 'times', 'math'],
  '÷': ['divide', 'math'],
  '✓': ['check mark', 'check', 'tick'],
  '✔': ['heavy check mark', 'check', 'tick'],
  '✗': ['cross mark', 'x', 'fail'],
  '✘': ['heavy cross mark', 'x', 'fail'],
  '⚠': ['warning', 'caution'],
  '⚡': ['lightning', 'zap', 'power'],
  '☀': ['sun', 'weather'],
  '☁': ['cloud', 'weather'],
  '❄': ['snowflake', 'snow', 'weather'],
  '☾': ['moon', 'weather'],
  '♥': ['heart', 'love'],
  '♦': ['diamond', 'suit'],
  '♠': ['spade', 'suit'],
  '♣': ['club', 'suit'],
};

/** Categories for a palette kind. */
export function paletteCategories(kind: PaletteKind): PaletteCategory[] {
  return kind === 'emoji' ? EMOJI_CATEGORIES : SHAPE_CATEGORIES;
}
