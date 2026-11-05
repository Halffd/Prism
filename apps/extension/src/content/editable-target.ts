/**
 * Cross-realm safe helpers for locating and classifying editable elements.
 *
 * All DOM type checks go through the element's own realm
 * (`element.ownerDocument.defaultView`) so elements that live inside
 * same-origin iframes are handled correctly.
 */

export type EditorFramework =
  | 'ckeditor4'
  | 'tinymce5'
  | 'prosemirror'
  | 'quill'
  | 'lexical'
  | 'monaco'
  | 'codeMirror';

export type CursorLocation =
  { type: 'text'; start: number; end: number } | { type: 'ce'; range: Range };

/** Minimal shape of the (still experimental) EditContext API we rely on. */
export interface EditContextLike {
  insertText?: (text: string) => void;
}

type ElementWithEditContext = Element & { editContext?: EditContextLike };

const CURSOR_MANIPULABLE_INPUT_TYPES: Record<string, true> = {
  text: true,
  search: true,
  url: true,
  tel: true,
  password: true,
};

const EDITABLE_INPUT_TYPES: Record<string, true> = {
  ...CURSOR_MANIPULABLE_INPUT_TYPES,
  email: true,
  number: true,
};

function getRealm(element: Element): (WindowProxy & typeof globalThis) | null {
  return element.ownerDocument.defaultView;
}

/**
 * True when the element is an `<input>`, checked against the element's own
 * realm with a tag-name fallback (the fallback keeps the check working when
 * the realm's constructor does not wrap the element).
 */
export function isInputElement(element: Element): element is HTMLInputElement {
  const view = getRealm(element);
  if (view && typeof view.HTMLInputElement === 'function') {
    if (element instanceof view.HTMLInputElement) {
      return true;
    }
  }
  return element.tagName === 'INPUT';
}

/** True when the element is a `<textarea>` in the element's own realm. */
export function isTextAreaElement(
  element: Element,
): element is HTMLTextAreaElement {
  const view = getRealm(element);
  if (view && typeof view.HTMLTextAreaElement === 'function') {
    if (element instanceof view.HTMLTextAreaElement) {
      return true;
    }
  }
  return element.tagName === 'TEXTAREA';
}

/** Returns the element's EditContext, when the browser exposes one. */
export function getEditContext(element: Element): EditContextLike | null {
  const candidate = (element as ElementWithEditContext).editContext;
  return candidate ?? null;
}

function isFrameElement(element: Element): boolean {
  return element.tagName === 'IFRAME' || element.tagName === 'FRAME';
}

function getFrameDocument(frame: Element): Document | null {
  try {
    return (frame as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    // Cross-origin frames throw on access.
    return null;
  }
}

function hasExplicitEditableAttribute(element: Element): boolean {
  const attribute = element.getAttribute('contenteditable');
  if (attribute === null) {
    return false;
  }

  const value = attribute.trim().toLowerCase();
  return value === '' || value === 'true' || value === 'plaintext-only';
}

/** Nearest ancestor (inclusive) that declares `contenteditable`. */
function resolveContentEditableHost(element: Element): Element | null {
  let current: Element | null = element;
  while (current) {
    if (hasExplicitEditableAttribute(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Returns the editable element that owns the given node: the element itself
 * for text controls, or the nearest contenteditable host for rich editors.
 */
export function findEditableHost(element: Element): HTMLElement {
  if (isInputElement(element) || isTextAreaElement(element)) {
    return element;
  }

  const host = resolveContentEditableHost(element);
  if (host) {
    return host as HTMLElement;
  }

  return element as HTMLElement;
}

/**
 * True for elements whose text can be edited: text inputs, textareas,
 * contenteditable hosts, documents in design mode and elements exposing the
 * EditContext API.
 */
export function isEditableTarget(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (isInputElement(element)) {
    return EDITABLE_INPUT_TYPES[element.type.toLowerCase()] === true;
  }

  if (isTextAreaElement(element)) {
    return true;
  }

  if ((element as HTMLElement).isContentEditable === true) {
    return true;
  }

  // Fall back to the explicit attribute so the check also works where
  // `isContentEditable` is not implemented (and for contenteditable hosts
  // whose descendants are the event target).
  if (resolveContentEditableHost(element)) {
    return true;
  }

  const designMode = element.ownerDocument.designMode;
  if (typeof designMode === 'string' && designMode.toLowerCase() === 'on') {
    return true;
  }

  return getEditContext(element) !== null;
}

/**
 * True only for controls whose caret can be read and written: text inputs
 * (text, search, url, tel, password) and textareas.
 */
export function isCursorManipulableInput(element: Element): boolean {
  if (isTextAreaElement(element)) {
    return true;
  }

  if (isInputElement(element)) {
    return CURSOR_MANIPULABLE_INPUT_TYPES[element.type.toLowerCase()] === true;
  }

  return false;
}

/**
 * Returns the selection that belongs to the element. Uses the element's root
 * node so shadow DOM selections are found, falling back to the owning window.
 */
export function getSelectionForElement(element: Element): Selection | null {
  const root = element.getRootNode() as Node & {
    getSelection?: () => Selection | null;
  };

  if (typeof root.getSelection === 'function') {
    const selection = root.getSelection();
    if (selection) {
      return selection;
    }
  }

  const view = getRealm(element);
  return view ? view.getSelection() : null;
}

/**
 * Current caret/selection of the element: offsets for text controls, a cloned
 * range for contenteditable hosts.
 */
export function getCursorLocation(element: Element): CursorLocation | null {
  if (isInputElement(element) || isTextAreaElement(element)) {
    if (!isCursorManipulableInput(element)) {
      return null;
    }

    const control = element as HTMLInputElement | HTMLTextAreaElement;
    const start = control.selectionStart;
    const end = control.selectionEnd;

    if (start === null || end === null) {
      return null;
    }

    return { type: 'text', start, end };
  }

  const selection = getSelectionForElement(element);
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // The selection may live in a different editable; only report a location
  // when it actually belongs to this element.
  if (container !== element && !element.contains(container)) {
    return null;
  }

  return { type: 'ce', range: range.cloneRange() };
}

/**
 * Text of the selection's anchor node up to the anchor offset, lowercased.
 * Used to verify that a shortcut is still present before it is cleared.
 */
export function getAnchorText(element: Element): string | undefined {
  const selection = getSelectionForElement(element);
  if (!selection) {
    return undefined;
  }

  const anchorNode = selection.anchorNode;
  if (!anchorNode) {
    return undefined;
  }

  const text = anchorNode.textContent;
  if (text === null) {
    return undefined;
  }

  return text.slice(0, selection.anchorOffset).toLowerCase();
}

/**
 * Detects the rich-text framework hosting the given element, using the class
 * heuristics used by AI Blaze plus the common Quill/Lexical/Monaco/
 * CodeMirror markers.
 */
export function detectEditorFramework(
  element: Element,
): EditorFramework | null {
  const view = getRealm(element);

  if (element.tagName === 'BODY') {
    const isCkEditor4 =
      element.classList.contains('cke_editable') &&
      view !== null &&
      view.parent !== view;
    if (isCkEditor4) {
      return 'ckeditor4';
    }

    const isTinyMceBody =
      element.id === 'tinymce' &&
      element.classList.contains('mce-content-body');
    if (isTinyMceBody) {
      const frame = view?.frameElement ?? null;
      const parent = frame?.parentElement ?? null;
      if (parent?.classList.contains('tox-edit-area')) {
        return 'tinymce5';
      }
    }
  }

  if (element.classList.contains('ProseMirror')) {
    return 'prosemirror';
  }

  if (element.classList.contains('ql-editor')) {
    return 'quill';
  }

  if (
    element.hasAttribute('data-lexical-editor') ||
    element.classList.contains('lexical')
  ) {
    return 'lexical';
  }

  if (element.classList.contains('monaco-editor')) {
    return 'monaco';
  }

  if (
    element.classList.contains('cm-editor') ||
    element.classList.contains('CodeMirror')
  ) {
    return 'codeMirror';
  }

  return null;
}

function findContentEditableDescendant(element: Element): HTMLElement | null {
  const candidates = element.querySelectorAll(
    '[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]',
  );

  for (const candidate of Array.from(candidates)) {
    if ((candidate as HTMLElement).isContentEditable) {
      return candidate as HTMLElement;
    }
  }

  return null;
}

/**
 * Resolves the truly focused editable element, descending into same-origin
 * iframes when the focused element is a frame.
 */
export function findActiveEditable(
  root: Document = document,
): HTMLElement | null {
  const active = root.activeElement;
  if (!active) {
    return null;
  }

  if (isFrameElement(active)) {
    const frameDocument = getFrameDocument(active);
    if (!frameDocument) {
      return null;
    }
    return findActiveEditable(frameDocument);
  }

  if (isInputElement(active) || isTextAreaElement(active)) {
    return isEditableTarget(active) ? active : null;
  }

  // The active element may itself be the contenteditable host, or a node
  // inside one (browsers focus the host, but shadow hosts can differ).
  const host = resolveContentEditableHost(active);
  if (host) {
    return host as HTMLElement;
  }

  if ((active as HTMLElement).isContentEditable === true) {
    return active as HTMLElement;
  }

  const descendant = findContentEditableDescendant(active);
  if (descendant) {
    return descendant;
  }

  const designMode = root.designMode;
  if (
    typeof designMode === 'string' &&
    designMode.toLowerCase() === 'on' &&
    active === root.body
  ) {
    return root.body;
  }

  return null;
}
