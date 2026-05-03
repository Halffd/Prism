// iframe-manager.ts - Module for managing iframe creation and manipulation

// Interface for iframe options
interface IframeOptions {
  src: string;
  id: string;
  style: string;
  containerId?: string;
}

// Create a new iframe with specified options
export function createIframe(options: IframeOptions): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = options.src;
  iframe.id = options.id;
  iframe.style.cssText = options.style;
  return iframe;
}

// Create a container element for the iframe
export function createIframeContainer(containerId: string, additionalStyles: string = ''): HTMLElement {
  const container = document.createElement('div');
  container.id = containerId;
  if (additionalStyles) {
    container.style.cssText = additionalStyles;
  }
  return container;
}

// Create shadow DOM for an element
export function attachShadowToElement(element: HTMLElement): ShadowRoot {
  return element.attachShadow({ mode: 'open' });
}

// Create button element with specified properties
export function createButton(text: string, title: string, style: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.innerHTML = text;
  button.title = title;
  button.style.cssText = style;
  button.addEventListener('click', onClick);
  return button;
}

// Remove iframe and its container
export function removeIframe(containerId: string): void {
  const container = document.getElementById(containerId);
  if (container) {
    container.remove();
  }
}