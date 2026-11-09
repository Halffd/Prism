import type {
  ContextData,
  ExtensionSettings,
  PopupDisplayMode,
  ContentRequest,
} from '@prism/shared-types';
import {
  createIframe,
  createShadowHost,
  attachShadowToElement,
  createButton,
  hasShadowRoot,
  forgetShadowRoot,
} from './iframe-manager';
import { showToast, createFloatingButton } from './ui-controls';
import { estimateTokenCount, isIgnoredElement } from './utils';
import {
  findActiveEditable,
  findEditableHost,
  isEditableTarget,
  isInputElement,
  isTextAreaElement,
} from './editable-target';
import { replaceRangeWithText } from './text-insertion';
import { createHotkeyEngine } from './hotkey-engine';
import type {
  HotkeyBinding,
  PromptShortcut,
  Snippet,
} from '@prism/shared-types';

// The content script runs in every frame of the page. Only the top frame owns
// the extension UI and answers page-level context requests; subframes keep
// the editable/shortcut handling because editors often live inside iframes.
const isTopFrame = window.top === window;

// Default settings
let currentDisplayMode: PopupDisplayMode = 'popup';
let currentSidebarPosition: 'left' | 'right' = 'right';
let currentSidebarWidth: number = 350;

/** The id of the element that hosts the in-page chat iframe. */
const CHAT_POPUP_CONTAINER_ID = 'prism-chat-popup-container';

/** The id of the chat iframe inside the shadow root. */
const CHAT_IFRAME_ID = 'prism-chat-iframe';

/**
 * The characters typed so far towards Prism's `/prompt` sequence.
 *
 * The sequence is Prism's own feature and takes priority over snippet
 * triggers, so the hotkey engine consults this buffer and stays out of the
 * way while a sequence is in progress.
 */
let promptSequenceBuffer = '';

/** The characters typed so far towards the page-wide `prompt` sequence. */
let globalSequenceBuffer = '';

/** The sequence typed inside an input to open the chat iframe. */
const PROMPT_SEQUENCE = '/prompt';

/** The sequence typed anywhere on the page to open the chat iframe. */
const GLOBAL_PROMPT_SEQUENCE = 'prompt';

/**
 * True when Prism's own sequence handling has claimed the keystrokes typed
 * so far.
 *
 * Only a genuine partial match counts: the buffer has to be a prefix of one
 * of the sequences, so ordinary typing never blocks the snippet engine.
 */
function isSequenceInProgress(): boolean {
  return (
    promptSequenceBuffer.length > 0 ||
    PROMPT_SEQUENCE.startsWith(globalSequenceBuffer)
  );
}

// True when a same-origin descendant frame currently owns the focus. Used to
// let the focused frame answer selection requests instead of the top frame.
function hasFocusedDescendantFrame(doc: Document): boolean {
  const frames = doc.querySelectorAll('iframe, frame');

  for (const frame of Array.from(frames)) {
    let frameDocument: Document | null = null;
    try {
      frameDocument = (frame as HTMLIFrameElement).contentDocument;
    } catch {
      // Cross-origin frames are not reachable; ignore them.
      continue;
    }

    if (!frameDocument) {
      continue;
    }

    if (frameDocument.hasFocus() || hasFocusedDescendantFrame(frameDocument)) {
      return true;
    }
  }

  return false;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(
  (request: ContentRequest, sender, sendResponse): boolean | void => {
    console.log('Content script received message:', request); // Debug logging

    if (request.type === 'EXTRACT_CONTEXT') {
      // Page context is a top-frame concern: subframes must not answer.
      if (!isTopFrame) {
        return false;
      }
      const tokenLimit = request.pageContentTokenLimit || 20000;
      const context = extractPageContext(tokenLimit);
      sendResponse(context);
      return true;
    }

    if (request.type === 'GET_SELECTED_TEXT') {
      const descendantHasFocus = hasFocusedDescendantFrame(document);

      if (isTopFrame) {
        // The top frame only answers when no same-origin descendant frame owns
        // the focus; otherwise the focused frame answers with its own selection.
        if (descendantHasFocus) {
          return false;
        }
      } else if (!document.hasFocus()) {
        // Subframes answer only while they are the focused frame.
        return false;
      }

      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';
      sendResponse({ text: selectedText, focused: document.hasFocus() });
      return true;
    }

    if (request.type === 'GET_PAGE_CONTENTS') {
      if (!isTopFrame) {
        return false;
      }
      const content = getMainContent();
      sendResponse({ content });
      return true;
    }

    if (request.type === 'OPEN_CHAT') {
      if (!isTopFrame) {
        return false;
      }
      openChatInterface();
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'INJECT_IFRAME_CHAT') {
      if (!isTopFrame) {
        return false;
      }
      injectChatPopup();
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'UPDATE_DISPLAY_MODE') {
      updateDisplaySettings(request.data);
      if (!isTopFrame) {
        return false;
      }
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'GET_PAGE_CONTENTS_WITH_LIMIT') {
      if (!isTopFrame) {
        return false;
      }
      const content = getMainContentWithTokenLimit(request.tokenLimit || 20000);
      sendResponse({ content });
      return true;
    }

    if (request.type === 'PING') {
      // The background service worker probes whether a content script is
      // reachable on a tab. Every frame answers; the first response wins.
      sendResponse({ success: true, url: window.location.href });
      return true;
    }

    if (request.type === 'UPDATE_FONT_SCALE') {
      // Font scaling applies to every frame of the page.
      currentFontScale = Math.max(0.5, Math.min(8.0, request.scale));
      applyFontScale();
      return true;
    }

    // The union above is exhaustive, so anything reaching this point is a
    // message the extension does not know (for example a message sent by
    // another extension). Subframes stay silent.
    console.warn('Unrecognized message type:', request);
    if (!isTopFrame) {
      return false;
    }
    sendResponse({ error: 'Unrecognized message type' });
    return true;
  },
);

function updateDisplaySettings(settings: Partial<ExtensionSettings>) {
  if (settings.popupDisplayMode) {
    currentDisplayMode = settings.popupDisplayMode;
  }
  if (settings.sidebarPosition) {
    currentSidebarPosition = settings.sidebarPosition;
  }
  if (settings.sidebarWidth !== undefined) {
    currentSidebarWidth = settings.sidebarWidth;
  }

  // Update button settings if they exist
  if (
    settings.buttonPosition ||
    settings.buttonSensitivityAreaPercentage !== undefined
  ) {
    // Update button position and sensitivity if the button exists
    const button = document.getElementById('prism-floating-button');
    if (button && settings.buttonPosition) {
      button.style.top = `${settings.buttonPosition.top}px`;
      button.style.right = `${settings.buttonPosition.right}px`;
    }

    // We can't update the sensitivity area percentage here since it's captured in the closure
    // The next mouse movement will use the updated values from storage
  }
}

function extractPageContext(tokenLimit: number = 20000): ContextData {
  // Get selected text
  const selection = window.getSelection();
  const selectedText = selection?.toString() || undefined;

  // Get main content with token limit (try to be smart about it)
  const mainContent = getMainContentWithTokenLimit(tokenLimit);

  // Get metadata
  const metadata = {
    description: document
      .querySelector('meta[name="description"]')
      ?.getAttribute('content'),
    author: document
      .querySelector('meta[name="author"]')
      ?.getAttribute('content'),
    keywords: document
      .querySelector('meta[name="keywords"]')
      ?.getAttribute('content'),
  };

  const context: ContextData = {
    type: selectedText ? 'selection' : 'page',
    url: window.location.href,
    title: document.title,
    selectedText,
    fullText: mainContent,
    metadata,
  };

  return context;
}

function getMainContent(): string {
  // Get the viewport height to determine where we are scrolled
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY;
  const middleOfViewport = scrollY + viewportHeight / 2;

  // Try common content selectors
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '#content',
    '.post-content',
    '.article-content',
  ];

  let mainElement = null;

  // First, check if there's a main content area that's visible on the page
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const elementTop = rect.top + window.scrollY;
      const elementBottom = rect.bottom + window.scrollY;

      // Check if the element is visible or near the viewport
      if (
        elementTop <= window.scrollY + window.innerHeight &&
        elementBottom >= window.scrollY
      ) {
        mainElement = element;
        break;
      }
    }
    if (mainElement) break;
  }

  // If no specific content element found, fall back to body
  if (!mainElement) {
    mainElement = document.body;
  }

  // Get all text content with positions
  const textWithPositions: { text: string; top: number }[] = [];

  const walker = document.createTreeWalker(mainElement, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      // Only accept text nodes that are not empty or just whitespace
      if (node.nodeValue?.trim()) {
        // Check if the parent element is an ignored element (form, input, etc.)
        if (isIgnoredElement(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    // Get the position of the parent element
    const parentElement = node.parentElement;
    if (parentElement) {
      const rect = parentElement.getBoundingClientRect();
      const top = rect.top + window.scrollY;

      // Only include text from elements that are within the page
      if (top >= 0) {
        textWithPositions.push({
          text: node.nodeValue?.trim() || '',
          top,
        });
      }
    }
  }

  // Sort by position on the page
  textWithPositions.sort((a, b) => a.top - b.top);

  // Find the index closest to the middle of the viewport
  let startIndex = 0;
  for (let i = 0; i < textWithPositions.length; i++) {
    if (textWithPositions[i].top >= middleOfViewport) {
      startIndex = i;
      break;
    }
  }

  // Create content starting from the middle, then add content above and below in a balanced way
  const result: string[] = [];

  // Add content starting from the middle of the viewport
  for (let i = startIndex; i < textWithPositions.length; i++) {
    result.push(textWithPositions[i].text);
  }

  // Add content above the viewport in reverse order (from closest to middle upward)
  for (let i = startIndex - 1; i >= 0; i--) {
    result.unshift(textWithPositions[i].text);
  }

  return result.filter((text) => text.trim()).join('\n\n');
}

function getMainContentWithTokenLimit(tokenLimit: number): string {
  // Get the viewport height to determine where we are scrolled
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY;
  const middleOfViewport = scrollY + viewportHeight / 2;

  // Try common content selectors
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '#content',
    '.post-content',
    '.article-content',
  ];

  let mainElement = null;

  // First, check if there's a main content area that's visible on the page
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const elementTop = rect.top + window.scrollY;
      const elementBottom = rect.bottom + window.scrollY;

      // Check if the element is visible or near the viewport
      if (
        elementTop <= window.scrollY + window.innerHeight &&
        elementBottom >= window.scrollY
      ) {
        mainElement = element;
        break;
      }
    }
    if (mainElement) break;
  }

  // If no specific content element found, fall back to body
  if (!mainElement) {
    mainElement = document.body;
  }

  // Get all text content with positions
  const textWithPositions: { text: string; top: number }[] = [];

  const walker = document.createTreeWalker(mainElement, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      // Only accept text nodes that are not empty or just whitespace
      if (node.nodeValue?.trim()) {
        // Check if the parent element is an ignored element (form, input, etc.)
        if (isIgnoredElement(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    // Get the position of the parent element
    const parentElement = node.parentElement;
    if (parentElement) {
      const rect = parentElement.getBoundingClientRect();
      const top = rect.top + window.scrollY;

      // Only include text from elements that are within the page
      if (top >= 0) {
        textWithPositions.push({
          text: node.nodeValue?.trim() || '',
          top,
        });
      }
    }
  }

  // Sort by position on the page
  textWithPositions.sort((a, b) => a.top - b.top);

  // Find the index closest to the middle of the viewport
  let startIndex = 0;
  for (let i = 0; i < textWithPositions.length; i++) {
    if (textWithPositions[i].top >= middleOfViewport) {
      startIndex = i;
      break;
    }
  }

  // Build content starting from the middle index and alternating to get a balanced view
  const result: string[] = [];
  let tokensUsed = 0;
  let leftIndex = startIndex - 1;
  let rightIndex = startIndex;

  while (
    (leftIndex >= 0 || rightIndex < textWithPositions.length) &&
    tokensUsed < tokenLimit
  ) {
    // Add content from the right (current position and below)
    if (rightIndex < textWithPositions.length) {
      const rightText = textWithPositions[rightIndex].text;
      const rightTokens = estimateTokenCount(rightText);

      if (tokensUsed + rightTokens <= tokenLimit) {
        result.push(rightText);
        tokensUsed += rightTokens;
      } else {
        // Add partial content to respect token limit
        const remainingTokens = tokenLimit - tokensUsed;
        if (remainingTokens > 0) {
          const partialText = truncateToTokenLimit(rightText, remainingTokens);
          if (partialText.length > 0) {
            result.push(partialText);
            tokensUsed = tokenLimit; // Reached the limit
          }
        }
        break;
      }
      rightIndex++;
    }

    // Add content from the left (above current position)
    if (leftIndex >= 0 && tokensUsed < tokenLimit) {
      const leftText = textWithPositions[leftIndex].text;
      const leftTokens = estimateTokenCount(leftText);

      if (tokensUsed + leftTokens <= tokenLimit) {
        result.unshift(leftText); // Add to the beginning to maintain order
        tokensUsed += leftTokens;
      } else {
        // Add partial content to respect token limit
        const remainingTokens = tokenLimit - tokensUsed;
        if (remainingTokens > 0) {
          const partialText = truncateToTokenLimit(leftText, remainingTokens);
          if (partialText.length > 0) {
            result.unshift(partialText); // Add to the beginning to maintain order
            tokensUsed = tokenLimit; // Reached the limit
          }
        }
        break;
      }
      leftIndex--;
    }
  }

  return result.filter((text) => text.trim()).join('\n\n');
}

function truncateToTokenLimit(text: string, tokenLimit: number): string {
  if (tokenLimit <= 0) return '';
  if (estimateTokenCount(text) <= tokenLimit) return text;

  // Simple truncation: split into words and reduce until under the limit
  const words = text.split(/\s+/);
  let result = '';

  for (const word of words) {
    const testResult = result + (result ? ' ' : '') + word;
    if (estimateTokenCount(testResult) > tokenLimit) {
      break;
    }
    result = testResult;
  }

  return result + (result ? '...' : '');
}

// Open chat interface based on current display mode
async function openChatInterface() {
  if (!isTopFrame) {
    return;
  }

  // Get current display settings from storage to determine the mode
  const result = await chrome.storage.local.get(['displaySettings']);
  const settings = result.displaySettings;
  const displayMode = settings?.popupDisplayMode || 'popup';

  // Remove any existing interfaces
  removeExistingInterfaces();

  switch (displayMode) {
    case 'sidebar':
      injectSidebar();
      break;
    case 'iframe':
      // For iframe mode, inject the iframe popup using shadow DOM
      injectChatPopup();
      break;
    case 'floating':
      injectFloatingPopup();
      break;
    case 'popup':
    default:
      // For popup mode, we'll use the browser action popup
      chrome.runtime.sendMessage({ type: 'OPEN_EXTENSION_POPUP' });
      break;
  }
}

// Remove any existing interfaces
function removeExistingInterfaces() {
  // Remove sidebar
  const existingSidebar = document.getElementById('prism-sidebar');
  if (existingSidebar) {
    existingSidebar.remove();
  }

  // Remove iframe popup
  const existingIframe = document.getElementById('prism-iframe-container');
  if (existingIframe) {
    existingIframe.remove();
  }

  // Remove the chat popup iframe, and clear its closed shadow root from the
  // registry so it can be mounted again.
  removeChatPopup();

  // Remove floating popup
  const existingFloating = document.getElementById('prism-floating-popup');
  if (existingFloating) {
    existingFloating.remove();
  }

  // Remove any injected styles
  const existingStyles =
    document.getElementById('prism-sidebar-styles') ||
    document.getElementById('prism-iframe-styles');
  if (existingStyles) {
    existingStyles.remove();
  }

  // Remove the floating popup style element by ID
  const floatingPopupStyle = document.getElementById('prism-floating-styles');
  if (floatingPopupStyle) {
    floatingPopupStyle.remove();
  }
}

// Import dynamic components for sidebar and iframe
async function injectSidebar() {
  if (!isTopFrame) {
    return;
  }

  // Dynamically import the sidebar component
  const { injectSidebar: injectSidebarComponent } =
    await import('../sidebar/Sidebar.js');
  injectSidebarComponent(currentSidebarPosition, currentSidebarWidth);
}

async function injectIframePopup() {
  if (!isTopFrame) {
    return;
  }

  // Dynamically import the iframe component
  const { injectIframePopup: injectIframeComponent } =
    await import('../iframe/IframePopup.js');
  injectIframeComponent();
}
void injectIframePopup;

async function injectFloatingPopup() {
  if (!isTopFrame) {
    return;
  }

  // Check if floating popup already exists to avoid duplicates
  if (document.getElementById('prism-floating-popup')) {
    return;
  }

  // Create the container for the floating popup
  const container = document.createElement('div');
  container.id = 'prism-floating-popup';
  container.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90vw;
    height: 100vh;
    min-width: 400px;
    min-height: 300px;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border: 1px solid var(--border-primary, #ddd);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-primary, white);
  `;

  // Create the header for the floating popup
  const header = document.createElement('div');
  header.style.cssText = `
    height: 40px;
    background: var(--bg-secondary, #f5f5f5);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 10px;
    border-bottom: 1px solid var(--border-primary, #ddd);
    cursor: move;
  `;
  header.innerHTML = `
    <div style="flex: 1; padding: 0 10px; font-weight: bold; color: var(--text-primary, #333);">💎 Prism Chat</div>
    <button id="prism-close-btn" style="
      background: var(--btn-danger-bg, #ff4757);
      color: white;
      border: none;
      border-radius: var(--radius-md, 4px);
      padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
      cursor: pointer;
      font-size: var(--font-sm, 14px);
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    ">✕</button>
  `;

  // Add drag functionality to the header
  let isDragging = false;
  let currentX: number;
  let currentY: number;
  let initialX: number;
  let initialY: number;
  let xOffset = 0;
  let yOffset = 0;

  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('mousemove', drag);

  function dragStart(e: MouseEvent) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === header || header.contains(e.target as Node)) {
      isDragging = true;
    }
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;

    isDragging = false;
  }

  function drag(e: MouseEvent) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, container);
    }
  }

  function setTranslate(xPos: number, yPos: number, el: HTMLElement) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }

  // Create the content container for the React component
  const contentContainer = document.createElement('div');
  contentContainer.style.cssText = `
    width: 100%;
    height: calc(100% - 40px);
    overflow: hidden;
  `;

  // Add CSS styles for the popup content to match the theme
  const style = document.createElement('style');
  style.id = 'prism-floating-styles';
  style.textContent = `
    #prism-floating-popup .popup-container {
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      position: static !important;
      transform: none !important;
    }
  `;
  document.head.appendChild(style);

  // Create the resizer element
  const resizer = document.createElement('div');
  resizer.id = 'prism-popup-resizer';
  resizer.style.cssText = `
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    background: var(--bg-secondary, #f5f5f5);
    cursor: se-resize;
    border-left: 1px solid var(--border-primary, #ddd);
    border-top: 1px solid var(--border-primary, #ddd);
    border-radius: 0 0 0 4px;
  `;
  resizer.innerHTML = `
    <div style="
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--text-secondary, #777);
      border-bottom: 2px solid var(--text-secondary, #777);
      transform: rotate(45deg);
    "></div>
  `;

  // Add resize functionality
  let isResizing = false;
  let initialWidth = 0;
  let initialHeight = 0;
  let initialMouseX = 0;
  let initialMouseY = 0;

  resizer.addEventListener('mousedown', function (e: MouseEvent) {
    e.preventDefault();
    isResizing = true;

    initialWidth = container.offsetWidth;
    initialHeight = container.offsetHeight;
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  });

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;

    const width = initialWidth + (e.clientX - initialMouseX);
    const height = initialHeight + (e.clientY - initialMouseY);

    // Set minimum size
    container.style.width = Math.max(300, width) + 'px';
    container.style.height = Math.max(200, height) + 'px';
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // Add close button functionality
  const closeBtn = container.querySelector('#prism-close-btn');
  closeBtn?.addEventListener('click', () => {
    container.remove();
  });

  // Add all elements to the container
  container.appendChild(header);
  container.appendChild(contentContainer);
  container.appendChild(resizer);

  // Add the container to the body
  document.body.appendChild(container);

  // Dynamically import and render the popup component
  const { renderFloatingPopup } = await import('../popup/FloatingPopup.js');
  renderFloatingPopup(contentContainer);
}

// Add floating button on page (top right corner)
function injectFloatingButton() {
  if (!isTopFrame) {
    return;
  }

  // Check if button already exists to avoid duplicates
  if (document.getElementById('prism-floating-button')) {
    return;
  }

  const button = createFloatingButton(
    'prism-floating-button',
    '💎',
    () => {
      // Send message to open popup or sidebar
      chrome.runtime.sendMessage({ type: 'OPEN_CHAT' });
    },
    `
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
      opacity: 1; /* Changed from 0 to 1 to make it always visible */
      pointer-events: auto; /* Changed from none to auto to make it clickable */
    `,
  );

  // Add close button functionality
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    button.style.opacity = '0';
    buttonRemovedByUser = true; // Mark that user removed the button
    localStorage.setItem('prismButtonRemoved', 'true'); // Persist the state
    setTimeout(() => {
      document.body.removeChild(button);
    }, 200);
  });

  document.body.appendChild(button);

  // Add mouse tracking to show/hide button based on mouse position (optional enhancement)
  // Commenting out the mouse tracking to make the button always visible
  // setupMouseTracking(button);
}

// Function to inject the chat popup iframe using shadow DOM
function injectChatPopup() {
  if (!isTopFrame) {
    return;
  }

  // Check if popup already exists to avoid duplicates. The iframe lives
  // inside a closed shadow root, so the extension checks its own registry
  // rather than querying the document.
  if (hasShadowRoot(CHAT_POPUP_CONTAINER_ID)) {
    return;
  }

  // Create the container
  const container = createShadowHost(CHAT_POPUP_CONTAINER_ID);
  document.body.appendChild(container);

  // Create Shadow DOM to isolate styles
  const shadow = attachShadowToElement(container);

  // Add basic styles to the shadow DOM to ensure proper rendering
  const style = document.createElement('style');
  style.textContent = `
    button {
      font-family: inherit;
      cursor: pointer;
    }

    iframe {
      all: initial; /* Reset all styles for the iframe */
    }
  `;
  shadow.appendChild(style);

  // Create the iframe
  const iframe = createIframe({
    src: chrome.runtime.getURL('chat.html'), // Points to your React chat page
    id: CHAT_IFRAME_ID,
    style: `
      position: fixed;
      top: 0;
      left: 5%;
      width: 90%;
      height: 100%;
      z-index: 2147483647;
      border: none;
      background: white;
    `,
  });

  // Add the iframe to the shadow DOM
  shadow.appendChild(iframe);

  // Add controls container
  const controlsContainer = document.createElement('div');
  controlsContainer.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2147483648;
    display: flex;
    gap: 5px;
  `;

  // Add clear button
  const clearButton = createButton(
    '🗑️',
    'Clear chat',
    `
      background: #ff4757;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      // Send message to clear the chat in the iframe
      iframe.contentWindow?.postMessage({ type: 'CLEAR_CHAT' }, '*');
    },
  );

  // Add retry button
  const retryButton = createButton(
    '🔄',
    'Retry last message',
    `
      background: #374151;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      // Send message to retry the last message in the iframe
      iframe.contentWindow?.postMessage({ type: 'RETRY_LAST_MESSAGE' }, '*');
    },
  );

  // Add close button
  const closeButton = createButton(
    '✕',
    'Close iframe',
    `
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      removeChatPopup();
    },
  );

  // Add escape key listener to close the iframe
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      removeChatPopup();
    }
  };

  // Add the event listener to the shadow root's document
  shadow.ownerDocument.addEventListener('keydown', handleEscape, true);

  // Add all buttons to the controls container
  controlsContainer.appendChild(clearButton);
  controlsContainer.appendChild(retryButton);
  controlsContainer.appendChild(closeButton);

  // Add controls to shadow DOM
  shadow.appendChild(controlsContainer);

  // Focus the iframe so the user can start typing immediately
  iframe.onload = () => {
    // Give the iframe a moment to load before focusing
    setTimeout(() => {
      iframe.focus();
      // Send a message to the React app to focus its internal input
      iframe.contentWindow?.postMessage({ action: 'FOCUS_INPUT' }, '*');
    }, 100);
  };
}

// setupMouseTracking is intentionally not wired up — currently a no-op helper
function setupMouseTracking(button: HTMLElement) {
  // Default settings
  let buttonPosition: { top: number; right: number } = { top: 20, right: 20 };
  let sensitivityAreaPercentage: number = 10; // 10% of screen width/height

  // Load settings from storage
  loadButtonSettings().then((settings) => {
    if (settings) {
      buttonPosition = settings.position || buttonPosition;
      sensitivityAreaPercentage =
        settings.sensitivityAreaPercentage || sensitivityAreaPercentage;
    }

    // Update button position based on settings
    button.style.top = `${buttonPosition.top}px`;
    button.style.right = `${buttonPosition.right}px`;
  });

  // Track mouse movement
  document.addEventListener('mousemove', (event) => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Calculate sensitivity area dimensions
    const sensitivityWidth = (windowWidth * sensitivityAreaPercentage) / 100;
    const sensitivityHeight = (windowHeight * sensitivityAreaPercentage) / 100;

    // Check if mouse is in the top-right corner sensitivity area
    const isInTopRightCorner =
      event.clientX >= windowWidth - sensitivityWidth &&
      event.clientX <= windowWidth &&
      event.clientY >= 0 &&
      event.clientY <= sensitivityHeight;

    // Show or hide the button based on mouse position
    if (isInTopRightCorner) {
      button.style.opacity = '1';
      button.style.pointerEvents = 'auto';
    } else {
      button.style.opacity = '0';
      button.style.pointerEvents = 'none';
    }
  });
}
void setupMouseTracking;

// Load button settings from storage
async function loadButtonSettings() {
  try {
    const result = await chrome.storage.local.get(['buttonSettings']);
    return result.buttonSettings || null;
  } catch (error) {
    console.warn('Could not load button settings:', error);
    return null;
  }
}

// Check if button was previously removed by the user
let buttonRemovedByUser = localStorage.getItem('prismButtonRemoved') === 'true';

// Enable floating button
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Check if button was previously removed by the user
    buttonRemovedByUser = localStorage.getItem('prismButtonRemoved') === 'true';

    if (!buttonRemovedByUser) {
      injectFloatingButton();
    }
    loadDisplaySettings();
  });
} else {
  // Check if button was previously removed by the user
  buttonRemovedByUser = localStorage.getItem('prismButtonRemoved') === 'true';

  if (!buttonRemovedByUser) {
    injectFloatingButton();
  }
  loadDisplaySettings();
  initializeFontScale();
  setupHotkeyListener();
}

// Check if button was previously removed by the user
// (declared above to avoid TDZ errors)

// Initialize prompt shortcuts in chrome.storage.local when content script loads
async function initializePromptShortcuts() {
  try {
    // Get all prompt shortcuts from storage and sync them to chrome.storage.local
    // This is needed for the keyboard shortcut detection in the content script
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    ) {
      // We'll sync from the extension's main storage when the popup sends us the updated list
      // For now, we rely on the popup to sync the prompt shortcuts to chrome.storage.local
    }
  } catch (error) {
    console.error('Error initializing prompt shortcuts:', error);
  }
}

// Call initialization function
initializePromptShortcuts();

// Setup prompt shortcut replacement in text fields
setupPromptShortcutReplacement();

/**
 * The snippets and hotkeys the page-level engine works from.
 *
 * The content script cannot read IndexedDB, so it reads the list the
 * extension mirrors into `chrome.storage.local`. The list is refreshed
 * whenever storage changes, so edits made in the popup take effect without
 * a page reload.
 */
let engineSnippets: Snippet[] = [];
let engineHotkeys: HotkeyBinding[] = [];
let enginePromptShortcuts: PromptShortcut[] = [];

/** Reads the mirrored snippet and hotkey lists from extension storage. */
async function refreshEngineData(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      'prismSnippets',
      'prismHotkeys',
      'promptShortcuts',
    ]);

    const snippets = result.prismSnippets;
    const hotkeys = result.prismHotkeys;
    const promptShortcuts = result.promptShortcuts;

    engineSnippets = Array.isArray(snippets) ? (snippets as Snippet[]) : [];
    engineHotkeys = Array.isArray(hotkeys) ? (hotkeys as HotkeyBinding[]) : [];
    enginePromptShortcuts = Array.isArray(promptShortcuts)
      ? (promptShortcuts as PromptShortcut[])
      : [];
  } catch (error) {
    console.error('Failed to refresh snippet and hotkey data:', error);
  }
}

/**
 * Reads the current state of a toggle mode.
 *
 * The background stores mode state under `mode_<name>`, so the engine can
 * flip a mode that is currently off.
 */
async function getModeState(mode: string): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([`mode_${mode}`]);
    return result[`mode_${mode}`] === true;
  } catch {
    return false;
  }
}

/**
 * The page-level hotkey and snippet engine.
 *
 * This runs in every frame so snippets expand in editors that live inside
 * iframes, matching how Blaze installs itself into nested frames.
 */
const hotkeyEngine = createHotkeyEngine({
  getSnippets: () => engineSnippets,
  getHotkeys: () => engineHotkeys.filter((binding) => binding.enabled),
  getPromptShortcuts: async () => {
    // Prompt shortcuts are read fresh so a shortcut added in the popup works
    // immediately, without waiting for the next storage-change event.
    try {
      const result = await chrome.storage.local.get(['promptShortcuts']);
      const shortcuts = result.promptShortcuts;
      return Array.isArray(shortcuts)
        ? (shortcuts as PromptShortcut[])
        : enginePromptShortcuts;
    } catch {
      return enginePromptShortcuts;
    }
  },
  getModeState,
  isClaimedByOtherFeature: isSequenceInProgress,
  onPromptShortcut: (content) => {
    void Promise.resolve(
      chrome.runtime.sendMessage({ type: 'INSERT_PROMPT_SHORTCUT', content }),
    ).catch(() => {
      // The background may not be reachable; the shortcut is dropped.
    });
  },
  onToggleMode: (mode, enabled) => {
    void Promise.resolve(
      chrome.runtime.sendMessage({ type: 'TOGGLE_MODE', mode, value: enabled }),
    ).catch(() => {
      // The background may not be reachable; the mode simply stays as it is.
    });

    const labels: Record<string, string> = {
      textSelection: 'Text selection',
      pageContext: 'Page context',
      pageScreenshot: 'Page screenshot',
      clipboard: 'Clipboard',
      pageInfo: 'Page info',
    };
    showToast(
      `${labels[mode] ?? mode} mode ${enabled ? 'enabled' : 'disabled'}`,
    );
  },
  onSnippetExpanded: (snippet) => {
    showToast(`Inserted snippet: ${snippet.name}`);
  },
});

hotkeyEngine.start();
void refreshEngineData();

// Keep the engine in step with edits made in the popup or settings.
// The listener is optional: not every environment that loads the content
// script exposes storage change notifications.
chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (changes.prismSnippets || changes.prismHotkeys || changes.promptShortcuts) {
    void refreshEngineData();
  }
});

// Only observe if the button hasn't been removed by the user
if (isTopFrame && !buttonRemovedByUser) {
  const observer = new MutationObserver((mutationsList) => {
    if (!document.getElementById('prism-floating-button')) {
      setTimeout(() => injectFloatingButton(), 500); // Small delay to allow page to load
    }
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Get initial font scale from storage
let currentFontScale = 1.0;
async function initializeFontScale() {
  try {
    const result = await chrome.storage.local.get(['fontScale']);
    if (result.fontScale) {
      currentFontScale = Math.max(0.5, Math.min(8.0, result.fontScale)); // Clamp between 0.5 and 2.0
    }
    applyFontScale();
  } catch (error) {
    console.warn('Could not load font scale, using default:', error);
  }
}

// Apply font scale to the page
function applyFontScale() {
  if (!document.documentElement.style.getPropertyValue('--font-scale')) {
    // Add the CSS variable if it doesn't exist yet
    document.documentElement.style.setProperty(
      '--font-scale',
      currentFontScale.toString(),
    );
  } else {
    document.documentElement.style.setProperty(
      '--font-scale',
      currentFontScale.toString(),
    );
  }

  // Also update the root font size
  const baseFontSize = 32 * currentFontScale; // 32px base * scale (default font size is 32px)
  document.documentElement.style.fontSize = `${baseFontSize}px`;
}

// Increase font size
function increaseFontSize() {
  currentFontScale = Math.min(2.0, currentFontScale + 0.1); // Cap at 2.0
  applyFontScale();
  chrome.storage.local.set({ fontScale: currentFontScale });
}

// Decrease font size
function decreaseFontSize() {
  currentFontScale = Math.max(0.5, currentFontScale - 0.1); // Minimum 0.5
  applyFontScale();
  chrome.storage.local.set({ fontScale: currentFontScale });
}

// Add hotkey listener for Ctrl+'
function setupHotkeyListener() {
  // Listen in the capture phase to intercept keys before the website
  document.addEventListener(
    'keydown',
    async (event) => {
      // Check if Ctrl key is pressed and the apostrophe key (' or `) is pressed
      if (
        event.ctrlKey &&
        (event.key === "'" || event.key === '`' || event.code === 'Quote')
      ) {
        event.preventDefault();

        // Only handle iframe mode specifically
        if (currentDisplayMode === 'iframe') {
          // Check if iframe already exists, if so remove it
          const existingIframe = document.getElementById(
            'prism-iframe-container',
          );
          if (existingIframe) {
            existingIframe.remove();
          } else {
            // Otherwise, open the chat interface which will use iframe mode
            openChatInterface();
          }
        } else {
          // If not in iframe mode, temporarily switch to iframe mode and open
          const originalMode = currentDisplayMode;
          currentDisplayMode = 'iframe';
          openChatInterface();

          // Reset to original mode after opening
          currentDisplayMode = originalMode;
        }
      }

      // Check if Ctrl+key is pressed to toggle iframe (configurable)
      // Get extension settings to check for custom key binding
      try {
        const result = await chrome.storage.local.get(['displaySettings']);
        const settings = result.displaySettings || {};
        const iframeToggleKey = settings.iframeToggleKey || '`';

        if (event.ctrlKey && event.key === iframeToggleKey) {
          event.preventDefault();
          injectIframePopup().catch(() => {
            /* ignore */
          });
          return;
        }
      } catch (error) {
        console.error('Error checking iframe toggle key:', error);
        // Fallback to default key if settings can't be loaded
        if (event.ctrlKey && event.key === '`') {
          event.preventDefault();
          injectIframePopup().catch(() => {
            /* ignore */
          });
          return;
        }
      }

      // Check if the target is an input field (input, textarea, or contenteditable)
      const target = event.target as HTMLElement;
      const isInputElement =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isContentEditable = target.isContentEditable;

      // Only handle mode toggles and other shortcuts if not in an input field or contenteditable element
      if (!isInputElement && !isContentEditable) {
        // Check for Shift+- or Shift+= keys for font size adjustment
        if (event.shiftKey && event.key === '-') {
          event.preventDefault();
          decreaseFontSize();
        } else if (event.shiftKey && (event.key === '=' || event.key === '+')) {
          event.preventDefault();
          increaseFontSize();
        }

        // Check for mode toggle keys (Shift + number keys)
        if (event.shiftKey) {
          // Get extension settings to check for custom key bindings
          try {
            const result = await chrome.storage.local.get(['displaySettings']);
            const settings = result.displaySettings || {};

            // Default key bindings
            const textSelectionKey = settings.textSelectionKey || '1';
            const pageContextKey = settings.pageContextKey || '2';
            const pageScreenshotKey = settings.pageScreenshotKey || '3';
            const clipboardKey = settings.clipboardKey || '4';
            const pageInfoKey = settings.pageInfoKey || '5';

            // Check which mode key was pressed
            if (event.key === textSelectionKey) {
              event.preventDefault();
              // Toggle text selection mode
              chrome.runtime.sendMessage({
                type: 'TOGGLE_MODE',
                mode: 'textSelection',
                value: true,
              });
              showToast('Text selection mode enabled');
            } else if (event.key === pageContextKey) {
              event.preventDefault();
              // Toggle page context mode
              chrome.runtime.sendMessage({
                type: 'TOGGLE_MODE',
                mode: 'pageContext',
                value: true,
              });
              showToast('Page context mode enabled');
            } else if (event.key === pageScreenshotKey) {
              event.preventDefault();
              // Toggle page screenshot mode
              chrome.runtime.sendMessage({
                type: 'TOGGLE_MODE',
                mode: 'pageScreenshot',
                value: true,
              });
              showToast('Page screenshot mode enabled');
            } else if (event.key === clipboardKey) {
              event.preventDefault();
              // Toggle clipboard mode
              chrome.runtime.sendMessage({
                type: 'TOGGLE_MODE',
                mode: 'clipboard',
                value: true,
              });
              showToast('Clipboard mode enabled');
            } else if (event.key === pageInfoKey) {
              event.preventDefault();
              // Toggle page info mode
              chrome.runtime.sendMessage({
                type: 'TOGGLE_MODE',
                mode: 'pageInfo',
                value: true,
              });
              showToast('Page info mode enabled');
            }
          } catch (error) {
            console.error('Error checking mode toggle keys:', error);
          }
        }

        // Registered prompt shortcuts are handled by the hotkey engine,
        // which matches their key combinations with the same rules as the
        // other page-level hotkeys.
      }
    },
    true,
  ); // Use capture phase to intercept keys before the website

  // Listen for prompt sequence shortcuts in capture phase
  const PROMPT_SHORTCUT = PROMPT_SEQUENCE;
  const PARTIAL_TRIGGER = '/p'; // Start blocking propagation at this point
  void PARTIAL_TRIGGER;

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as HTMLElement;

      // Only care if the user is typing in an input or textarea
      if (!(
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return;
      }

      const char = event.key;

      // 1. Check for Partial Match to block Search Bar interference
      const potentialBuffer = promptSequenceBuffer + char;

      if (PROMPT_SHORTCUT.startsWith(potentialBuffer)) {
        // This stops YouTube/X from seeing the key and triggering their own shortcuts
        event.stopPropagation();
        promptSequenceBuffer = potentialBuffer;

        // 2. Check for Full Match
        if (promptSequenceBuffer === PROMPT_SHORTCUT) {
          event.preventDefault(); // Stop the last character from being typed

          deleteTypedSequence(target, PROMPT_SHORTCUT.length - 1); // Delete the prefix
          launchIframe();
          promptSequenceBuffer = ''; // Reset
        }
      } else {
        promptSequenceBuffer = ''; // Reset if user types something else
      }
    },
    true,
  ); // The 'true' here is CRITICAL: it enables the Capture Phase

  // Global sequence detection for anywhere on the page
  const GLOBAL_SHORTCUT = GLOBAL_PROMPT_SEQUENCE; // No slash needed if you want it purely global
  const MAX_BUFFER_LENGTH = 20;

  document.addEventListener(
    'keydown',
    (event) => {
      // 1. Ignore modifier keys (Shift, Control, etc.)
      if (event.key.length > 1 && event.key !== 'Backspace') return;

      // 2. Handle Backspace (optional: allows users to correct typos in the sequence)
      if (event.key === 'Backspace') {
        globalSequenceBuffer = globalSequenceBuffer.slice(0, -1);
        return;
      }

      globalSequenceBuffer += event.key.toLowerCase();

      // 3. Keep buffer lean
      if (globalSequenceBuffer.length > MAX_BUFFER_LENGTH) {
        globalSequenceBuffer = globalSequenceBuffer.substring(
          globalSequenceBuffer.length - MAX_BUFFER_LENGTH,
        );
      }

      // 4. Check for Partial Match to block site hotkeys
      // If the user starts typing "pro...", we stop the site from reacting.
      if (
        GLOBAL_SHORTCUT.startsWith(globalSequenceBuffer) &&
        globalSequenceBuffer.length > 0
      ) {
        event.stopPropagation();

        // 5. Check for Full Match
        if (globalSequenceBuffer === GLOBAL_SHORTCUT) {
          event.preventDefault();
          launchIframe();
          globalSequenceBuffer = ''; // Reset
        }
      } else {
        // If the sequence is broken (e.g., they typed "prx"), reset
        globalSequenceBuffer = event.key.toLowerCase();
      }
    },
    true,
  ); // Capture phase is still mandatory
}

// Function to delete the typed sequence from the input
function deleteTypedSequence(element: HTMLElement, length: number) {
  if (element.isContentEditable) {
    // For sites like Gmail or Twitter/X composer
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      void selection.getRangeAt(0);
      for (let i = 0; i < length; i++) {
        document.execCommand('delete', false, undefined);
      }
    }
  } else {
    // For standard inputs (YouTube search, etc.)
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
    const start = inputElement.selectionStart || 0;
    const end = inputElement.selectionEnd || 0;
    const value = inputElement.value;

    inputElement.value = value.slice(0, start - length) + value.slice(end);
    // Restore cursor position
    inputElement.selectionStart = inputElement.selectionEnd = start - length;
  }
}

// Function to launch the iframe
function launchIframe() {
  if (!isTopFrame) {
    return;
  }

  // Check if iframe already exists to avoid duplicates. The iframe lives
  // inside a closed shadow root, so the extension checks its own registry
  // rather than querying the document.
  if (hasShadowRoot(CHAT_POPUP_CONTAINER_ID)) {
    return;
  }

  // Create the container
  const container = createShadowHost(CHAT_POPUP_CONTAINER_ID);
  document.body.appendChild(container);

  // Create Shadow DOM to isolate styles
  const shadow = attachShadowToElement(container);

  // Add basic styles to the shadow DOM
  const style = document.createElement('style');
  style.textContent = `
    button {
      font-family: inherit;
      cursor: pointer;
    }
  `;
  shadow.appendChild(style);

  // Create the iframe
  const iframe = createIframe({
    src: chrome.runtime.getURL('chat.html'), // Points to your React chat page
    id: CHAT_IFRAME_ID,
    style: `
      position: fixed;
      top: 0;
      left: 5%;
      width: 90%;
      height: 100%;
      z-index: 2147483647;
      border: none;
      background: white;
    `,
  });

  // Add the iframe to the shadow DOM
  shadow.appendChild(iframe);

  // Add controls container
  const controlsContainer = document.createElement('div');
  controlsContainer.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2147483648;
    display: flex;
    gap: 5px;
  `;

  // Add clear button
  const clearButton = createButton(
    '🗑️',
    'Clear chat',
    `
      background: #ff4757;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      // Send message to clear the chat in the iframe
      iframe.contentWindow?.postMessage({ type: 'CLEAR_CHAT' }, '*');
    },
  );

  // Add retry button
  const retryButton = createButton(
    '🔄',
    'Retry last message',
    `
      background: #374151;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      // Send message to retry the last message in the iframe
      iframe.contentWindow?.postMessage({ type: 'RETRY_LAST_MESSAGE' }, '*');
    },
  );

  // Add close button
  const closeButton = createButton(
    '✕',
    'Close iframe',
    `
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 4px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    `,
    () => {
      removeChatPopup();
    },
  );

  // Add escape key listener to close the iframe
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      removeChatPopup();
    }
  };

  // Add the event listener to the shadow root's document
  shadow.ownerDocument.addEventListener('keydown', handleEscape, true);

  // Add all buttons to the controls container
  controlsContainer.appendChild(clearButton);
  controlsContainer.appendChild(retryButton);
  controlsContainer.appendChild(closeButton);

  // Add controls to shadow DOM
  shadow.appendChild(controlsContainer);

  // Focus the iframe so the user can start typing immediately
  iframe.onload = () => {
    // Give the iframe a moment to load before focusing
    setTimeout(() => {
      iframe.focus();
      // Send a message to the React app to focus its internal input
      iframe.contentWindow?.postMessage({ action: 'FOCUS_INPUT' }, '*');
    }, 100);
  };
}

// Function to remove the chat popup
function removeChatPopup() {
  const container = document.getElementById(CHAT_POPUP_CONTAINER_ID);
  if (container) {
    container.remove();
  }
  // The shadow root is closed, so the registry has to be cleared explicitly
  // for the popup to be mountable again.
  forgetShadowRoot(CHAT_POPUP_CONTAINER_ID);
}

// Guards against the input event we dispatch ourselves re-entering the
// shortcut handler.
let isReplacingPromptShortcut = false;

// Function to replace prompt shortcuts in text fields
function setupPromptShortcutReplacement() {
  // Listen for input events on text fields
  document.addEventListener(
    'input',
    async (event) => {
      if (isReplacingPromptShortcut) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target || !isEditableTarget(target)) {
        return;
      }

      try {
        // Get all prompt shortcuts from storage
        const result = await chrome.storage.local.get(['promptShortcuts']);
        const promptShortcuts = result.promptShortcuts || [];

        // Resolve the editable that owns the event target. For contenteditable
        // hosts the target may be a nested node, so walk up to the host. When
        // the caret lives in a same-origin iframe, findActiveEditable descends
        // into that frame.
        const targetEditable = findEditableHost(target);
        const activeEditable = findActiveEditable(document);
        const editable =
          activeEditable &&
          (activeEditable === target || activeEditable.contains(target))
            ? activeEditable
            : targetEditable;

        const currentValue =
          (isInputElement(editable) || isTextAreaElement(editable)
            ? (editable as HTMLInputElement | HTMLTextAreaElement).value
            : editable.textContent) || '';

        // Check if the current value contains any prompt shortcuts
        for (const prompt of promptShortcuts) {
          if (prompt.shortcutKey && currentValue.includes(prompt.shortcutKey)) {
            isReplacingPromptShortcut = true;
            try {
              // Replace only the matched shortcut occurrence, in place, so
              // surrounding content and formatting survive the replacement.
              const replaced = replaceRangeWithText(
                editable,
                prompt.shortcutKey,
                prompt.content,
              );

              if (!replaced) {
                continue;
              }

              // Trigger input event to notify other listeners. The event is
              // created in the editable's own realm so it can be dispatched
              // on elements living inside an iframe.
              const EventConstructor =
                editable.ownerDocument.defaultView?.Event ?? Event;
              editable.dispatchEvent(
                new EventConstructor('input', {
                  bubbles: true,
                  composed: true,
                }),
              );
            } finally {
              isReplacingPromptShortcut = false;
            }

            // Show a notification that the replacement occurred
            showToast(`Replaced ${prompt.shortcutKey} with prompt`);

            break; // Only replace the first match to avoid conflicts
          }
        }
      } catch (error) {
        console.error('Error processing prompt shortcuts:', error);
      }
    },
    true,
  ); // Use capture phase
}

// Load display settings from storage
async function loadDisplaySettings() {
  try {
    const result = await chrome.storage.local.get(['displaySettings']);
    if (result.displaySettings) {
      updateDisplaySettings(result.displaySettings);
    }
  } catch (error) {
    console.error('Error loading display settings:', error);
  }
}

console.log('Prism content script loaded on:', window.location.href);
