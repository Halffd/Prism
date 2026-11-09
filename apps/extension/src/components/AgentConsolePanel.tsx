import { useEffect, useMemo, useState } from 'react';
import type { AgentStep } from '@prism/shared-types';
import {
  loadAgentConsole,
  type AgentConsole,
  type ClassifiedObservation,
  type SandboxPosture,
} from '../chat/agentConsole';

interface Props {
  /** The agent's steps; every observation is classified. */
  steps: AgentStep[];
  /** The posture of the host that runs the agent. */
  posture?: SandboxPosture | null;
}

/**
 * The agent console: what the core knows about the run.
 *
 * Every badge is the core's own answer — the tool observation is
 * classified into the closed taxonomy, and the reason the core would
 * append to it is shown next to it. The panel never guesses.
 */
export function AgentConsolePanel({ steps, posture }: Props) {
  const [console_, setConsole] = useState<AgentConsole | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAgentConsole()
      .then((c) => {
        if (!cancelled) setConsole(c);
      })
      .catch(() => {
        // No core on this host: the panel stays empty rather than
        // guessing a classification.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classified = useMemo<ClassifiedObservation[]>(() => {
    if (!console_) return [];
    return steps
      .filter((s) => s.observation && s.action !== 'Final Answer')
      .map((s) => console_.classifyObservation(s.observation));
  }, [console_, steps]);

  if (!posture && classified.length === 0) {
    return null;
  }

  return (
    <div className="st-agent-console">
      {posture && (
        <div className={`st-agent-console-posture st-agent-console-${posture.tone}`}>
          <span className="st-agent-console-badge">{posture.label}</span>
          {posture.reason && (
            <span className="st-agent-console-reason">{posture.reason}</span>
          )}
        </div>
      )}

      {classified.some((c) => c.isError) && (
        <ul className="st-agent-console-errors">
          {classified
            .filter((c) => c.isError)
            .map((c, i) => (
              <li key={i} className="st-agent-console-error">
                <span className="st-agent-console-badge">{c.label}</span>
                {c.detail && <span className="st-agent-console-detail">{c.detail}</span>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
