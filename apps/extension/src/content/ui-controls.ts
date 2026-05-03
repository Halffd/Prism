// ui-controls.ts - Module for creating and managing UI controls

// Create a toast notification
export function showToast(message: string): void {
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

  // Add CSS animation if not already added
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

// Create a floating button
export function createFloatingButton(buttonId: string, content: string, onClick: () => void, additionalStyles: string = ''): HTMLElement {
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