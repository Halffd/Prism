import type {
  AgentRequest,
  AgentResult,
  AIConfig,
  ToolPermission,
  Result,
} from '@prism/shared-types';
import { ReActAgentService, PermissionAwareToolExecutor } from '@prism/agent';
import { OpenAILLMService } from '@prism/llm';
import { NodeToolExecutor } from './node-tool-executor';

/** Ask handler shape the Ink UI supplies (renders a y/n prompt). */
export type AskHandler = (toolName: string, input: string) => Promise<boolean>;

export interface TUIAgentOptions {
  aiConfig: AIConfig;
  /** Default permission for tools without an explicit entry. Default 'ask'. */
  defaultToolPermission?: ToolPermission;
  /** Per-tool overrides. */
  toolPermissions?: Record<string, ToolPermission>;
  /** Rendered y/n prompt for 'ask'-level tools. */
  onAsk?: AskHandler;
  /** Extra steps per run (request.maxSteps wins when set). */
  maxSteps?: number;
}

/**
 * TUI-owned agent runtime: Node-executing tools (shell, read_file) gated by
 * the permission policy, composed with the shared ReAct strategy.
 *
 * This is the enforcement boundary the extension never had — commands execute
 * here, so the policy is applied here, at the executor.
 */
export async function runTUIAgent(
  request: AgentRequest,
  options: TUIAgentOptions,
): Promise<Result<AgentResult>> {
  const llm = new OpenAILLMService({
    provider: options.aiConfig.provider,
    apiKey:
      (options.aiConfig.providerKeys ?? {})[options.aiConfig.provider] ?? '',
    apiUrl: options.aiConfig.apiUrl,
    model: options.aiConfig.model,
  });

  const nodeExecutor = new NodeToolExecutor();

  const agent = new ReActAgentService(llm, options.maxSteps ?? 10, {
    strategy: 'react',
    maxTokens: options.aiConfig.maxTokens,
    toolExecutor: new PermissionAwareToolExecutor({
      inner: nodeExecutor,
      permissions: options.toolPermissions,
      defaultPermission: options.defaultToolPermission ?? 'ask',
      onAsk: options.onAsk,
    }),
  });

  return agent.run({
    task: request.task,
    maxSteps: request.maxSteps,
    personality: request.personality,
    memories: request.memories,
    tools: request.tools,
  });
}
