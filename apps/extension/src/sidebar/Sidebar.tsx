import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from '../popup/Popup';

// Create sidebar styles
const createSidebarStyles = () => {
  const style = document.createElement('style');
  style.id = 'prism-sidebar-styles';
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
      --spacing-xs: 4px;
      --spacing-sm: 8px;
      --spacing-md: 12px;
      --spacing-lg: 16px;
      --spacing-xl: 20px;
      --spacing-2xl: 24px;
      --spacing-3xl: 32px;

      /* Border Radius */
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;

      /* Font Sizes */
      --font-xs: 12px;
      --font-sm: 14px;
      --font-md: 16px;
      --font-lg: 18px;
      --font-xl: 20px;
      --font-2xl: 24px;
    }

    #prism-sidebar {
      position: fixed;
      top: 0;
      height: 100vh;
      z-index: 999998;
      background: var(--bg-primary);
      box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
      color: var(--text-primary);
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
      padding: var(--spacing-lg);
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sidebar-header h2 {
      margin: 0;
      font-size: var(--font-lg);
      color: var(--text-primary);
    }

    .sidebar-close-btn {
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: var(--font-xl);
      cursor: pointer;
      padding: var(--spacing-xs);
      border-radius: var(--radius-md);
    }

    .sidebar-close-btn:hover {
      background: var(--bg-tertiary);
    }

    .sidebar-content {
      flex: 1;
      overflow: hidden;
    }
  `;
  document.head.appendChild(style);
};

// Create sidebar container
const createSidebar = (position: 'left' | 'right', width: number) => {
  // Remove any existing sidebar
  const existingSidebar = document.getElementById('prism-sidebar');
  if (existingSidebar) {
    existingSidebar.remove();
  }
  
  // Create the container
  const sidebar = document.createElement('div');
  sidebar.id = 'prism-sidebar';
  sidebar.className = position;
  sidebar.style.width = `${width}px`;
  
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  header.innerHTML = `
    <h2>💎 Prism Assistant</h2>
    <button class="sidebar-close-btn" id="prism-sidebar-close">✕</button>
  `;
  
  const content = document.createElement('div');
  content.className = 'sidebar-content';
  content.id = 'prism-sidebar-content';
  
  sidebar.appendChild(header);
  sidebar.appendChild(content);
  
  // Add close button functionality
  const closeBtn = document.getElementById('prism-sidebar-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('active');
      setTimeout(() => {
        sidebar.remove();
      }, 300); // Match the transition time
    });
  }
  
  document.body.appendChild(sidebar);
  
  // Add active class after a short delay to trigger the animation
  setTimeout(() => {
    sidebar.classList.add('active');
  }, 10);
  
  return sidebar;
};

// Inject sidebar React component
export const injectSidebar = async (position: 'left' | 'right' = 'right', width: number = 350) => {
  // Create styles if not exist
  if (!document.getElementById('prism-sidebar-styles')) {
    createSidebarStyles();
  }
  
  // Create the sidebar container
  const sidebar = createSidebar(position, width);
  
  // Render the Popup component inside the sidebar
  const container = document.getElementById('prism-sidebar-content');
  if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(<Popup />);
  }
};