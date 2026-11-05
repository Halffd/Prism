// ui-controls.ts - Module for creating and managing UI controls

const TOAST_CONTAINER_ID = 'prism-toast-container';
const TOAST_STYLE_ID = 'prism-toast-styles';
const TOAST_CLASS = 'prism-toast';
const TOAST_PROGRESS_CLASS = 'prism-toast-progress';
const TOAST_AUTO_DISMISS_MS = 6000;
const TOAST_MAX_VISIBLE = 20;

interface ToastEntry {
  element: HTMLElement;
  progress: HTMLElement | null;
  timer: number | null;
}

/** Stack state shared by every script instance running in the same frame. */
interface ToastStack {
  entries: ToastEntry[];
}

interface ToastContainer extends HTMLElement {
  prismToastStack?: ToastStack;
}

function getDocumentRoot(): HTMLElement {
  return document.body ?? document.documentElement;
}

function ensureStyles(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    @keyframes prismToastSlideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes prismToastProgress {
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
    }
  `;
  (document.head ?? getDocumentRoot()).appendChild(style);
}

function ensureContainer(): ToastContainer {
  const existing = document.getElementById(TOAST_CONTAINER_ID);
  if (existing instanceof HTMLElement) return existing as ToastContainer;

  const container = document.createElement('div') as ToastContainer;
  container.id = TOAST_CONTAINER_ID;
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 2147483647;
    pointer-events: none;
    max-width: min(360px, calc(100vw - 40px));
  `;
  container.prismToastStack = { entries: [] };
  getDocumentRoot().appendChild(container);
  return container;
}

function getStack(container: ToastContainer): ToastStack {
  container.prismToastStack ??= { entries: [] };
  return container.prismToastStack;
}

function clearTimer(entry: ToastEntry): void {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function removeProgress(entry: ToastEntry): void {
  if (entry.progress) {
    entry.progress.remove();
    entry.progress = null;
  }
}

/**
 * Re-apply the id scheme after the stack changed:
 * the newest notification is `prism-toast`, older ones `prism-toast-N`.
 */
function syncToastIds(container: ToastContainer, entries: ToastEntry[]): void {
  const owned = new Set(entries.map((entry) => entry.element));
  for (const child of Array.from(container.children)) {
    if (owned.has(child as HTMLElement)) continue;
    const id = child.id;
    if (id === 'prism-toast' || id.startsWith('prism-toast-')) {
      child.removeAttribute('id');
    }
  }

  entries.forEach((entry, index) => {
    entry.element.id =
      index === entries.length - 1 ? 'prism-toast' : `prism-toast-${index + 1}`;
  });
}

function pruneDetachedToasts(entries: ToastEntry[]): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.element.isConnected) continue;
    clearTimer(entry);
    removeProgress(entry);
    entries.splice(index, 1);
  }
}

function startAutoDismiss(entry: ToastEntry): void {
  clearTimer(entry);
  removeProgress(entry);

  const progress = document.createElement('div');
  progress.className = TOAST_PROGRESS_CLASS;
  progress.style.cssText = `
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 2px;
    background: rgba(255, 255, 255, 0.65);
    transform-origin: left center;
    animation: prismToastProgress ${TOAST_AUTO_DISMISS_MS}ms linear forwards;
    pointer-events: none;
  `;
  entry.element.appendChild(progress);
  entry.progress = progress;

  entry.timer = window.setTimeout(() => {
    dismissToast(entry.element);
  }, TOAST_AUTO_DISMISS_MS);
}

function pauseAutoDismiss(entry: ToastEntry): void {
  clearTimer(entry);
  removeProgress(entry);
}

function createToastElement(message: string): HTMLElement {
  const toast = document.createElement('div');
  toast.className = TOAST_CLASS;
  toast.textContent = message;
  toast.style.cssText = `
    position: relative;
    overflow: hidden;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: prismToastSlideIn 0.3s ease-out;
    pointer-events: auto;
    word-break: break-word;
  `;
  return toast;
}

/**
 * Create a toast notification.
 *
 * Notifications are stacked: every call adds a new notification instead of
 * replacing the previous one. The most recent notification carries the id
 * `prism-toast` and contains exactly the message text (the progress bar is an
 * empty element and contributes no text). Hovering a notification pauses its
 * auto-dismiss timer; leaving it restarts the timer and the progress bar.
 */
export function showToast(message: string): void {
  ensureStyles();
  const container = ensureContainer();
  const stack = getStack(container);
  pruneDetachedToasts(stack.entries);

  const toast = createToastElement(message);
  const entry: ToastEntry = { element: toast, progress: null, timer: null };

  toast.addEventListener('pointerenter', () => pauseAutoDismiss(entry));
  toast.addEventListener('pointerleave', () => startAutoDismiss(entry));

  container.appendChild(toast);
  stack.entries.push(entry);

  while (stack.entries.length > TOAST_MAX_VISIBLE) {
    const oldest = stack.entries[0];
    dismissToast(oldest.element);
  }

  syncToastIds(container, stack.entries);
  startAutoDismiss(entry);
}

/** Dismiss a single toast notification. */
export function dismissToast(toast: HTMLElement): void {
  const container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    toast.remove();
    return;
  }

  const stack = getStack(container as ToastContainer);
  const entry = stack.entries.find((candidate) => candidate.element === toast);
  if (!entry) {
    toast.remove();
    return;
  }

  clearTimer(entry);
  removeProgress(entry);
  entry.element.remove();

  const index = stack.entries.indexOf(entry);
  if (index >= 0) stack.entries.splice(index, 1);
  syncToastIds(container as ToastContainer, stack.entries);

  if (stack.entries.length === 0) {
    container.remove();
  }
}

/** Dismiss every visible toast notification. */
export function clearToasts(): void {
  const container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) return;

  const stack = getStack(container as ToastContainer);
  for (const entry of [...stack.entries]) {
    dismissToast(entry.element);
  }
  stack.entries.length = 0;
  container.remove();
}

// Create a floating button
export function createFloatingButton(
  buttonId: string,
  content: string,
  onClick: () => void,
  additionalStyles: string = '',
): HTMLElement {
  const button = document.createElement('div');
  button.id = buttonId;
  button.innerHTML = content;
  button.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 24px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    transition: transform 0.2s, opacity 0.2s;
    user-select: none;
    opacity: 1;
    pointer-events: auto;
    ${additionalStyles}
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('click', onClick);

  return button;
}
