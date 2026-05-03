import React from 'react';

interface IframeInjectionSectionProps {
  iframeUrl: string;
  setIframeUrl: (value: string) => void;
  injectIframe: () => void;
  isIframeInjected: boolean;
  removeIframe: () => void;
  iframeError: string | null;
}

export const IframeInjectionSection: React.FC<IframeInjectionSectionProps> = ({
  iframeUrl,
  setIframeUrl,
  injectIframe,
  isIframeInjected,
  removeIframe,
  iframeError
}) => {
  return (
    <div className="iframe-injection-section">
      <div className="iframe-controls">
        <input
          type="text"
          value={iframeUrl}
          onChange={(e) => setIframeUrl(e.target.value)}
          placeholder="Enter URL to inject into iframe..."
          className="iframe-url-input"
        />
        <button
          onClick={injectIframe}
          disabled={!iframeUrl.trim() || isIframeInjected}
          className="inject-iframe-btn"
        >
          {isIframeInjected ? 'Injected ✓' : 'Inject Iframe'}
        </button>
        {isIframeInjected && (
          <button
            onClick={removeIframe}
            className="remove-iframe-btn"
          >
            Remove Iframe
          </button>
        )}
      </div>
      {iframeError && (
        <div className="iframe-error">
          Error: {iframeError}
        </div>
      )}
    </div>
  );
};