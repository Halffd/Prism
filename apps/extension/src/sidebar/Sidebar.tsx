import ReactDOM from 'react-dom/client';
import { Popup } from '../popup/Popup';

const createSidebarStyles = () => {
  const style = document.createElement('style');
  style.id = 'prism-sidebar-styles';
  style.textContent = `
  #prism-sidebar {
    position: fixed;
    top: 0;
    height: 100vh;
    z-index: 999998;
    background: var(--surface, #141218);
    box-shadow: 0 0 30px rgba(15, 13, 19, 0.4);
    overflow: hidden;
    transition: transform 0.3s ease;
    display: flex;
    flex-direction: column;
    color: var(--on-surface, #E7E0E9);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  #prism-sidebar.left {
    left: 0;
    transform: translateX(-100%);
  }

  #prism-sidebar.left.active {
    transform: translateX(0);
  }

  #prism-sidebar.right {
    right: 0;
    transform: translateX(100%);
  }

  #prism-sidebar.right.active {
    transform: translateX(0);
  }

  .sidebar-header {
    padding: var(--spacing-lg, 16px);
    background: var(--surface-container-low, #1D1A21);
    border-bottom: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: var(--font-lg, 18px);
    color: var(--on-surface, #E7E0E9);
    font-weight: 600;
  }

  .sidebar-close-btn {
    background: none;
    border: none;
    color: var(--on-surface-variant, #CBC4CF);
    font-size: var(--font-xl, 20px);
    cursor: pointer;
    padding: var(--spacing-xs, 4px);
    border-radius: var(--radius-pill, 9999px);
  }

  .sidebar-close-btn:hover {
    color: var(--on-surface, #E7E0E9);
    background: var(--surface-container-high, #2B292F);
  }

  .sidebar-content {
    flex: 1;
    overflow: hidden;
  }`;
  document.head.appendChild(style);
};

const createSidebar = (position: 'left' | 'right', width: number) => {
  const existingSidebar = document.getElementById('prism-sidebar');
  if (existingSidebar) {
    existingSidebar.remove();
  }

  const sidebar = document.createElement('div');
  sidebar.id = 'prism-sidebar';
  sidebar.className = position;
  sidebar.style.width = `${width}px`;

  const header = document.createElement('div');
  header.className = 'sidebar-header';
  header.innerHTML = `
    <h2>Prism Assistant</h2>
    <button class="sidebar-close-btn" id="prism-sidebar-close">✕</button>
  `;

  const content = document.createElement('div');
  content.className = 'sidebar-content';
  content.id = 'prism-sidebar-content';

  sidebar.appendChild(header);
  sidebar.appendChild(content);

  const closeBtn = document.getElementById('prism-sidebar-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('active');
      setTimeout(() => {
        sidebar.remove();
      }, 300);
    });
  }

  document.body.appendChild(sidebar);

  setTimeout(() => {
    sidebar.classList.add('active');
  }, 10);

  return sidebar;
};

export const injectSidebar = async (
  position: 'left' | 'right' = 'right',
  width: number = 350,
) => {
  if (!document.getElementById('prism-sidebar-styles')) {
    createSidebarStyles();
  }

  createSidebar(position, width);

  const container = document.getElementById('prism-sidebar-content');
  if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(<Popup />);
  }
};
