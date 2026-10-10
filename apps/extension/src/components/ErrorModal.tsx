import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Styles are inlined rather than imported so the modal keeps its appearance
// when rendered inside a shadow root, where extension CSS does not apply.
const ERROR_MODAL_STYLES = `
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .modal-box {
    background-color: #1a1a1a;
    border-radius: 12px;
    width: 90%;
    max-width: 900px;
    padding: 24px;
    position: relative;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .modal-close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: none;
    color: #ccc;
    font-size: 18px;
    cursor: pointer;
  }

  .modal-close-btn:hover {
    color: #fff;
  }

  .modal-warning {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background-color: rgba(255, 193, 7, 0.08);
    border: 1px solid rgba(255, 193, 7, 0.4);
    border-radius: 8px;
    padding: 16px 20px;
  }

  .warning-icon {
    font-size: 20px;
    margin-top: 2px;
  }

  .warning-text {
    flex: 1;
  }

  .warning-title {
    color: #ffc107;
    font-weight: 600;
    font-size: 15px;
    margin: 0 0 4px 0;
  }

  .warning-subtitle {
    color: #d4b969;
    font-size: 14px;
    margin: 0;
  }

  .warning-dismiss {
    background: none;
    border: none;
    color: #ffc107;
    font-size: 16px;
    cursor: pointer;
    margin-top: 2px;
  }

  .warning-dismiss:hover {
    opacity: 0.7;
  }
`;

export interface ErrorModalProps {
  onClose: () => void;
}

export function ErrorModal({ onClose }: ErrorModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-box" role="alert" aria-label="Missing chat history">
        <button
          className="modal-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="modal-warning">
          <span className="warning-icon">⚠️</span>
          <div className="warning-text">
            <p className="warning-title">Missing chat history</p>
            <p className="warning-subtitle">
              We could not load the conversation for this chat
            </p>
          </div>
          <button
            className="warning-dismiss"
            onClick={onClose}
            aria-label="Dismiss warning"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// Mounts ErrorModal into a shadow root so host page styles cannot leak in and
// the modal styles cannot leak out. Works both on extension pages and inside
// content-script shadow roots.
export function ErrorModalHost({ onClose }: ErrorModalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mountPoint, setMountPoint] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const styleTag = document.createElement('style');
    styleTag.textContent = ERROR_MODAL_STYLES;
    shadowRoot.appendChild(styleTag);

    const portalPoint = document.createElement('div');
    shadowRoot.appendChild(portalPoint);

    setMountPoint(portalPoint);
  }, []);

  return (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {mountPoint && createPortal(<ErrorModal onClose={onClose} />, mountPoint)}
    </div>
  );
}

export default ErrorModal;
