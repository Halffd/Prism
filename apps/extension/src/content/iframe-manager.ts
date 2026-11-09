// iframe-manager.ts - Module for managing iframe creation and manipulation

/**
 * Iframe and shadow-DOM helpers for the in-page chat UI.
 *
 * The approach follows AI Blaze: the extension's UI is mounted inside a
 * shadow root so the host page's CSS cannot reach it, and the host page's
 * CSS cannot leak into it. The shadow root is closed, so a page that
 * reaches into `element.shadowRoot` finds nothing and cannot restyle or
 * tamper with the extension's UI.
 *
 * The container element is fully reset with `all: initial` before the
 * shadow root is attached, because that reset does not cross the shadow
 * boundary — the host element itself is still styled by the page.
 */

// Interface for iframe options
interface IframeOptions {
  src: string;
  id: string;
  style: string;
  containerId?: string;
}

/**
 * The id prefix used for every element the extension injects.
 *
 * The prefix is distinctive enough that it is unlikely to collide with the
 * host page's own ids, which matters because the page and the extension
 * share one document.
 */
const PRISM_ID_PREFIX = 'prism-';

/**
 * Styles applied to the shadow host so the host page cannot influence the
 * extension's layout.
 *
 * `all: initial` resets every inherited and default style, so the
 * container behaves like a plain block regardless of what the page sets.
 */
const SHADOW_HOST_STYLES = `
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
`;

/**
 * True when the page already owns an element with the given id.
 *
 * The extension never reuses an id the page is already using, so a page
 * that happens to define `prism-chat-iframe` keeps its own element.
 */
export function hasElementWithId(id: string): boolean {
  return document.getElementById(id) !== null;
}

/**
 * Returns an id that is not already taken on the page.
 *
 * The requested id is used when it is free; otherwise a numeric suffix is
 * appended until the id is unique.
 */
export function uniqueElementId(preferredId: string): string {
  if (!hasElementWithId(preferredId)) {
    return preferredId;
  }

  let suffix = 1;
  while (hasElementWithId(`${preferredId}-${suffix}`)) {
    suffix += 1;
  }
  return `${preferredId}-${suffix}`;
}

/**
 * Builds the id for an extension-owned element.
 *
 * The `prism-` prefix keeps extension ids distinguishable from the page's
 * own ids.
 */
export function prismElementId(name: string): string {
  return `${PRISM_ID_PREFIX}${name}`;
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

/**
 * Creates the shadow host for the extension's in-page UI.
 *
 * The host is reset with `all: initial` and positioned to cover the
 * viewport without capturing pointer events, so the page stays usable
 * while the extension's UI handles its own events.
 */
export function createShadowHost(containerId: string): HTMLElement {
  const host = document.createElement('div');
  host.id = containerId;
  host.style.cssText = SHADOW_HOST_STYLES;
  return host;
}

/**
 * The shadow roots the extension has mounted, keyed by host element id.
 *
 * A closed shadow root cannot be found through the DOM, so the extension
 * keeps its own registry. The registry is what lets the extension check
 * whether its UI is already on the page, focus the iframe, and clean up —
 * all of which would otherwise be impossible once the root is closed.
 */
const shadowRoots = new Map<string, ShadowRoot>();

/**
 * Returns the shadow root the extension mounted on the given host, if any.
 *
 * The registry entry is only valid while the host element is still in the
 * document, so a host that the page removed is treated as gone and its
 * entry is dropped.
 */
export function getShadowRoot(hostId: string): ShadowRoot | undefined {
  const shadow = shadowRoots.get(hostId);
  if (!shadow) {
    return undefined;
  }

  const host = document.getElementById(hostId);
  if (!host) {
    shadowRoots.delete(hostId);
    return undefined;
  }

  return shadow;
}

/**
 * True when the extension has already mounted its UI on the given host.
 */
export function hasShadowRoot(hostId: string): boolean {
  return getShadowRoot(hostId) !== undefined;
}

/**
 * Forgets a shadow root, so the extension can mount a fresh one.
 *
 * Call this when the host element is removed from the page.
 */
export function forgetShadowRoot(hostId: string): void {
  shadowRoots.delete(hostId);
}

/**
 * Attaches a closed shadow root to the given element.
 *
 * A closed root means `element.shadowRoot` is null from the page's point
 * of view: the page cannot query into the extension's UI, restyle it, or
 * attach its own listeners to it.
 *
 * The root is returned so the extension can populate it, and it is
 * recorded in the extension's registry so the extension can find it again.
 */
export function attachShadowToElement(element: HTMLElement): ShadowRoot {
  const shadow = element.attachShadow({ mode: 'closed' });
  if (element.id) {
    shadowRoots.set(element.id, shadow);
  }
  return shadow;
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
