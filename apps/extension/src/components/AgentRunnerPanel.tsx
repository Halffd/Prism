import type { AgentResult } from '@prism/shared-types';

interface Props {
  result: AgentResult | null;
  inProgress: boolean;
  currentStep?: number;
  maxSteps?: number;
  onClose: () => void;
}

export function AgentRunnerPanel({
  result,
  inProgress,
  currentStep,
  maxSteps,
  onClose,
}: Props) {
  return (
    <div className="st-agent-runner-panel">
      <div className="st-agent-runner-header">
        <span className="st-agent-runner-title">🤖 Agent</span>
        <button className="st-agent-runner-close" onClick={onClose}>
          ✕
        </button>
      </div>

      {inProgress && (
        <div className="st-agent-runner-progress">
          <div className="st-agent-runner-spinner" />
          <span>
            Thinking...{' '}
            {currentStep !== undefined
              ? `Step ${currentStep}${maxSteps ? `/${maxSteps}` : ''}`
              : ''}
          </span>
        </div>
      )}

      {result && (
        <div className="st-agent-runner-result">
          <div className="st-agent-runner-answer">
            <strong>Answer</strong>
            <p>{result.answer}</p>
          </div>

          {result.steps.length > 0 && (
            <details className="st-agent-runner-steps">
              <summary>{result.steps.length} steps</summary>
              {result.steps.map((step, i) => (
                <div key={i} className="st-agent-runner-step">
                  <div className="st-agent-step-thought">{step.thought}</div>
                  <div className="st-agent-step-action">
                    <span className="st-agent-step-label">Action:</span>{' '}
                    {step.action}
                  </div>
                  {step.observation && step.action !== 'Final Answer' && (
                    <div className="st-agent-step-observation">
                      <span className="st-agent-step-label">Observation:</span>{' '}
                      {step.observation}
                    </div>
                  )}
                </div>
              ))}
            </details>
          )}

          <div className="st-agent-runner-stats">
            {result.tokensUsed && <span>{result.tokensUsed} tokens</span>}
            {result.model && <span>Model: {result.model}</span>}
            {result.agentId && <span>Agent: {result.agentId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
