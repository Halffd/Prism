import { useMemo } from 'react';
import type { SessionContextItem } from '@prism/shared-types';
import {
  contextBudget,
  enabledContextTokens,
  estimateTokens,
} from './chat-features';

export interface ContextPanelProps {
  items: SessionContextItem[];
  /** The maximum number of tokens the context may use. */
  budget: number;
  onBudgetChange: (budget: number) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * The context panel of a session.
 *
 * It lists what rides along with the prompt (page, selection,
 * documents), shows what each piece costs and trims the list to the
 * token budget by priority.
 */
export function ContextPanel({
  items,
  budget,
  onBudgetChange,
  onToggle,
  onRemove,
}: ContextPanelProps) {
  const used = enabledContextTokens(items);
  const overBudget = used > budget;

  const trimmed = useMemo(() => contextBudget(items, budget), [items, budget]);
  const trimmedEnabled = new Set(
    trimmed.filter((item) => item.enabled).map((item) => item.id),
  );

  return (
    <section className="context-panel" aria-label="Session context">
      <header className="context-panel-header">
        <h2>Context</h2>
        <label className="context-budget">
          <span>Budget</span>
          <input
            type="number"
            min={0}
            step={100}
            value={budget}
            aria-label="Context token budget"
            onChange={(event) =>
              onBudgetChange(Math.max(0, Number(event.target.value) || 0))
            }
          />
          <span>tokens</span>
        </label>
        <span
          className={`context-token-total${overBudget ? ' over' : ''}`}
          data-testid="context-token-total"
        >
          {used} / {budget}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="context-panel-empty">
          No context attached to this session yet.
        </p>
      ) : (
        <ul className="context-panel-list">
          {items.map((item) => {
            const dropped = item.enabled && !trimmedEnabled.has(item.id);
            return (
              <li
                key={item.id}
                className={`context-panel-item${dropped ? ' dropped' : ''}`}
              >
                <label className="context-panel-toggle">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    aria-label={`Enable ${item.title}`}
                    onChange={() => onToggle(item.id)}
                  />
                  <span className="context-panel-kind">{item.kind}</span>
                  <span className="context-panel-title">{item.title}</span>
                </label>
                <span className="context-panel-tokens">
                  {item.tokens || estimateTokens(item.content)} tok
                </span>
                <button
                  type="button"
                  className="context-panel-remove"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => onRemove(item.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
