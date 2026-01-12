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

  if (request.type === 'INJECT_IFRAME_CHAT') {
    injectChatPopup();
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

  // Update button settings if they exist
  if (settings.buttonPosition || settings.buttonSensitivityAreaPercentage !== undefined) {
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
async function openChatInterface() {
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
    opacity: 0;
    pointer-events: none;
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
  });

  // Fixed click handler to properly open the chat interface
  button.addEventListener('click', () => {
    // Send message to open popup or sidebar
    chrome.runtime.sendMessage({ type: 'OPEN_CHAT' });
  });

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

  // Add mouse tracking to show/hide button based on mouse position
  setupMouseTracking(button);
}

// Function to inject the chat popup iframe using shadow DOM
function injectChatPopup() {
  // Check if popup already exists to avoid duplicates
  if (document.getElementById('prism-chat-popup-container')) {
    return;
  }

  // Create the container
  const container = document.createElement('div');
  container.id = 'prism-chat-popup-container';
  document.body.appendChild(container);

  // Create Shadow DOM to isolate styles
  const shadow = container.attachShadow({ mode: 'open' });

  // Create the iframe
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('chat.html'); // Points to your React chat page
  iframe.id = 'prism-chat-iframe';
  iframe.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 400px;
    height: 600px;
    z-index: 2147483647;
    border: none;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: white;
  `;

  // Add close button to the iframe container
  const closeButton = document.createElement('button');
  closeButton.innerHTML = '✕';
  closeButton.style.cssText = `
    position: absolute;
    top: 5px;
    right: 5px;
    background: #ff4757;
    color: white;
    border: none;
    border-radius: 50%;
    width: 25px;
    height: 25px;
    cursor: pointer;
    z-index: 2147483648;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeButton.addEventListener('click', () => {
    removeChatPopup();
  });

  // Add the iframe and close button to the shadow DOM
  shadow.appendChild(iframe);
  shadow.appendChild(closeButton);

  // Add resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    bottom: 0;
    right: 0;
    width: 15px;
    height: 15px;
    background: transparent;
    cursor: se-resize;
    z-index: 2147483648;
  `;
  resizeHandle.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M10 15L15 15L15 10" stroke="#ccc" stroke-width="1"/>
      <path d="M5 15L10 15L10 10" stroke="#ccc" stroke-width="1"/>
      <path d="M0 15L5 15L5 10" stroke="#ccc" stroke-width="1"/>
    </svg>
  `;

  // Add resize functionality
  let isResizing = false;
  let initialX: number, initialY: number;
  let initialWidth: number, initialHeight: number;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    isResizing = true;
    initialX = e.clientX;
    initialY = e.clientY;
    initialWidth = parseInt(document.defaultView!.getComputedStyle(iframe).width, 10);
    initialHeight = parseInt(document.defaultView!.getComputedStyle(iframe).height, 10);

    document.addEventListener('mousemove', resizeIframe);
    document.addEventListener('mouseup', stopResize);
  });

  function resizeIframe(e: MouseEvent) {
    if (!isResizing) return;

    const width = initialWidth + (e.clientX - initialX);
    const height = initialHeight + (e.clientY - initialY);

    // Set minimum size
    iframe.style.width = Math.max(300, width) + 'px';
    iframe.style.height = Math.max(200, height) + 'px';
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', resizeIframe);
    document.removeEventListener('mouseup', stopResize);
  }

  shadow.appendChild(resizeHandle);

  // Add drag functionality
  let isDragging = false;
  let currentX: number, currentY: number;
  let initialXDrag: number, initialYDrag: number;
  let xOffset = 0;
  let yOffset = 0;

  // Use mousedown on the iframe to start dragging
  iframe.addEventListener('mousedown', (e) => {
    // Only start dragging if not clicking on resize handle or close button
    if (!(e.target as HTMLElement).classList.contains('resize-handle') &&
        !(e.target as HTMLElement).classList.contains('close-button')) {
      isDragging = true;
      initialXDrag = e.clientX - xOffset;
      initialYDrag = e.clientY - yOffset;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialXDrag;
      currentY = e.clientY - initialYDrag;

      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, iframe);
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  function setTranslate(xPos: number, yPos: number, el: HTMLElement) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }
}

// Function to remove the chat popup
function removeChatPopup() {
  const container = document.getElementById('prism-chat-popup-container');
  if (container) {
    container.remove();
  }
}

// Function to toggle the chat popup
function toggleChatPopup() {
  const container = document.getElementById('prism-chat-popup-container');
  if (container) {
    removeChatPopup();
  } else {
    injectChatPopup();
  }
}

// Mouse tracking function to show/hide button based on mouse position
function setupMouseTracking(button: HTMLElement) {
  // Default settings
  let buttonPosition: { top: number; right: number } = { top: 20, right: 20 };
  let sensitivityAreaPercentage: number = 10; // 10% of screen width/height

  // Load settings from storage
  loadButtonSettings().then(settings => {
    if (settings) {
      buttonPosition = settings.position || buttonPosition;
      sensitivityAreaPercentage = settings.sensitivityAreaPercentage || sensitivityAreaPercentage;
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

// Enable floating button
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Reset the button removal flag when we're on a new page
    localStorage.removeItem('prismButtonRemoved');
    buttonRemovedByUser = false;
    injectFloatingButton();
    loadDisplaySettings();
  });
} else {
  // Reset the button removal flag when we're on a new page
  localStorage.removeItem('prismButtonRemoved');
  buttonRemovedByUser = false;
  injectFloatingButton();
  loadDisplaySettings();
  initializeFontScale();
  setupHotkeyListener();
}

// Check if button was previously removed by the user
let buttonRemovedByUser = localStorage.getItem('prismButtonRemoved') === 'true';

// Initialize prompt shortcuts in chrome.storage.local when content script loads
async function initializePromptShortcuts() {
  try {
    // Get all prompt shortcuts from storage and sync them to chrome.storage.local
    // This is needed for the keyboard shortcut detection in the content script
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      // We'll sync from the extension's main storage when the popup sends us the updated list
      // For now, we rely on the popup to sync the prompt shortcuts to chrome.storage.local
    }
  } catch (error) {
    console.error('Error initializing prompt shortcuts:', error);
  }
}

// Call initialization function
initializePromptShortcuts();

const observer = new MutationObserver((mutationsList) => {
  if (!document.getElementById('prism-floating-button') && !buttonRemovedByUser) {
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
  document.addEventListener('keydown', async (event) => {
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

    // Check if the target is an input field (input, textarea, or contenteditable)
    const target = event.target as HTMLElement;
    const isInputElement = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const isContentEditable = target.isContentEditable;

    // Only handle mode toggles and other shortcuts if not in an input field or contenteditable element
    if (!isInputElement && !isContentEditable) {
      // Check for + or - keys (with or without Shift for +) for font size adjustment
      if (event.key === '+' || event.key === '=' || event.key === 'Add') {
        event.preventDefault();
        increaseFontSize();
      } else if (event.key === '-' || event.key === 'Subtract') {
        event.preventDefault();
        decreaseFontSize();
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
              value: true
            });
            showToast('Text selection mode enabled');
          } else if (event.key === pageContextKey) {
            event.preventDefault();
            // Toggle page context mode
            chrome.runtime.sendMessage({
              type: 'TOGGLE_MODE',
              mode: 'pageContext',
              value: true
            });
            showToast('Page context mode enabled');
          } else if (event.key === pageScreenshotKey) {
            event.preventDefault();
            // Toggle page screenshot mode
            chrome.runtime.sendMessage({
              type: 'TOGGLE_MODE',
              mode: 'pageScreenshot',
              value: true
            });
            showToast('Page screenshot mode enabled');
          } else if (event.key === clipboardKey) {
            event.preventDefault();
            // Toggle clipboard mode
            chrome.runtime.sendMessage({
              type: 'TOGGLE_MODE',
              mode: 'clipboard',
              value: true
            });
            showToast('Clipboard mode enabled');
          } else if (event.key === pageInfoKey) {
            event.preventDefault();
            // Toggle page info mode
            chrome.runtime.sendMessage({
              type: 'TOGGLE_MODE',
              mode: 'pageInfo',
              value: true
            });
            showToast('Page info mode enabled');
          }
        } catch (error) {
          console.error('Error checking mode toggle keys:', error);
        }
      }

      // Check for registered keyboard shortcuts for prompt shortcuts
      // Only do this if not in an input field or contenteditable element
      // (already checked at the beginning of the function)
      // Get all registered prompt shortcuts from storage
      try {
        const result = await chrome.storage.local.get(['promptShortcuts']);
        const promptShortcuts = result.promptShortcuts || [];

        // Check if any prompt shortcut matches the current key combination
        for (const prompt of promptShortcuts) {
          if (prompt.keyboardShortcut) {
            // Parse the keyboard shortcut (e.g., "Ctrl+Shift+F")
            const keys = prompt.keyboardShortcut.split('+');
            let matches = true;

            // Check modifier keys
            if (keys.includes('Ctrl') && !event.ctrlKey) matches = false;
            if (keys.includes('Cmd') && !event.metaKey) matches = false;  // For Mac
            if (keys.includes('Alt') && !event.altKey) matches = false;
            if (keys.includes('Shift') && !event.shiftKey) matches = false;

            // Check the actual key
            const actualKey = keys[keys.length - 1].toLowerCase();
            if (event.key.toLowerCase() !== actualKey) matches = false;

            if (matches) {
              event.preventDefault();

              // Send a message to the popup to insert the prompt content
              chrome.runtime.sendMessage({
                type: 'INSERT_PROMPT_SHORTCUT',
                content: prompt.content
              });

              break; // Stop checking other shortcuts once one is found
            }
          }
        }
      } catch (error) {
        console.error('Error checking keyboard shortcuts:', error);
      }
    }
  });
}

// Function to show toast notifications
function showToast(message: string) {
  // Remove any existing toasts
  const existingToast = document.getElementById('prism-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.id = 'prism-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    z-index: 2147483647;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: prismToastSlideIn 0.3s ease-out;
  `;

  // Add CSS animation
  if (!document.getElementById('prism-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'prism-toast-styles';
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
    `;
    document.head.appendChild(style);
  }

  // Add toast to the page
  document.body.appendChild(toast);

  // Remove toast after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 3000);
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