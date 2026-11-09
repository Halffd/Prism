import { describe, expect, it } from '@jest/globals';
import type { LLMRequest, LLMResult, LLMService } from '@prism/llm';
import { ReActAgentService, type ToolExecutor } from '../index';

/**
 * The tool gate in front of the agent loop: the core's clamp, repair and
 * classification, applied to every tool call the model makes.
 */

/** An LLM that replays a fixed list of raw answers. */
class ScriptedLLM implements LLMService {
  readonly provider = 'scripted';
  private answers: string[];
  calls = 0;

  constructor(answers: string[]) {
    this.answers = answers;
  }

  async complete(_request: LLMRequest): Promise<{ ok: true; value: LLMResult }> {
    const answer = this.answers[Math.min(this.calls, this.answers.length - 1)];
    this.calls += 1;
    return {
      ok: true,
      value: {
        content: answer,
        tokensUsed: 1,
        model: 'scripted',
      },
    };
  }
}

/** An executor that records what it was asked to run. */
function recordingExecutor(result = 'tool output'): ToolExecutor & {
  calls: Array<{ tool: string; input: string }>;
} {
  return {
    calls: [],
    async execute(tool: string, input: string): Promise<string> {
      this.calls.push({ tool, input });
      return result;
    },
  };
}

const TOOLS = [
  { name: 'calculator', description: 'Evaluate an expression.', parameters: {} },
];

describe('ReActAgentService tool gate', () => {
  it('repairs a spilled argument before the tool runs', async () => {
    const llm = new ScriptedLLM([
      JSON.stringify({
        thought: 'compute',
        action: 'calculator',
        action_input: '{"input": "1+1"}',
      }),
      JSON.stringify({
        thought: 'done',
        action: 'Final Answer',
        action_input: '2',
      }),
    ]);
    const executor = recordingExecutor();
    const agent = new ReActAgentService(llm, 4, {
      toolExecutor: executor,
      tools: [{ ...TOOLS[0], enabled: true }],
    });

    const result = await agent.run({ task: 'add', tools: TOOLS });

    expect(result.ok).toBe(true);
    // The envelope is unwrapped: the tool sees the plain expression.
    expect(executor.calls).toEqual([{ tool: 'calculator', input: '1+1' }]);
  });

  it('clamps a tool that is not advertised', async () => {
    const llm = new ScriptedLLM([
      JSON.stringify({
        thought: 'shell out',
        action: 'shell_exec',
        action_input: 'rm -rf /',
      }),
      JSON.stringify({
        thought: 'done',
        action: 'Final Answer',
        action_input: 'refused',
      }),
    ]);
    const executor = recordingExecutor();
    const agent = new ReActAgentService(llm, 4, {
      toolExecutor: executor,
      tools: [{ ...TOOLS[0], enabled: true }],
    });

    const result = await agent.run({ task: 'go', tools: TOOLS });

    expect(result.ok).toBe(true);
    // The handler never ran.
    expect(executor.calls).toEqual([]);
    const observation = result.ok ? result.value.steps[0].observation : '';
    expect(observation).toContain('tool_clamped');
    expect(observation).toContain('calculator');
  });

  it('appends the actionable reason to a failed observation', async () => {
    const llm = new ScriptedLLM([
      JSON.stringify({
        thought: 'read',
        action: 'calculator',
        action_input: '1+1',
      }),
      JSON.stringify({
        thought: 'done',
        action: 'Final Answer',
        action_input: 'gave up',
      }),
    ]);
    const executor = recordingExecutor('[calculator] Error: invalid expression');
    const agent = new ReActAgentService(llm, 4, {
      toolExecutor: executor,
      tools: [{ ...TOOLS[0], enabled: true }],
    });

    const result = await agent.run({ task: 'go', tools: TOOLS });

    expect(result.ok).toBe(true);
    const observation = result.ok ? result.value.steps[0].observation : '';
    expect(observation).toContain('reason: argument rejected');
    expect(observation).toContain('repair notes: none');
  });
});
