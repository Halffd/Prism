/**
 * Blaze-style snippet and hotkey model.
 *
 * AI Blaze stores reusable text snippets ("snippets") that expand when the
 * user types a trigger sequence in any editor on the page. The trigger is
 * matched against the text the user is typing, and the snippet is replaced
 * in place.
 *
 * Two trigger modes exist, mirroring Blaze's `standalone` / `anywhere`
 * options:
 *
 * - `standalone` — the trigger must be the entire content of the field.
 *   Typing `/fix` alone expands; `/fix this` does not.
 * - `anywhere` — the trigger expands wherever it appears, so `/fix` expands
 *   inside `/fix this` too.
 *
 * The model is shared by the extension popup, the content script (which
 * expands snippets in the host page) and the desktop apps, so it lives in
 * `@prism/shared-types` rather than in the extension alone.
 */

/**
 * How a snippet trigger is matched against the text around the caret.
 *
 * - `standalone`: the trigger must be the whole field content.
 * - `anywhere`: the trigger may appear anywhere in the field content.
 */
export type SnippetTriggerMode = 'standalone' | 'anywhere';

/**
 * What happens when a snippet expands.
 *
 * - `text`: replace the trigger with plain text.
 * - `html`: replace the trigger with rich text (HTML) — used for snippets
 *   that carry formatting, matching Blaze's `htmlStr` payload.
 * - `ai`: replace the trigger with an AI prompt; the expanded text becomes
 *   the prompt for the assistant.
 */
export type SnippetExpansionMode = 'text' | 'html' | 'ai';

/**
 * A single reusable snippet, modelled on Blaze's snippet record.
 */
export interface Snippet {
  id: string;
  /** Display name shown in the snippet manager. */
  name: string;
  /** The trigger sequence the user types to expand the snippet. */
  shortcut: string;
  /** Plain-text payload. */
  text: string;
  /** Optional rich-text payload used when `expansionMode` is `html`. */
  html?: string;
  /** Group the snippet belongs to; snippets in a group share a prefix. */
  group?: string;
  /** How the trigger is matched. Defaults to `standalone`. */
  triggerMode?: SnippetTriggerMode;
  /** What the expansion produces. Defaults to `text`. */
  expansionMode?: SnippetExpansionMode;
  /**
   * Optional keyboard binding that expands the snippet without typing the
   * trigger, e.g. `Ctrl+Shift+F`. Multiple bindings are allowed.
   */
  keyboardShortcuts?: string[];
  /** Marks a snippet that ships with Prism and cannot be deleted. */
  builtIn?: boolean;
  createdAt: number;
}

/**
 * A user-facing hotkey that toggles a prism feature, modelled on Blaze's
 * trigger options.
 */
export interface HotkeyBinding {
  id: string;
  /** Display name. */
  name: string;
  /**
   * Key combination, written with `+` separators and modifier names
   * `Ctrl`, `Cmd`, `Alt`, `Shift`. `Cmd` and `Ctrl` are treated as
   * interchangeable so one binding works on macOS and Windows.
   */
  combination: string;
  /**
   * The action the hotkey performs. `toggle` flips the mode on and off;
   * `action` runs it once.
   */
  kind: 'toggle' | 'action';
  /** Which feature the hotkey drives, e.g. `textSelection`. */
  mode?: string;
  /** Whether the hotkey is currently active (only meaningful for toggles). */
  enabled: boolean;
}

/**
 * Result of matching a typed trigger against the known snippets.
 */
export interface SnippetMatch {
  snippet: Snippet;
  /** The trigger text that matched, exactly as the user typed it. */
  matchedText: string;
  /** Text that should replace `matchedText`. */
  replacement: string;
  /** True when the match should replace rich text rather than plain text. */
  isHtml: boolean;
}

/**
 * Normalises a key combination so `ctrl+shift+f`, `Ctrl+Shift+F` and
 * `Cmd+Shift+F` compare equal. Modifier order is fixed and the trigger key
 * is lower-cased.
 */
export function normalizeCombination(combination: string): string {
  const parts = combination
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') {
      modifiers.add('ctrl');
    } else if (lower === 'cmd' || lower === 'meta' || lower === 'command') {
      modifiers.add('ctrl');
    } else if (lower === 'alt' || lower === 'option') {
      modifiers.add('alt');
    } else if (lower === 'shift') {
      modifiers.add('shift');
    } else if (!key) {
      key = lower;
    }
  }

  const ordered = ['ctrl', 'alt', 'shift'].filter((modifier) =>
    modifiers.has(modifier),
  );

  return [...ordered, key].filter(Boolean).join('+');
}

/**
 * True when the given keyboard event matches the combination.
 *
 * `Ctrl` and `Cmd` are interchangeable so a single binding covers macOS and
 * Windows. Modifiers must match exactly: a binding without `Shift` does not
 * fire when Shift is held.
 */
export function combinationMatchesEvent(
  combination: string,
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
): boolean {
  const normalized = normalizeCombination(combination);
  if (!normalized) {
    return false;
  }

  const parts = normalized.split('+');
  const key = parts.pop() ?? '';
  const wantsCtrl = parts.includes('ctrl');
  const wantsAlt = parts.includes('alt');
  const wantsShift = parts.includes('shift');

  const gotCtrl = event.ctrlKey || event.metaKey;
  const gotAlt = event.altKey;
  const gotShift = event.shiftKey;

  return (
    event.key.toLowerCase() === key &&
    gotCtrl === wantsCtrl &&
    gotAlt === wantsAlt &&
    gotShift === wantsShift
  );
}
