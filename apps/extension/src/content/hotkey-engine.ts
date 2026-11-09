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
 * The engine mirrors Blaze's approach: listeners are attached in the
 * capture phase so the extension sees the keystroke before the page does,
 * and a partially-typed trigger suppresses the page's own handling so
 * sites like YouTube or Gmail do not react to the same characters.
 *
 * Matching works on the field's actual content rather than on an
 * accumulated keystroke buffer. A keydown handler runs before the browser
 * inserts the character, so the content a trigger is matched against is
 * the field's current content with the new character inserted at the
 * caret. This is what makes a trigger expand when it is typed in the
 * middle of a sentence, and not just at the start of a field.
 */

import {
  combinationMatchesEvent,
  matchSnippet,
  isPartialTrigger,
  type HotkeyBinding,
  type PromptShortcut,
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
  /** Called when a prompt shortcut's keyboard binding fires. */
  onPromptShortcut?: (content: string) => void;
  /**
   * True when another feature has already claimed the keystroke — for
   * example Prism's own `/prompt` sequence.
   *
   * The engine then leaves the keystroke alone, so the two features do not
   * fight over the same characters.
   */
  isClaimedByOtherFeature?: () => boolean;
  /** Returns the snippets currently known to the engine. */
  getSnippets: () => Snippet[];
  /** Returns the hotkey bindings currently known to the engine. */
  getHotkeys: () => HotkeyBinding[];
  /**
   * Returns the prompt shortcuts currently known to the engine, so their
   * keyboard bindings fire with the same matcher as the other hotkeys.
   *
   * The lookup may be async: the caller usually reads the shortcuts from
   * extension storage, and doing that only when a modifier is held keeps
   * ordinary typing free of storage reads.
   */
  getPromptShortcuts?: () => PromptShortcut[] | Promise<PromptShortcut[]>;
  /**
   * Returns the state of a toggle mode. Used so a toggle hotkey can flip a
   * mode that is currently off.
   *
   * The lookup may be async: the caller usually reads the mode state from
   * extension storage.
   */
  getModeState?: (mode: string) => boolean | Promise<boolean>;
}

interface HotkeyEngine {
  /** Attaches the engine's listeners. */
  start(): void;
  /** Detaches the engine's listeners. */
  stop(): void;
}

/**
 * Creates the page-level hotkey and snippet engine.
 */
export function createHotkeyEngine(
  options: HotkeyEngineOptions,
): HotkeyEngine {
  /** Reads the current text of an editable element. */
  const readText = (element: HTMLElement): string => {
    if (isInputElement(element) || isTextAreaElement(element)) {
      return element.value;
    }
    return element.textContent ?? '';
  };

  /** True for the controls whose value and caret can be set directly. */
  const isPlainTextControl = (
    element: HTMLElement,
  ): element is HTMLInputElement | HTMLTextAreaElement =>
    isInputElement(element) || isTextAreaElement(element);

  /**
   * Returns the field content as it will be once the given character has
   * been inserted at the caret.
   *
   * A keydown handler runs before the browser inserts the character, so the
   * trigger has to be matched against the content the field is about to
   * hold — otherwise the last character of a trigger is never seen.
   */
  const withCharacterAtCaret = (
    element: HTMLElement,
    character: string,
  ): string => {
    const current = readText(element);

    if (isPlainTextControl(element)) {
      const caret = element.selectionStart ?? current.length;
      return current.slice(0, caret) + character + current.slice(caret);
    }

    // For rich editors the caret offset within the text is not tracked
    // here, so the character is appended. The browser inserts it at the
    // caret afterwards, and the trigger is matched against the resulting
    // content.
    return current + character;
  };

  /**
   * True when the text ends part-way through a trigger.
   *
   * The trigger may be preceded by other text — `/fix` typed in the middle
   * of a sentence is still part-way through a trigger — so every suffix of
   * the text is checked.
   */
  const endsWithPartialTrigger = (
    text: string,
    snippets: readonly Snippet[],
  ): boolean => {
    for (let length = 1; length < text.length; length += 1) {
      if (isPartialTrigger(text.slice(text.length - length), snippets)) {
        return true;
      }
    }
    return false;
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
   * Expands a snippet that was triggered by a keyboard binding.
   *
   * No trigger text was typed in this case, so nothing is removed from the
   * field — the payload is appended at the caret.
   */
  const expandSnippetByShortcut = async (
    editable: HTMLElement,
    snippet: Snippet,
  ): Promise<boolean> => {
    const replacement =
      snippet.expansionMode === 'html' && snippet.html
        ? snippet.html
        : snippet.text;

    if (isPlainTextControl(editable)) {
      const caret = editable.selectionStart ?? editable.value.length;
      const desired =
        editable.value.slice(0, caret) +
        replacement +
        editable.value.slice(caret);

      try {
        editable.value = desired;
      } catch {
        return false;
      }

      const nextCaret = Math.min(caret + replacement.length, editable.value.length);
      if (isCursorManipulableInput(editable)) {
        try {
          editable.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // Some controls reject setSelectionRange; the value is still set.
        }
      }

      notifyInput(editable);
      return true;
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
   * Replaces the trigger text with the snippet payload.
   *
   * `candidate` is the field content as it will be once the triggering
   * keystroke has landed. Because the engine consumed that keystroke, the
   * field itself still holds the content from before it — so the trigger
   * is removed from the candidate and the result is written back.
   */
  const expandSnippet = async (
    editable: HTMLElement,
    snippet: Snippet,
    candidate: string,
  ): Promise<boolean> => {
    const triggerMode = snippet.triggerMode ?? 'standalone';
    const replacement =
      snippet.expansionMode === 'html' && snippet.html
        ? snippet.html
        : snippet.text;

    if (isPlainTextControl(editable)) {
      let desired: string;

      if (triggerMode === 'standalone') {
        // The whole field is the trigger, so the field becomes the payload.
        desired = replacement;
      } else {
        const index = candidate.lastIndexOf(snippet.shortcut);
        if (index === -1) {
          return false;
        }
        desired =
          candidate.slice(0, index) +
          replacement +
          candidate.slice(index + snippet.shortcut.length);
      }

      try {
        editable.value = desired;
      } catch {
        return false;
      }

      const caret = Math.min(desired.length, editable.value.length);
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

    // Rich editors keep their own markup, so the trigger is removed from
    // the DOM and the payload inserted in its place. The keystroke that
    // completed the trigger was consumed, so the field still holds the
    // trigger minus its final character.
    const typedSoFar = snippet.shortcut.slice(0, -1);
    const removed = typedSoFar
      ? replaceRangeWithText(editable, typedSoFar, '')
      : replaceRangeWithText(editable, snippet.shortcut, '');

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
   * Handles a keystroke inside an editable.
   *
   * Returns true when the engine consumed the keystroke, in which case the
   * caller should stop the event from reaching the page.
   */
  const handleEditableKey = async (
    event: KeyboardEvent,
    target: HTMLElement,
  ): Promise<boolean> => {
    // A hotkey takes precedence over snippet expansion. Hotkeys are matched
    // before the printable-key guard below, because a binding such as
    // `Ctrl+Shift+F` does not produce a single-character key.
    const binding = options
      .getHotkeys()
      .find((candidate) =>
        combinationMatchesEvent(candidate.combination, event),
      );
    if (binding) {
      event.preventDefault();
      event.stopPropagation();
      await fireHotkey(binding);
      return true;
    }

    const editable = findEditableHost(target);
    const snippets = options.getSnippets();

    // Another feature — Prism's own `/prompt` sequence — may already own
    // this keystroke. In that case the engine stays out of the way.
    if (options.isClaimedByOtherFeature?.()) {
      return false;
    }

    // A snippet can carry its own keyboard binding, which expands it
    // without the trigger ever being typed.
    const boundSnippet = snippets.find((snippet) =>
      (snippet.keyboardShortcuts ?? []).some((combination) =>
        combinationMatchesEvent(combination, event),
      ),
    );
    if (boundSnippet) {
      event.preventDefault();
      event.stopPropagation();

      const expanded = await expandSnippetByShortcut(editable, boundSnippet);
      if (expanded) {
        options.onSnippetExpanded?.(boundSnippet);
      }
      return true;
    }

    // Modifier-only keys and non-printable keys do not contribute to a
    // trigger.
    if (event.key.length !== 1 && event.key !== 'Backspace') {
      return false;
    }

    if (event.key === 'Backspace') {
      return false;
    }

    const candidate = withCharacterAtCaret(editable, event.key);

    const match = matchSnippet(candidate, snippets);
    if (match) {
      // The keystroke is consumed here, so the character is never inserted
      // by the browser and the expansion owns the field's contents.
      event.preventDefault();
      event.stopPropagation();

      const expanded = await expandSnippet(editable, match.snippet, candidate);
      if (expanded) {
        options.onSnippetExpanded?.(match.snippet);
      }
      return true;
    }

    // The user is part-way through a trigger. Stop the page from seeing the
    // keystroke so sites with their own shortcuts do not react.
    if (endsWithPartialTrigger(candidate, snippets)) {
      event.stopPropagation();
      return true;
    }

    return false;
  };

  /** Runs a hotkey binding. */
  const fireHotkey = async (binding: HotkeyBinding) => {
    if (binding.kind === 'toggle' && binding.mode) {
      const current = (await options.getModeState?.(binding.mode)) ?? false;
      const next = !current;
      options.onToggleMode?.(binding.mode, next);
      return;
    }
    options.onAction?.(binding);
  };

  /**
   * Finds a prompt shortcut whose keyboard binding matches the event.
   *
   * Prompt shortcuts predate the snippet model and store their bindings as
   * `keyboardShortcut` / `keyboardShortcuts`. They are matched with the
   * same matcher as the other hotkeys, so `Ctrl+Shift+T` behaves
   * consistently wherever it is pressed.
   */
  const findPromptShortcut = async (
    event: KeyboardEvent,
  ): Promise<PromptShortcut | undefined> => {
    const shortcuts = (await options.getPromptShortcuts?.()) ?? [];

    return shortcuts.find((shortcut) => {
      const candidates = [
        shortcut.keyboardShortcut,
        ...(shortcut.keyboardShortcuts ?? []),
      ].filter((combo): combo is string => !!combo);

      return candidates.some((combo) =>
        combinationMatchesEvent(combo, event),
      );
    });
  };

  /**
   * Handles a keystroke anywhere on the page that is not inside an
   * editable. Only hotkeys are relevant here — snippets need a field to
   * expand into.
   */
  const handleDocumentKey = async (event: KeyboardEvent) => {
    const binding = options
      .getHotkeys()
      .find((candidate) =>
        combinationMatchesEvent(candidate.combination, event),
      );
    if (binding) {
      event.preventDefault();
      event.stopPropagation();
      await fireHotkey(binding);
      return;
    }

    const shortcut = await findPromptShortcut(event);
    if (shortcut) {
      event.preventDefault();
      event.stopPropagation();
      options.onPromptShortcut?.(shortcut.content);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (target && isEditableTarget(target)) {
      const editable = findEditableHost(target);
      void handleEditableKey(event, editable);
      return;
    }

    void handleDocumentKey(event);
  };

  return {
    start() {
      document.addEventListener('keydown', onKeyDown, true);
    },
    stop() {
      document.removeEventListener('keydown', onKeyDown, true);
    },
  };
}
