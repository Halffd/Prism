import type { ContextData, ExtensionSettings, PopupDisplayMode } from '@prism/shared-types';

// Default settings
let currentDisplayMode: PopupDisplayMode = 'popup';
let currentSidebarPosition: 'left' | 'right' = 'right';
let currentSidebarWidth: number = 350;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_CONTEXT') {
    const tokenLimit = request.pageContentTokenLimit || 20000;
    const context = extractPageContext(tokenLimit);
    sendResponse(context);
    return true;
  }

  if (request.type === 'GET_SELECTED_TEXT') {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    sendResponse({ text: selectedText });
    return true;
  }

  if (request.type === 'GET_PAGE_CONTENTS') {
    const content = getMainContent();
    sendResponse({ content });
    return true;
  }

  if (request.type === 'OPEN_CHAT') {
    openChatInterface();
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'UPDATE_DISPLAY_MODE') {
    updateDisplaySettings(request.data);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'GET_PAGE_CONTENTS_WITH_LIMIT') {
    const content = getMainContentWithTokenLimit(request.tokenLimit || 20000);
    sendResponse({ content });
    return true;
  }

  if (request.type === 'UPDATE_FONT_SCALE') {
    currentFontScale = Math.max(0.5, Math.min(2.0, request.scale));
    applyFontScale();
    return true;
  }
});

// Simple token estimation function (roughly 1 token = 4 characters or 1 word)
function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) return 0;

  // Simple estimation: split by whitespace and punctuation
  const words = text.trim().split(/\s+/).filter(word => word.length > 0);
  // Rough estimation: about 1 token per word, but longer words might be multiple tokens
  let tokenCount = 0;
  for (const word of words) {
    // For longer words, count as multiple tokens (common in tokenizers)
    if (word.length <= 4) {
      tokenCount += 1;
    } else {
      // Estimate: 1 token per 4-5 characters
      tokenCount += Math.ceil(word.length / 4);
    }
  }
  return Math.max(1, tokenCount);
}

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
}

function extractPageContext(tokenLimit: number = 20000): ContextData {
  // Get selected text
  const selection = window.getSelection();
  const selectedText = selection?.toString() || undefined;

  // Get main content with token limit (try to be smart about it)
  const mainContent = getMainContentWithTokenLimit(tokenLimit);

  // Get metadata
  const metadata = {
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    author: document.querySelector('meta[name="author"]')?.getAttribute('content'),
    keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content'),
  };

  const context: ContextData = {
    type: selectedText ? 'selection' : 'page',
    url: window.location.href,
    title: document.title,
    selectedText,
    fullText: mainContent,
    metadata
  };

  return context;
}

function getMainContent(): string {
  // Get the viewport height to determine where we are scrolled
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY;
  const middleOfViewport = scrollY + (viewportHeight / 2);

  // Try common content selectors
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '#content',
    '.post-content',
    '.article-content'
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
      if (elementTop <= window.scrollY + window.innerHeight && elementBottom >= window.scrollY) {
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
  const textWithPositions: { text: string, top: number }[] = [];

  const walker = document.createTreeWalker(
    mainElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Only accept text nodes that are not empty or just whitespace
        if (node.nodeValue?.trim()) {
          // Check if the parent element is an ignored element (form, input, etc.)
          if (isIgnoredElement(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  let node: Node | null;
  while (node = walker.nextNode()) {
    // Get the position of the parent element
    const parentElement = node.parentElement;
    if (parentElement) {
      const rect = parentElement.getBoundingClientRect();
      const top = rect.top + window.scrollY;

      // Only include text from elements that are within the page
      if (top >= 0) {
        textWithPositions.push({
          text: node.nodeValue?.trim() || '',
          top
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

  return result.filter(text => text.trim()).join('\n\n');
}

function isIgnoredElement(element: Element | null): boolean {
  if (!element) return false;

  const tagName = element.tagName.toLowerCase();
  const className = element.className.toLowerCase();
  const id = element.id.toLowerCase();

  // Ignore form elements
  if (['input', 'textarea', 'select', 'option', 'button', 'form'].includes(tagName)) {
    return true;
  }

  // Ignore elements that might contain emails or sensitive info
  if (className.includes('email') || className.includes('contact') ||
      id.includes('email') || id.includes('contact') ||
      className.includes('form') || id.includes('form') ||
      className.includes('login') || id.includes('login') ||
      className.includes('password') || id.includes('password')) {
    return true;
  }

  // Ignore script and style tags
  if (['script', 'style', 'noscript'].includes(tagName)) {
    return true;
  }

  return false;
}

function getMainContentWithTokenLimit(tokenLimit: number): string {
  // Get the viewport height to determine where we are scrolled
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY;
  const middleOfViewport = scrollY + (viewportHeight / 2);

  // Try common content selectors
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '#content',
    '.post-content',
    '.article-content'
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
      if (elementTop <= window.scrollY + window.innerHeight && elementBottom >= window.scrollY) {
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
  const textWithPositions: { text: string, top: number }[] = [];

  const walker = document.createTreeWalker(
    mainElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Only accept text nodes that are not empty or just whitespace
        if (node.nodeValue?.trim()) {
          // Check if the parent element is an ignored element (form, input, etc.)
          if (isIgnoredElement(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  let node: Node | null;
  while (node = walker.nextNode()) {
    // Get the position of the parent element
    const parentElement = node.parentElement;
    if (parentElement) {
      const rect = parentElement.getBoundingClientRect();
      const top = rect.top + window.scrollY;

      // Only include text from elements that are within the page
      if (top >= 0) {
        textWithPositions.push({
          text: node.nodeValue?.trim() || '',
          top
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

  while ((leftIndex >= 0 || rightIndex < textWithPositions.length) && tokensUsed < tokenLimit) {
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

  return result.filter(text => text.trim()).join('\n\n');
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

  return result;
}

// Open chat interface based on current display mode
function openChatInterface() {
  // Remove any existing interfaces
  removeExistingInterfaces();

  switch (currentDisplayMode) {
    case 'sidebar':
      injectSidebar();
      break;
    case 'iframe':
      injectIframePopup();
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

  // Remove floating popup
  const existingFloating = document.getElementById('prism-floating-popup');
  if (existingFloating) {
    existingFloating.remove();
  }

  // Remove any injected styles
  const existingStyles = document.getElementById('prism-sidebar-styles') ||
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
  // Dynamically import the sidebar component
  const { injectSidebar: injectSidebarComponent } = await import('../sidebar/Sidebar.js');
  injectSidebarComponent(currentSidebarPosition, currentSidebarWidth);
}

async function injectIframePopup() {
  // Dynamically import the iframe component
  const { injectIframePopup: injectIframeComponent } = await import('../iframe/IframePopup.js');
  injectIframeComponent();
}

async function injectFloatingPopup() {
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
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  header.addEventListener("mousedown", dragStart);
  document.addEventListener("mouseup", dragEnd);
  document.addEventListener("mousemove", drag);

  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
    }
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;

    isDragging = false;
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, container);
    }
  }

  function setTranslate(xPos, yPos, el) {
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
  let initialWidth, initialHeight, initialMouseX, initialMouseY;

  resizer.addEventListener('mousedown', function(e) {
    e.preventDefault();
    isResizing = true;

    initialWidth = container.offsetWidth;
    initialHeight = container.offsetHeight;
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  });

  function handleResize(e) {
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
  // Check if button already exists to avoid duplicates
  if (document.getElementById('prism-floating-button')) {
    return;
  }

  const button = document.createElement('div');
  button.id = 'prism-floating-button';
  button.innerHTML = '💎';
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
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('click', () => {
    // Send message to open popup or sidebar
    chrome.runtime.sendMessage({ type: 'OPEN_CHAT' });
  });

  // Add close button functionality
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    button.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(button);
    }, 200);
  });

  document.body.appendChild(button);
}

// Enable floating button
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectFloatingButton();
    loadDisplaySettings();
  });
} else {
  injectFloatingButton();
  loadDisplaySettings();
  initializeFontScale();
  setupHotkeyListener();
}

// Re-inject button if it's removed (e.g., by SPA navigation)
const observer = new MutationObserver((mutationsList) => {
  if (!document.getElementById('prism-floating-button')) {
    setTimeout(() => injectFloatingButton(), 500); // Small delay to allow page to load
  }
});

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Get initial font scale from storage
let currentFontScale = 1.0;
async function initializeFontScale() {
  try {
    const result = await chrome.storage.local.get(['fontScale']);
    if (result.fontScale) {
      currentFontScale = Math.max(0.5, Math.min(2.0, result.fontScale)); // Clamp between 0.5 and 2.0
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
    document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());
  } else {
    document.documentElement.style.setProperty('--font-scale', currentFontScale.toString());
  }

  // Also update the root font size
  const baseFontSize = 16 * currentFontScale; // 16px base * scale
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
  document.addEventListener('keydown', (event) => {
    // Check if Ctrl key is pressed and the apostrophe key (' or `) is pressed
    if (event.ctrlKey && (event.key === "'" || event.key === '`' || event.code === 'Quote')) {
      event.preventDefault();

      // Only handle iframe mode specifically
      if (currentDisplayMode === 'iframe') {
        // Check if iframe already exists, if so remove it
        const existingIframe = document.getElementById('prism-iframe-container');
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

    // Check for + or - keys (with or without Shift for +) for font size adjustment
    if (event.key === '+' || event.key === '=' || event.key === 'Add') {
      event.preventDefault();
      increaseFontSize();
    } else if (event.key === '-' || event.key === 'Subtract') {
      event.preventDefault();
      decreaseFontSize();
    }
  });
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