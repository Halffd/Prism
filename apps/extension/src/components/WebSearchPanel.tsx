
import type { WebSearchResultItem, DeepSearchPhase } from '@prism/shared-types';

interface WebSearchPanelProps {
  results: WebSearchResultItem[];
  deepSearchPhases: DeepSearchPhase[];
  deepSearchInProgress: boolean;
  onClose: () => void;
}

export function WebSearchPanel({ results, deepSearchPhases, deepSearchInProgress, onClose }: WebSearchPanelProps) {
  return (
    <div className="web-search-panel">
      <div className="web-search-panel-header">
        <h3>{deepSearchInProgress ? 'Deep Search' : 'Web Search Results'}</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="web-search-panel-content">
        {deepSearchInProgress && deepSearchPhases.length > 0 && (
          <div className="deepsearch-progress">
            {deepSearchPhases.map((phase, i) => (
              <div key={i} className={`deepsearch-phase deepsearch-phase-${phase.type}`}>
                <span className="phase-icon">
                  {phase.type === 'query' ? '🔍' :
                   phase.type === 'search' ? '🔎' :
                   phase.type === 'extract' ? '📄' :
                   phase.type === 'validate' ? '🧩' :
                   phase.type === 'synthesize' ? '✨' : '⏳'}
                </span>
                <span className="phase-label">
                  {phase.type.replace(/_/g, ' ')}
                  {phase.query ? `: ${phase.query}` : ''}
                </span>
                {phase.error && <span className="phase-error">⚠ {phase.error}</span>}
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && !deepSearchInProgress && (
          <div className="no-results">No search results yet</div>
        )}
        {results.map((item, i) => (
          <div key={i} className="search-result-item">
            <div className="search-result-header">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="search-result-title">
                {item.title || item.url}
              </a>
              {item.score !== undefined && (
                <span className="search-result-score">{(item.score * 100).toFixed(0)}%</span>
              )}
            </div>
            <span className="search-result-domain">{item.domain}</span>
            {item.snippet && (
              <p className="search-result-snippet">{item.snippet}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
