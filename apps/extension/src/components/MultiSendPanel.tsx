
import type { MultiSendResponse } from '@prism/shared-types';
import './SillyTavernComponents.scss';

interface MultiSendPanelProps {
  response: MultiSendResponse | null;
  inProgress: boolean;
  onClose: () => void;
}

export function MultiSendPanel({ response, inProgress, onClose }: MultiSendPanelProps) {
  if (!response && !inProgress) return null;

  return (
    <div className="st-council-panel st-multisend-panel">
      <div className="st-council-header">
        <span className="st-council-title">Multi-Send</span>
        <button className="st-council-close" onClick={onClose}>x</button>
      </div>

      {inProgress && (
        <div className="st-council-loading">
          Sending to multiple AIs...
        </div>
      )}

      {response && (
        <div className="st-council-results">
          <div className="st-council-verdict">
            <span className="st-council-verdict-label">Responses</span>
            <span className="st-council-winner">
              {response.responses.filter(r => !r.error).length}/{response.responses.length} succeeded
            </span>
            {response.latencyMs && (
              <span className="st-council-strategy">({response.latencyMs}ms)</span>
            )}
          </div>

          <div className="st-council-members">
            {response.responses.map((r, i) => (
              <div key={i} className={`st-council-member ${r.error ? 'failed' : ''}`}>
                <div className="st-council-member-header">
                  <span className="st-council-member-name">{r.label || r.provider}{r.model ? `/${r.model}` : ''}</span>
                  {r.tokensUsed && <span className="st-council-member-tokens">{r.tokensUsed} tokens</span>}
                  {r.latencyMs && <span className="st-council-member-latency">{r.latencyMs}ms</span>}
                  {r.error && <span className="st-council-member-error">failed</span>}
                </div>
                {!r.error && <div className="st-council-member-content">{r.content.substring(0, 300)}{r.content.length > 300 ? '...' : ''}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
