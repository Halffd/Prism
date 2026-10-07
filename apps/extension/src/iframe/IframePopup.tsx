import ReactDOM from 'react-dom/client';
import { Popup } from '../popup/Popup';

const createIframeStyles = () => {
  const style = document.createElement('style');
  style.id = 'prism-iframe-styles';
  style.textContent = `
  #prism-iframe-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999998;
    background: var(--surface, #141218);
    border: none;
    width: 400px;
    height: 600px;
    box-shadow: 0 0 30px rgba(15, 13, 19, 0.4);
    border-radius: var(--radius-xl, 16px);
    overflow: hidden;
    min-width: 300px;
    min-height: 200px;
    color: var(--on-surface, #E7E0E9);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s ease;
  }

  #prism-iframe-container.show {
    transform: translateY(0);
    opacity: 1;
  }

  .iframe-header {
    padding: var(--spacing-md, 12px) var(--spacing-lg, 16px);
    background: var(--surface-container-low, #1D1A21);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: none;
  }

  .iframe-header h2 {
    margin: 0;
    font-size: var(--font-lg, 18px);
    color: var(--on-surface, #E7E0E9);
    font-weight: 600;
  }

  .iframe-close-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant, #CBC4CF);
    font-size: var(--font-xl, 20px);
    cursor: pointer;
    padding: var(--spacing-xs, 4px);
    border-radius: var(--radius-pill, 9999px);
  }

  .iframe-close-btn:hover {
    color: var(--on-surface, #E7E0E9);
    background: var(--surface-container-high, #2B292F);
  }

  .iframe-content {
    height: calc(100% - 50px);
    overflow: hidden;
  }

  #prism-iframe-resizer {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    background: var(--surface-container-low, #1D1A21);
    cursor: se-resize;
    border-left: none;
    border-top: none;
    border-radius: 0 0 0 var(--radius-sm, 4px);
    z-index: 10;
  }

  #prism-iframe-resizer > div {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--on-surface-variant, #CBC4CF);
    border-bottom: 2px solid var(--on-surface-variant, #CBC4CF);
    transform: rotate(45deg);
  }`;
  document.head.appendChild(style);
};

const createIframeContainer = async () => {
  const existingContainer = document.getElementById('prism-iframe-container');
  if (existingContainer) {
    existingContainer.remove();
  }

  let savedPosition = { x: 20, y: 20 };
  let savedSize = { width: 400, height: 600 };

  try {
    const result = await chrome.storage.local.get([
      'iframePosition',
      'iframeSize',
    ]);
    if (result.iframePosition) savedPosition = result.iframePosition;
    if (result.iframeSize) savedSize = result.iframeSize;
  } catch (error) {
    console.warn(
      'Could not load saved iframe position/size, using defaults:',
      error,
    );
  }

  const container = document.createElement('div');
  container.id = 'prism-iframe-container';

  container.style.cssText += `
    bottom: ${savedPosition.y}px;
    right: ${savedPosition.x}px;
    width: ${savedSize.width}px;
    height: ${savedSize.height}px;
  `;

  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <h2>Prism Assistant</h2>
    <button class="iframe-close-btn" id="prism-iframe-close">✕</button>
  `;

  const content = document.createElement('div');
  content.className = 'iframe-content';
  content.id = 'prism-iframe-content';

  container.appendChild(header);
  container.appendChild(content);

  const closeBtn = document.getElementById('prism-iframe-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      container.classList.remove('show');
      setTimeout(() => {
        container.remove();
      }, 300);
    });
  }

  let isDragging = false;
  let currentX: number;
  let currentY: number;
  let initialX: number;
  let initialY: number;
  let xOffset = 0;
  let yOffset = 0;

  const headerElement = container.querySelector(
    '.iframe-header',
  ) as HTMLElement;
  if (headerElement) {
    headerElement.addEventListener('mousedown', dragStart);
  }

  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('mousemove', drag);

  function dragStart(e: MouseEvent) {
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

    if (container.style.bottom && container.style.right) {
      const rect = container.getBoundingClientRect();
      const position = {
        x: window.innerWidth - rect.right,
        y: window.innerHeight - rect.bottom,
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

  let isResizing = false;
  let initialWidth: number,
    initialHeight: number,
    initialMouseX: number,
    initialMouseY: number;

  const resizer = document.createElement('div');
  resizer.id = 'prism-iframe-resizer';
  resizer.innerHTML = '<div></div>';

  container.appendChild(resizer);

  resizer.addEventListener('mousedown', function (e: MouseEvent) {
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

    container.style.width = Math.max(300, width) + 'px';
    container.style.height = Math.max(200, height) + 'px';
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);

    const size = {
      width: container.offsetWidth,
      height: container.offsetHeight,
    };
    chrome.storage.local.set({ iframeSize: size });
  }

  document.body.appendChild(container);

  setTimeout(() => {
    container.classList.add('show');
  }, 10);

  return container;
};

export const injectIframePopup = async () => {
  if (!document.getElementById('prism-iframe-styles')) {
    createIframeStyles();
  }

  createIframeContainer();

  const content = document.getElementById('prism-iframe-content');
  if (content) {
    const root = ReactDOM.createRoot(content);
    root.render(<Popup />);
  }
};
