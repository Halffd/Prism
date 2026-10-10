import {
  createIframe,
  createIframeContainer,
  attachShadowToElement,
  removeIframe,
} from '../content/iframe-manager';

jest.mock('../popup/Popup', () => ({
  Popup: () => null,
}));

describe('Chat Popup Iframe Injection', () => {
  beforeEach(() => {
    (global as any).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        sendMessage: jest.fn(),
      },
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
        sendMessage: jest.fn().mockResolvedValue({}),
      },
    };
  });

  afterEach(() => {
    removeIframe('prism-chat-popup-container');
    document.getElementById('prism-iframe-styles')?.remove();
    document.body.innerHTML = '';
    delete (global as any).chrome;
  });

  test('creates an iframe inside a shadow root on the container', () => {
    const container = createIframeContainer('prism-chat-popup-container');
    document.body.appendChild(container);

    const shadow = attachShadowToElement(container);
    const iframe = createIframe({
      src: 'chrome-extension://test-extension/chat.html',
      id: 'prism-chat-iframe',
      style: 'width: 400px; height: 600px;',
    });
    shadow.appendChild(iframe);

    const mounted = document.getElementById('prism-chat-popup-container');
    expect(mounted).toBeTruthy();
    expect(mounted?.shadowRoot).toBeTruthy();
    expect(mounted?.shadowRoot?.querySelector('iframe')).toBeTruthy();
    expect(mounted?.shadowRoot?.querySelector('iframe')?.id).toBe(
      'prism-chat-iframe',
    );
  });

  test('does not create a second container with the same id', () => {
    const first = createIframeContainer('prism-chat-popup-container');
    document.body.appendChild(first);

    const shouldCreateNew = !document.getElementById(
      'prism-chat-popup-container',
    );
    expect(shouldCreateNew).toBe(false);
    expect(
      document.querySelectorAll('#prism-chat-popup-container'),
    ).toHaveLength(1);
  });

  test('removes the container', () => {
    const container = createIframeContainer('prism-chat-popup-container');
    document.body.appendChild(container);

    removeIframe('prism-chat-popup-container');

    expect(document.getElementById('prism-chat-popup-container')).toBeNull();
  });

  describe('injectIframePopup', () => {
    // injectIframePopup awaits chrome.storage before appending the container.
    const inject = async () => {
      const { injectIframePopup } = await import('../iframe/IframePopup');
      await injectIframePopup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    test('injects a resizable and draggable container', async () => {
      await inject();

      const container = document.getElementById('prism-iframe-container');
      expect(container).toBeTruthy();
      expect(container?.querySelector('.iframe-header')).toBeTruthy();
      expect(container?.querySelector('#prism-iframe-resizer')).toBeTruthy();

      container?.classList.add('show');
      expect(container?.classList.contains('show')).toBe(true);
    });

    test('resizes the container when the resizer is dragged', async () => {
      await inject();

      const container = document.getElementById(
        'prism-iframe-container',
      ) as HTMLElement;
      const resizer = container.querySelector(
        '#prism-iframe-resizer',
      ) as HTMLElement;

      // jsdom reports zero for offsetWidth/Height, so the drag has to exceed
      // the 300x200 minimum for the size to change.
      resizer.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 0,
          clientY: 0,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 400,
          clientY: 300,
        }),
      );

      expect(parseInt(container.style.width, 10)).toBe(400);
      expect(parseInt(container.style.height, 10)).toBe(300);

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // stopResize persists the measured container size; jsdom reports 0 for
      // offsetWidth/offsetHeight, so only the persisted key is assertable here.
      const setMock = (global as any).chrome.storage.local.set as jest.Mock;
      expect(setMock).toHaveBeenCalledWith({
        iframeSize: expect.objectContaining({ width: expect.any(Number) }),
      });
    });

    test('moves the container when the header is dragged', async () => {
      await inject();

      const container = document.getElementById(
        'prism-iframe-container',
      ) as HTMLElement;
      const header = container.querySelector('.iframe-header') as HTMLElement;

      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 60,
          clientY: 40,
        }),
      );

      expect(container.style.transform).toBe('translate3d(50px, 30px, 0)');
    });
  });
});
