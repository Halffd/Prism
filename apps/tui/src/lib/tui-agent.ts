import type {
  AgentRequest,
  AgentResult,
  AIConfig,
  ToolPermission,
  Result,
} from '@prism/shared-types';
import { ReActAgentService, PermissionAwareToolExecutor } from '@prism/agent';
import type { ToolExecutor } from '@prism/agent';
import { loadCore, clampToolCall } from '@prism/ai-core';
import { OpenAILLMService } from '@prism/llm';
import { NodeToolExecutor, NODE_TOOLS } from './node-tool-executor';
import { mcpSessionOnce, type McpSession } from './mcp';
import { resolveProviderKey } from './provider-env';

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
  /** An already-connected MCP session (see connectMcp). When omitted
   *  the config is read and connected per run. */
  mcpSession?: McpSession | null;
}

/** The core's gate in front of the whole TUI surface: a tool name the
 *  model hallucinated fails closed with the advertised list instead of
 *  reaching an executor. */
class ToolGate implements ToolExecutor {
  constructor(
    private inner: ToolExecutor,
    private advertised: string[],
  ) {}

  async execute(toolName: string, input: string): Promise<string> {
    const clamp = clampToolCall(await loadCore(), this.advertised, toolName);
    if (!clamp.ok) {
      return clamp.error ?? `Tool "${toolName}" is not a recognized tool.`;
    }
    return this.inner.execute(toolName, input);
  }
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
    apiKey: resolveProviderKey(
      (options.aiConfig.providerKeys ?? {})[options.aiConfig.provider],
      options.aiConfig.provider,
    ),
    apiUrl: options.aiConfig.apiUrl,
    model: options.aiConfig.model,
  });

  const nodeExecutor = new NodeToolExecutor();

  // MCP joins the node executor when a session exists (Cursor-style:
  // foreign tools sit in the advertised surface next to the local ones).
  const mcp =
    options.mcpSession !== undefined
      ? options.mcpSession
      : (await mcpSessionOnce()).session;
  const surface = mcp ? [...NODE_TOOLS, ...mcp.tools] : NODE_TOOLS;
  // Dispatch: mapped names go to the MCP transport, everything else to
  // the node executor (which reports unrecognised names itself).
  const dispatcher: ToolExecutor = mcp
    ? {
        async execute(toolName: string, input: string): Promise<string> {
          if (mcp.toolMap[toolName]) {
            return mcp.executor.execute(toolName, input);
          }
          return nodeExecutor.execute(toolName, input);
        },
      }
    : nodeExecutor;

  const agent = new ReActAgentService(llm, options.maxSteps ?? 10, {
    strategy: 'react',
    maxTokens: options.aiConfig.maxTokens,
    toolExecutor: new PermissionAwareToolExecutor({
      inner: new ToolGate(dispatcher, surface.map((t) => t.name)),
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
    // The TUI's own tool surface (node + MCP) is the advertised one:
    // the core's gate clamps every other name the model may produce.
    tools: request.tools && request.tools.length > 0 ? request.tools : surface,
  });
}
