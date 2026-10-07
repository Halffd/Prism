import type { DebateResult } from '@prism/shared-types';
import './SillyTavernComponents.scss';

interface DebatePanelProps {
  result: DebateResult;
  inProgress: boolean;
  onClose: () => void;
}

export function DebatePanel({ result, inProgress, onClose }: DebatePanelProps) {
  return (
    <div className="st-debate-panel">
      <div className="st-debate-panel__header">
        <span className="st-debate-panel__title">AI Debate</span>
        <button className="st-debate-panel__close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="st-debate-panel__turns">
        {result.turns.map((turn, i) => (
          <div
            key={i}
            className={`st-debate-panel__turn st-debate-panel__turn--${turn.participant.stance || 'neutral'}`}
          >
            <div className="st-debate-panel__turn-header">
              <span className="st-debate-panel__speaker">
                {turn.participant.label || turn.participant.provider}
                {turn.participant.model ? ` / ${turn.participant.model}` : ''}
              </span>
              {turn.participant.stance && (
                <span
                  className={`st-debate-panel__stance st-debate-panel__stance--${turn.participant.stance}`}
                >
                  {turn.participant.stance}
                </span>
              )}
              {turn.tokensUsed && (
                <span className="st-debate-panel__tokens">
                  {turn.tokensUsed} tokens
                </span>
              )}
              {turn.latencyMs && (
                <span className="st-debate-panel__latency">
                  {(turn.latencyMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {turn.error ? (
              <div className="st-debate-panel__error">{turn.error}</div>
            ) : (
              <div className="st-debate-panel__content">{turn.content}</div>
            )}
          </div>
        ))}
        {inProgress && (
          <div className="st-debate-panel__progress">Debating...</div>
        )}
      </div>
      {result.summary && (
        <div className="st-debate-panel__summary">
          <div className="st-debate-panel__summary-title">Summary</div>
          <div className="st-debate-panel__summary-content">
            {result.summary}
          </div>
        </div>
      )}
      <div className="st-debate-panel__footer">
        <span className="st-debate-panel__stats">
          {result.turns.filter((t) => !t.error).length}/{result.turns.length}{' '}
          turns
          {result.totalTokensUsed ? ` · ${result.totalTokensUsed} tokens` : ''}
          {result.latencyMs
            ? ` · ${(result.latencyMs / 1000).toFixed(1)}s`
            : ''}
        </span>
      </div>
    </div>
  );
}
