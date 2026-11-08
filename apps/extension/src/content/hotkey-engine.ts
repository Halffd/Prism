/**
 * Page-level hotkey and snippet engine.
 *
 * This is the content-script half of Prism's Blaze-style behaviour. It
 * watches what the user types in any editable on the page and:
 *
 * 1. Expands snippets when their trigger is typed (Blaze's core snippet
 *    behaviour), and
 * 2. Runs hotkey bindings — `Ctrl+Shift+T` and friends — anywhere on the
 *    page, not just inside the extension popup.
 *
 * The engine deliberately mirrors Blaze's approach: listeners are attached
 * in the capture phase so the extension sees the keystroke before the page
 * does, and a partially-typed trigger suppresses the page's own handling so
 * sites like YouTube or Gmail do not react to the same characters.
 */

import {
  combinationMatchesEvent,
  matchSnippet,
  isPartialTrigger,
  type HotkeyBinding,
  type Snippet,
} from '@prism/shared-types';
import {
  findEditableHost,
  isEditableTarget,
  isInputElement,
  isTextAreaElement,
  isCursorManipulableInput,
} from './editable-target';
import {
  insertTextIntoEditable,
  replaceRangeWithText,
} from './text-insertion';

export interface HotkeyEngineOptions {
  /** Called when a hotkey with a `mode` fires, so the caller can apply it. */
  onToggleMode?: (mode: string, enabled: boolean) => void;
  /** Called when a hotkey without a `mode` fires. */
  onAction?: (binding: HotkeyBinding) => void;
  /** Called after a snippet expands, for user feedback. */
  onSnippetExpanded?: (snippet: Snippet) => void;
  /** Returns the snippets currently known to the engine. */
  getSnippets: () => Snippet[];
  /** Returns the hotkey bindings currently known to the engine. */
  getHotkeys: () => HotkeyBinding[];
  /**
   * Returns the mode states the engine toggles, keyed by mode name. Used so
   * a toggle hotkey can flip a mode that is currently off.
   */
  getModeState?: (mode: string) => boolean;
}

interface HotkeyEngine {
  /** Attaches the engine's listeners. */
  start(): void;
  /** Detaches the engine's listeners. */
  stop(): void;
  /** Re-reads the snippets and hotkeys the engine works from. */
  refresh(): Promise<void>;
}

/** How long a partially-typed trigger is remembered, in milliseconds. */
const PARTIAL_TRIGGER_TIMEOUT = 5000;

/**
 * Creates the page-level hotkey and snippet engine.
 */
export function createHotkeyEngine(
  options: HotkeyEngineOptions,
): HotkeyEngine {
  let snippets: Snippet[] = [];
  let hotkeys: HotkeyBinding[] = [];

  /**
   * The trigger the user is part-way through typing. A trigger is only
   * committed when it matches a snippet, so ordinary typing never builds
   * state.
   */
  let partialTrigger = '';
  let partialTriggerTimer: number | undefined;

  const clearPartialTrigger = () => {
    partialTrigger = '';
    clearTimeout(partialTriggerTimer);
    partialTriggerTimer = undefined;
  };

  const armPartialTimer = () => {
    clearTimeout(partialTriggerTimer);
    partialTriggerTimer = setTimeout(
      clearPartialTrigger,
      PARTIAL_TRIGGER_TIMEOUT,
    );
  };

  /** Reads the current text of an editable element. */
  const readText = (element: HTMLElement): string => {
    if (isInputElement(element) || isTextAreaElement(element)) {
      return element.value;
    }
    return element.textContent ?? '';
  };

  /**
   * Replaces the trigger text with the snippet payload.
   *
   * The shared insertion helper inserts at the caret, so the trigger text is
   * selected and replaced rather than overwritten wholesale. That keeps the
   * surrounding content — and the caret position — intact, and works the
   * same way in plain inputs, textareas and rich editors.
   */
  const expandSnippet = async (
    editable: HTMLElement,
    snippet: Snippet,
    typed: string,
  ): Promise<boolean> => {
    const triggerMode = snippet.triggerMode ?? 'standalone';
    const replacement =
      snippet.expansionMode === 'html' && snippet.html
        ? snippet.html
        : snippet.text;

    const current = readText(editable);

    // The text that has to disappear: the whole field for a standalone
    // trigger, just the trigger itself for an `anywhere` trigger.
    const toRemove =
      triggerMode === 'standalone'
        ? current
        : (() => {
            const index = current.indexOf(snippet.shortcut);
            return index === -1 ? '' : snippet.shortcut;
          })();

    if (!toRemove) {
      return false;
    }

    // Select the trigger text so the insertion replaces exactly it.
    const removed = await replaceText(editable, toRemove, '');
    if (!removed) {
      return false;
    }

    const inserted = await insertTextIntoEditable(editable, replacement, {
      html:
        snippet.expansionMode === 'html' && snippet.html
          ? snippet.html
          : undefined,
    });

    return inserted.ok;
  };

  /**
   * Replaces the first occurrence of `searchText` in the editable with
   * `replacementText`.
   *
   * Plain text controls are handled directly; rich editors go through the
   * shared range-based replacement helper.
   */
  const replaceText = async (
    editable: HTMLElement,
    searchText: string,
    replacementText: string,
  ): Promise<boolean> => {
    if (isInputElement(editable) || isTextAreaElement(editable)) {
      const value = editable.value;
      const index = value.indexOf(searchText);
      if (index === -1) {
        return false;
      }

      const next =
        value.slice(0, index) +
        replacementText +
        value.slice(index + searchText.length);

      try {
        editable.value = next;
      } catch {
        return false;
      }

      const caret = index + replacementText.length;
      if (isCursorManipulableInput(editable)) {
        try {
          editable.setSelectionRange(caret, caret);
        } catch {
          // Some controls reject setSelectionRange; the value is still set.
        }
      }

      notifyInput(editable);
      return true;
    }

    return replaceRangeWithText(editable, searchText, replacementText);
  };

  /**
   * Dispatches an `input` event so the page learns that the field changed.
   *
   * The event is created in the editable's own realm so it works for
   * elements living inside an iframe.
   */
  const notifyInput = (editable: HTMLElement) => {
    const EventConstructor =
      editable.ownerDocument.defaultView?.Event ?? Event;
    editable.dispatchEvent(
      new EventConstructor('input', { bubbles: true, composed: true }),
    );
  };

  /**
   * Handles a keystroke inside an editable.
   *
   * Returns true when the engine consumed the keystroke, in which case the
   * caller should stop the event from reaching the page.
   */
  const handleEditableKey = async (
    event: KeyboardEvent,
    target: HTMLElement,
  ): Promise<boolean> => {
    // Modifier-only keys and non-printable keys do not contribute to a
    // trigger.
    if (event.key.length !== 1 && event.key !== 'Backspace') {
      return false;
    }

    // A hotkey takes precedence over snippet expansion.
    const binding = hotkeys.find((candidate) =>
      combinationMatchesEvent(candidate.combination, event),
    );
    if (binding) {
      event.preventDefault();
      event.stopPropagation();
      fireHotkey(binding);
      return true;
    }

    if (event.key === 'Backspace') {
      partialTrigger = partialTrigger.slice(0, -1);
      return false;
    }

    const typed = partialTrigger + event.key;

    const match = matchSnippet(typed, snippets);
    if (match) {
      event.preventDefault();
      event.stopPropagation();
      clearPartialTrigger();

      const editable = findEditableHost(target);
      const expanded = await expandSnippet(editable, match.snippet, typed);
      if (expanded) {
        options.onSnippetExpanded?.(match.snippet);
      }
      return true;
    }

    // The user is part-way through a trigger. Stop the page from seeing the
    // keystroke so sites with their own shortcuts do not react, and remember
    // the partial text so the trigger can be completed.
    if (isPartialTrigger(typed, snippets)) {
      event.stopPropagation();
      partialTrigger = typed;
      armPartialTimer();
      return true;
    }

    if (partialTrigger) {
      clearPartialTrigger();
    }
    return false;
  };

  /** Runs a hotkey binding. */
  const fireHotkey = (binding: HotkeyBinding) => {
    if (binding.kind === 'toggle' && binding.mode) {
      const current = options.getModeState?.(binding.mode) ?? false;
      const next = !current;
      options.onToggleMode?.(binding.mode, next);
      return;
    }
    options.onAction?.(binding);
  };

  /**
   * Handles a keystroke anywhere on the page that is not inside an
   * editable. Only hotkeys are relevant here — snippets need a field to
   * expand into.
   */
  const handleDocumentKey = (event: KeyboardEvent) => {
    const binding = hotkeys.find((candidate) =>
      combinationMatchesEvent(candidate.combination, event),
    );
    if (!binding) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    fireHotkey(binding);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (target && isEditableTarget(target)) {
      const editable = findEditableHost(target);
      activeEditable = editable;
      void handleEditableKey(event, editable);
      return;
    }

    handleDocumentKey(event);
  };

  /** Tracks the caret between fields so expansions land in the right one. */
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && isEditableTarget(target)) {
      activeEditable = findEditableHost(target);
    }
  };

  const refresh = async () => {
    snippets = options.getSnippets();
    hotkeys = options.getHotkeys();
  };

  return {
    start() {
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('focusin', onFocusIn, true);
    },
    stop() {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      clearPartialTrigger();
    },
    refresh,
  };
}
