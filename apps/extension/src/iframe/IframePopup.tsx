import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from '../popup/Popup';

// Create iframe popup styles
const createIframeStyles = () => {
  const style = document.createElement('style');
  style.id = 'prism-iframe-styles';
  style.textContent = `
    :root {
      /* Dark Theme Colors */
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --bg-card: #1e293b;
      --bg-input: #0f172a;
      --bg-hover: #334155;
      --bg-active: #475569;
      --bg-overlay: rgba(15, 23, 42, 0.85);

      /* Text Colors */
      --text-primary: #e6e9f0;
      --text-secondary: #cbd5e0;
      --text-muted: #94a3b8;
      --text-accent: #8b5cf6;

      /* Border Colors */
      --border-primary: #334155;
      --border-secondary: #475569;

      /* Button Colors */
      --btn-primary-bg: #8b5cf6;
      --btn-primary-hover: #7c3aed;
      --btn-secondary-bg: #3b82f6;
      --btn-secondary-hover: #2563eb;
      --btn-danger-bg: #ef4444;
      --btn-danger-hover: #dc2626;
      --btn-success-bg: #10b981;
      --btn-success-hover: #059669;

      /* Gradient Colors */
      --gradient-primary: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
      --gradient-secondary: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);

      /* Accent Colors */
      --accent-purple: #8b5cf6;
      --accent-blue: #3b82f6;
      --accent-green: #10b981;
      --accent-yellow: #f59e0b;
      --accent-red: #ef4444;

      /* Shadow */
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.3);
      --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.3);
      --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.4);

      /* Spacing */
      --spacing-xs: calc(4px * var(--font-scale, 1));
      --spacing-sm: calc(8px * var(--font-scale, 1));
      --spacing-md: calc(12px * var(--font-scale, 1));
      --spacing-lg: calc(16px * var(--font-scale, 1));
      --spacing-xl: calc(20px * var(--font-scale, 1));
      --spacing-2xl: calc(24px * var(--font-scale, 1));
      --spacing-3xl: calc(32px * var(--font-scale, 1));

      /* Border Radius */
      --radius-sm: calc(4px * var(--font-scale, 1));
      --radius-md: calc(8px * var(--font-scale, 1));
      --radius-lg: calc(12px * var(--font-scale, 1));
      --radius-xl: calc(16px * var(--font-scale, 1));

      /* Font Sizes */
      --font-xs: calc(12px * var(--font-scale, 1));
      --font-sm: calc(14px * var(--font-scale, 1));
      --font-md: calc(16px * var(--font-scale, 1));
      --font-lg: calc(18px * var(--font-scale, 1));
      --font-xl: calc(20px * var(--font-scale, 1));
      --font-2xl: calc(24px * var(--font-scale, 1));
    }

    #prism-iframe-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999998;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      width: 400px;
      height: 600px;
      box-shadow: var(--shadow-xl);
      border-radius: var(--radius-xl);
      overflow: hidden;
      min-width: 300px;
      min-height: 200px;
    }

    .iframe-header {
      padding: var(--spacing-md) var(--spacing-lg);
      background: var(--bg-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-primary);
    }

    .iframe-header h2 {
      margin: 0;
      font-size: var(--font-lg);
      color: var(--text-primary);
    }

    .iframe-close-btn {
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: var(--font-xl);
      cursor: pointer;
      padding: var(--spacing-xs);
      border-radius: var(--radius-md);
    }

    .iframe-close-btn:hover {
      background: var(--bg-tertiary);
    }

    .iframe-content {
      height: calc(100% - 50px); /* Subtract header height */
      overflow: hidden;
    }

    /* Animation for entry */
    #prism-iframe-container {
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.3s ease;
    }

    #prism-iframe-container.show {
      transform: translateY(0);
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
};

// Create iframe container
const createIframeContainer = async () => {
  // Remove any existing iframe container
  const existingContainer = document.getElementById('prism-iframe-container');
  if (existingContainer) {
    existingContainer.remove();
  }

  // Get saved position and size from storage, default to preferred values
  let savedPosition = { x: 20, y: 20 }; // 20px from bottom/right
  let savedSize = { width: 400, height: 600 };

  try {
    const result = await chrome.storage.local.get(['iframePosition', 'iframeSize']);
    if (result.iframePosition) savedPosition = result.iframePosition;
    if (result.iframeSize) savedSize = result.iframeSize;
  } catch (error) {
    console.warn('Could not load saved iframe position/size, using defaults:', error);
  }

  const container = document.createElement('div');
  container.id = 'prism-iframe-container';

  // Apply saved position and size
  container.style.cssText += `
    bottom: ${savedPosition.y}px;
    right: ${savedPosition.x}px;
    width: ${savedSize.width}px;
    height: ${savedSize.height}px;
  `;

  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <h2>💎 Prism Assistant</h2>
    <button class="iframe-close-btn" id="prism-iframe-close">✕</button>
  `;

  const content = document.createElement('div');
  content.className = 'iframe-content';
  content.id = 'prism-iframe-content';

  container.appendChild(header);
  container.appendChild(content);

  // Add close button functionality
  const closeBtn = document.getElementById('prism-iframe-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      container.classList.remove('show');
      setTimeout(() => {
        container.remove();
      }, 300);
    });
  }

  // Add drag functionality to the header
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const headerElement = container.querySelector('.iframe-header') as HTMLElement;
  if (headerElement) {
    headerElement.addEventListener("mousedown", dragStart);
  }

  document.addEventListener("mouseup", dragEnd);
  document.addEventListener("mousemove", drag);

  function dragStart(e: MouseEvent) {
    // Only drag if not clicking on close button
    if (e.target !== closeBtn) {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;

      isDragging = true;
    }
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;

    isDragging = false;

    // Save current position
    if (container.style.bottom && container.style.right) {
      const rect = container.getBoundingClientRect();
      const position = {
        x: window.innerWidth - (rect.right),
        y: window.innerHeight - (rect.bottom)
      };
      chrome.storage.local.set({ iframePosition: position });
    }
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

  // Add resize functionality
  let isResizing = false;
  let initialWidth: number, initialHeight: number, initialMouseX: number, initialMouseY: number;

  // Create the resizer element
  const resizer = document.createElement('div');
  resizer.id = 'prism-iframe-resizer';
  resizer.style.cssText = `
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    background: var(--bg-secondary, #334155);
    cursor: se-resize;
    border-left: 1px solid var(--border-primary, #475569);
    border-top: 1px solid var(--border-primary, #475569);
    border-radius: 0 0 0 4px;
    z-index: 10;
  `;
  resizer.innerHTML = `
    <div style="
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--text-secondary, #94a3b8);
      border-bottom: 2px solid var(--text-secondary, #94a3b8);
      transform: rotate(45deg);
    "></div>
  `;

  container.appendChild(resizer);

  resizer.addEventListener('mousedown', function(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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

    // Save current size
    const size = {
      width: container.offsetWidth,
      height: container.offsetHeight
    };
    chrome.storage.local.set({ iframeSize: size });
  }

  document.body.appendChild(container);

  // Trigger the show animation
  setTimeout(() => {
    container.classList.add('show');
  }, 10);

  return container;
};

// Inject iframe popup React component
export const injectIframePopup = async () => {
  // Create styles if not exist
  if (!document.getElementById('prism-iframe-styles')) {
    createIframeStyles();
  }
  
  // Create the iframe container
  const container = createIframeContainer();
  
  // Render the Popup component inside the iframe
  const content = document.getElementById('prism-iframe-content');
  if (content) {
    const root = ReactDOM.createRoot(content);
    root.render(<Popup />);
  }
};