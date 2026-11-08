/**
 * Snippet trigger matching, modelled on AI Blaze's replacement resolution.
 *
 * Blaze accumulates the characters the user types, asks the background for a
 * prefix match, and only expands once the full trigger has been typed. The
 * matcher here is the pure part of that: given the text the user has typed
 * so far and the known snippets, decide whether a snippet expands, and
 * produce the exact replacement.
 *
 * Keeping this pure and shared means the content script (expanding in the
 * host page) and the popup (expanding in its own textarea) agree on
 * exactly when a snippet fires.
 */

import type {
  Snippet,
  SnippetMatch,
  SnippetTriggerMode,
} from './snippet.types';

/**
 * True when the trigger characters the user has typed so far could still
 * become a valid trigger.
 *
 * This drives the "block the site's own hotkeys" behaviour: while the user
 * is part-way through typing `/fix`, the page should not react to the `/`
 * as a shortcut of its own.
 */
export function isPartialTrigger(
  typed: string,
  snippets: readonly Snippet[],
): boolean {
  if (!typed) {
    return false;
  }

  const lower = typed.toLowerCase();

  return snippets.some((snippet) => {
    if (!snippet.shortcut) {
      return false;
    }
    const trigger = snippet.shortcut.toLowerCase();
    return trigger.startsWith(lower);
  });
}

/**
 * Finds the snippet that should expand for the given typed text.
 *
 * `standalone` snippets only match when the whole text is the trigger.
 * `anywhere` snippets match when the trigger occurs inside the text, in
 * which case only that occurrence is replaced.
 *
 * When several snippets match, the longest trigger wins so a more specific
 * trigger is never shadowed by a shorter one.
 */
export function matchSnippet(
  typed: string,
  snippets: readonly Snippet[],
): SnippetMatch | null {
  if (!typed) {
    return null;
  }

  const candidates: SnippetMatch[] = [];

  for (const snippet of snippets) {
    if (!snippet.shortcut) {
      continue;
    }

    const triggerMode: SnippetTriggerMode = snippet.triggerMode ?? 'standalone';
    const replacement = buildReplacement(snippet);

    if (triggerMode === 'standalone') {
      if (typed.trim() === snippet.shortcut.trim()) {
        candidates.push({
          snippet,
          matchedText: snippet.shortcut,
          replacement,
          isHtml: snippet.expansionMode === 'html' && !!snippet.html,
        });
      }
      continue;
    }

    const index = typed.indexOf(snippet.shortcut);
    if (index !== -1) {
      candidates.push({
        snippet,
        matchedText: snippet.shortcut,
        replacement,
        isHtml: snippet.expansionMode === 'html' && !!snippet.html,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Longest trigger wins; ties are broken by name so the result is stable.
  candidates.sort((a, b) => {
    const byLength = b.snippet.shortcut.length - a.snippet.shortcut.length;
    if (byLength !== 0) {
      return byLength;
    }
    return a.snippet.name.localeCompare(b.snippet.name);
  });

  return candidates[0];
}

/**
 * The text a snippet expands to. HTML snippets fall back to their plain
 * text when no HTML payload is present.
 */
function buildReplacement(snippet: Snippet): string {
  if (snippet.expansionMode === 'html' && snippet.html) {
    return snippet.html;
  }
  return snippet.text;
}

/**
 * The trigger text that should be removed from the field before the
 * replacement is inserted.
 *
 * For `standalone` snippets the whole typed text is replaced; for
 * `anywhere` snippets only the matched occurrence is.
 */
export function matchedTextFor(
  match: SnippetMatch,
  typed: string,
): string {
  if ((match.snippet.triggerMode ?? 'standalone') === 'standalone') {
    return typed;
  }
  return match.matchedText;
}
