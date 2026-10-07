
import type { CouncilResponse } from '@prism/shared-types';
import './SillyTavernComponents.scss';

interface CouncilPanelProps {
  response: CouncilResponse | null;
  inProgress: boolean;
  onClose: () => void;
}

export function CouncilPanel({ response, inProgress, onClose }: CouncilPanelProps) {
  if (!response && !inProgress) return null;

  return (
    <div className="st-council-panel">
      <div className="st-council-header">
        <span className="st-council-title">AI Council</span>
        <button className="st-council-close" onClick={onClose}>x</button>
      </div>

      {inProgress && (
        <div className="st-council-loading">
          Council members deliberating...
        </div>
      )}

      {response && (
        <div className="st-council-results">
          <div className="st-council-verdict">
            <span className="st-council-verdict-label">Verdict</span>
            <span className="st-council-winner">
              {response.verdict.winnerProvider}{response.verdict.winnerModel ? `/${response.verdict.winnerModel}` : ''}
            </span>
            <span className="st-council-strategy">({response.verdict.strategy})</span>
          </div>
          <div className="st-council-reasoning">{response.verdict.reasoning}</div>

          <div className="st-council-members">
            {response.responses.map((r, i) => (
              <div key={i} className={`st-council-member ${r.error ? 'failed' : ''}`}>
                <div className="st-council-member-header">
                  <span className="st-council-member-name">{r.label || r.provider}</span>
                  {r.tokensUsed && <span className="st-council-member-tokens">{r.tokensUsed} tokens</span>}
                  {r.latencyMs && <span className="st-council-member-latency">{r.latencyMs}ms</span>}
                  {r.error && <span className="st-council-member-error">failed</span>}
                </div>
                {!r.error && <div className="st-council-member-content">{r.content.substring(0, 300)}{r.content.length > 300 ? '...' : ''}</div>}
              </div>
            ))}
          </div>

          {response.verdict.votes.length > 0 && (
            <div className="st-council-votes">
              <span className="st-council-votes-label">Votes</span>
              {response.verdict.votes.map((vote, i) => (
                <div key={i} className="st-council-vote">
                  <span className="st-council-voter">{vote.voterProvider}</span>
                  <span className="st-council-vote-reason">{vote.reasoning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
