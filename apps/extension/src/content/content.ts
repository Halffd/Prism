import type { ContextData } from '@prism/shared-types';

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_CONTEXT') {
    const context = extractPageContext();
    sendResponse(context);
    return true;
  }
});

function extractPageContext(): ContextData {
  // Get selected text
  const selection = window.getSelection();
  const selectedText = selection?.toString() || undefined;

  // Get main content (try to be smart about it)
  const mainContent = getMainContent();

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
    fullText: mainContent.slice(0, 5000), // Limit to 5k chars
    metadata
  };

  return context;
}

function getMainContent(): string {
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

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.textContent?.trim() || '';
    }
  }

  // Fallback to body
  return document.body.textContent?.trim() || '';
}

// Add floating button on page (optional)
function injectFloatingButton() {
  const button = document.createElement('div');
  button.id = 'prism-floating-button';
  button.innerHTML = '💎';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
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
    transition: transform 0.2s;
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

  document.body.appendChild(button);
}

// Uncomment to enable floating button
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}

console.log('Prism content script loaded on:', window.location.href);