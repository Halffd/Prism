/**
 * Rich-text aware text insertion helpers.
 *
 * The insertion strategy mirrors the approach used by AI Blaze:
 *  - plain text controls are edited through direct value surgery,
 *  - contenteditable hosts receive a synthetic paste event carrying both
 *    plain text and (optionally) HTML payloads,
 *  - editors exposing the EditContext API use `editContext.insertText`.
 *
 * Every DOM interaction stays inside the element's own realm so the helpers
 * work for content hosted in same-origin iframes.
 */

import {
  getCursorLocation,
  getEditContext,
  getSelectionForElement,
  isCursorManipulableInput,
  isInputElement,
  isTextAreaElement,
} from './editable-target';

export interface InsertionResult {
  ok: boolean;
  method: 'value' | 'paste' | 'selection' | 'none';
  error?: string;
}

export interface InsertionOptions {
  /** Optional rich payload inserted alongside the plain text. */
  html?: string;
}

export interface TargetStyles {
  fontFamily?: string;
  fontSize?: string;
  fontStyle?: string;
  fontWeight?: string;
  color?: string;
}

const STYLE_PROPERTY_NAMES: Record<keyof TargetStyles, string> = {
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontStyle: 'font-style',
  fontWeight: 'font-weight',
  color: 'color',
};

function isPlainTextControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return isInputElement(element) || isTextAreaElement(element);
}

function getTextContent(element: Element): string {
  if (isPlainTextControl(element)) {
    return element.value;
  }
  return element.textContent ?? '';
}

function createDataTransfer(element: Element): DataTransfer | null {
  const view = element.ownerDocument.defaultView;
  const DataTransferConstructor =
    view?.DataTransfer ??
    (typeof DataTransfer === 'undefined' ? null : DataTransfer);

  if (!DataTransferConstructor) {
    return null;
  }

  try {
    return new DataTransferConstructor();
  } catch {
    return null;
  }
}

function createPasteEvent(element: Element, data: DataTransfer): Event | null {
  const view = element.ownerDocument.defaultView;
  const ClipboardEventConstructor =
    view?.ClipboardEvent ??
    (typeof ClipboardEvent === 'undefined' ? null : ClipboardEvent);

  if (!ClipboardEventConstructor) {
    return null;
  }

  try {
    return new ClipboardEventConstructor('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
  } catch {
    return null;
  }
}

function waitForNextFrame(element: Element): Promise<void> {
  const view = element.ownerDocument.defaultView;
  if (view && typeof view.requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      view.requestAnimationFrame(() => resolve());
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function insertIntoTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): InsertionResult {
  const isInput = isInputElement(element);
  const inserted = isInput ? text.replace(/\r\n|\r|\n/g, ' ') : text;

  const value = element.value;
  const start = element.selectionStart ?? value.length;
  const end = element.selectionEnd ?? start;

  try {
    element.value = value.slice(0, start) + inserted + value.slice(end);
  } catch (error) {
    return {
      ok: false,
      method: 'none',
      error: error instanceof Error ? error.message : 'Failed to set value',
    };
  }

  if (isCursorManipulableInput(element)) {
    const caret = start + inserted.length;
    try {
      element.setSelectionRange(caret, caret);
    } catch {
      // Some browsers reject setSelectionRange on detached or exotic controls.
    }
  }

  return { ok: true, method: 'value' };
}

function getCaretRange(element: Element): Range | null {
  const location = getCursorLocation(element);
  if (location && location.type === 'ce') {
    return location.range;
  }

  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  return range;
}

function insertIntoSelection(element: Element, text: string): boolean {
  const range = getCaretRange(element);
  if (!range) {
    return false;
  }

  try {
    range.deleteContents();
    const textNode = element.ownerDocument.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);

    const selection = getSelectionForElement(element);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  } catch {
    return false;
  }
}

function insertWithExecCommand(element: Element, text: string): boolean {
  const document = element.ownerDocument;
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

function insertWithEditContext(element: Element, text: string): boolean {
  const editContext = getEditContext(element);
  if (!editContext || typeof editContext.insertText !== 'function') {
    return false;
  }

  try {
    editContext.insertText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Inserts text into an editable element, using the richest mechanism the
 * target supports. The returned result reports which method actually applied
 * the insertion so callers can report honestly.
 */
export async function insertTextIntoEditable(
  element: Element,
  text: string,
  options: InsertionOptions = {},
): Promise<InsertionResult> {
  if (isPlainTextControl(element)) {
    return insertIntoTextControl(element, text);
  }

  const editContext = getEditContext(element);
  if (editContext && typeof editContext.insertText === 'function') {
    if (insertWithEditContext(element, text)) {
      return { ok: true, method: 'selection' };
    }
  }

  const textBefore = getTextContent(element);
  const dataTransfer = createDataTransfer(element);
  const pasteEvent = dataTransfer
    ? createPasteEvent(element, dataTransfer)
    : null;

  if (dataTransfer && pasteEvent) {
    dataTransfer.setData('text/plain', text);
    if (options.html) {
      dataTransfer.setData('text/html', options.html);
    }

    element.dispatchEvent(pasteEvent);

    if (pasteEvent.defaultPrevented) {
      // The page took over the paste (for example ProseMirror, Quill or
      // Lexical), so it owns the insertion from here on.
      return { ok: true, method: 'paste' };
    }

    await waitForNextFrame(element);

    if (getTextContent(element) !== textBefore) {
      return { ok: true, method: 'paste' };
    }
  }

  if (
    insertWithExecCommand(element, text) &&
    getTextContent(element) !== textBefore
  ) {
    return { ok: true, method: 'selection' };
  }

  if (insertIntoSelection(element, text)) {
    return { ok: true, method: 'selection' };
  }

  return {
    ok: false,
    method: 'none',
    error: 'Unable to insert text into the target element',
  };
}

function collectTextNodes(root: Node): Text[] {
  const document = root.ownerDocument ?? (root as Document);
  const view = document.defaultView;
  const showText = view?.NodeFilter?.SHOW_TEXT ?? 4;

  const walker = document.createTreeWalker(root, showText);
  const nodes: Text[] = [];

  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  return nodes;
}

function locateOffset(
  nodes: Text[],
  offset: number,
): { node: Text; offset: number } | null {
  let remaining = offset;

  for (const node of nodes) {
    const length = node.data.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }

  return null;
}

/**
 * Replaces the first occurrence of `searchText` inside the element with
 * `replacementText`, keeping the surrounding DOM and formatting intact.
 */
export function replaceRangeWithText(
  element: Element,
  searchText: string,
  replacementText: string,
): boolean {
  if (!searchText) {
    return false;
  }

  if (isPlainTextControl(element)) {
    const index = element.value.indexOf(searchText);
    if (index === -1) {
      return false;
    }

    const start = index;
    const end = index + searchText.length;
    const nextValue =
      element.value.slice(0, start) +
      replacementText +
      element.value.slice(end);

    try {
      element.value = nextValue;
    } catch {
      return false;
    }

    const caret = start + replacementText.length;
    if (isCursorManipulableInput(element)) {
      try {
        element.setSelectionRange(caret, caret);
      } catch {
        // The control does not support caret restoration.
      }
    }

    return true;
  }

  const fullText = element.textContent ?? '';
  const matchIndex = fullText.indexOf(searchText);
  if (matchIndex === -1) {
    return false;
  }

  const nodes = collectTextNodes(element);
  if (nodes.length === 0) {
    return false;
  }

  const startLocation = locateOffset(nodes, matchIndex);
  const endLocation = locateOffset(nodes, matchIndex + searchText.length);
  if (!startLocation || !endLocation) {
    return false;
  }

  const range = element.ownerDocument.createRange();

  try {
    range.setStart(startLocation.node, startLocation.offset);
    range.setEnd(endLocation.node, endLocation.offset);
  } catch {
    return false;
  }

  try {
    range.deleteContents();
    const textNode = element.ownerDocument.createTextNode(replacementText);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);

    const selection = getSelectionForElement(element);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch {
    return false;
  }

  return true;
}

/** Reads the typography of the target so pasted content can match it. */
export function captureTargetStyles(element: Element): TargetStyles {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return {};
  }

  const computed = view.getComputedStyle(element);
  const styles: TargetStyles = {};

  const fontFamily = computed.fontFamily;
  if (fontFamily) {
    styles.fontFamily = fontFamily;
  }

  const fontSize = computed.fontSize;
  if (fontSize) {
    styles.fontSize = fontSize;
  }

  const fontStyle = computed.fontStyle;
  if (fontStyle) {
    styles.fontStyle = fontStyle;
  }

  const fontWeight = computed.fontWeight;
  if (fontWeight) {
    styles.fontWeight = fontWeight;
  }

  const color = computed.color;
  if (color) {
    styles.color = color;
  }

  return styles;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&#38;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/"/g, '&#34;')
    .replace(/'/g, '&#39;');
}

/**
 * Wraps the text in a span carrying the captured inline styles so rich
 * content matches the target's typography. Returns undefined when no styles
 * were captured.
 */
export function buildStyledHtml(
  text: string,
  styles: TargetStyles,
): string | undefined {
  const declarations: string[] = [];

  (Object.keys(STYLE_PROPERTY_NAMES) as (keyof TargetStyles)[]).forEach(
    (key) => {
      const value = styles[key];
      if (value) {
        const safeValue = value.replace(/"/g, '&#34;');
        declarations.push(`${STYLE_PROPERTY_NAMES[key]}: ${safeValue}`);
      }
    },
  );

  if (declarations.length === 0) {
    return undefined;
  }

  return `<span style="${declarations.join('; ')}">${escapeHtml(text)}</span>`;
}
