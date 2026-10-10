import type {
  AgentRequest,
  AgentResult,
  AgentStep,
  AgentToolDef,
  AgentStrategy,
  AgentMemory,
  BuiltinToolName,
  Result,
  ServiceConfig,
} from '@prism/shared-types';
import type { LLMService } from '@prism/llm';
import {
  OpenAILLMService,
  ClaudeLLMService,
  GeminiLLMService,
  GroqLLMService,
  DeepSeekLLMService,
  GrokLLMService,
  OpenRouterLLMService,
  PoeLLMService,
  NvidiaNimLLMService,
  CerebrasLLMService,
  CloudflareWorkersLLMService,
  FireworksLLMService,
  ZaiLLMService,
  QwenLLMService,
  TransformersLLMService,
  MistralLLMService,
  CohereLLMService,
  TogetherLLMService,
  PerplexityLLMService,
} from '@prism/llm';

export interface AgentService {
  readonly provider: string;
  run(request: AgentRequest): Promise<Result<AgentResult>>;
}

export interface ToolExecutor {
  execute(toolName: string, input: string): Promise<string>;
}

export class BuiltinToolExecutor implements ToolExecutor {
  private webSearchService?: import('@prism/web-search').WebSearchService;

  /** Inject a real search backend (Brave, Tavily, DuckDuckGo…). Falls back to DuckDuckGo which needs no API key. */
  setWebSearchService(
    service: import('@prism/web-search').WebSearchService,
  ): void {
    this.webSearchService = service;
  }

  async execute(toolName: string, input: string): Promise<string> {
    switch (toolName as BuiltinToolName) {
      case 'web_search':
        return this.webSearch(input);
      case 'calculator':
        return this.calc(input);
      case 'fetch_url':
        return this.fetchUrl(input);
      case 'code_eval':
        return this.codeEval(input);
      case 'read_file':
        return this.readFile(input);
      default:
        return `Tool "${toolName}" is not a recognized built-in tool. Input: "${input}"`;
    }
  }

  private async webSearch(query: string): Promise<string> {
    let service = this.webSearchService;
    if (!service) {
      const { DuckDuckGoSearchService } = await import('@prism/web-search');
      service = new DuckDuckGoSearchService({
        apiKey: '',
        provider: 'duckduckgo',
      });
    }
    const result = await service.search({ query, maxResults: 5 });
    if (!result.ok) return `[web_search] Error: ${result.error}`;
    if (result.value.results.length === 0)
      return `[web_search] No results for "${query}"`;
    return result.value.results
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`)
      .join('\n\n');
  }

  private async fetchUrl(url: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return `[fetch_url] Error: invalid URL "${url}"`;
    }
    try {
      const response = await fetch(parsed.toString(), {
        headers: { 'User-Agent': 'Prism/1.0' },
      });
      if (!response.ok) return `[fetch_url] Error: HTTP ${response.status}`;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/') && !contentType.includes('json')) {
        return `[fetch_url] Content-Type: ${contentType} — binary content not extracted`;
      }
      const text = await response.text();
      const extracted = contentType.includes('html')
        ? text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : text.trim();
      return extracted.length > 4000
        ? `${extracted.slice(0, 4000)}…[truncated]`
        : extracted;
    } catch (err) {
      return `[fetch_url] Error: ${String(err)}`;
    }
  }

  private readFile(path: string): string {
    // Intentionally denied: the agent runs in a browser/service-worker sandbox
    // with no filesystem access, and granting raw file reads to a prompt-driven
    // tool would be a security hole. Route file content through context
    // attachment instead.
    return `[read_file] Denied: filesystem access is not available in this sandbox. Attach the file content to the conversation instead of reading "${path}".`;
  }

  private calc(input: string): string {
    try {
      const sanitized = input.replace(/[^0-9+\-*/().%\s^]/g, '');
      if (!sanitized.trim())
        return `[calculator] Error: no valid expression in "${input}"`;
      const fn = new Function(`"use strict"; return (${sanitized})`);
      const result = fn();
      return `[calculator] ${input} = ${result}`;
    } catch {
      return `[calculator] Error: could not evaluate "${input}"`;
    }
  }

  private codeEval(input: string): string {
    try {
      const fn = new Function(`"use strict"; return (${input})`);
      const result = fn();
      return `[code_eval] Result: ${JSON.stringify(result)}`;
    } catch {
      return `[code_eval] Error: could not evaluate expression`;
    }
  }
}

export class CustomToolExecutor implements ToolExecutor {
  private handlers: Map<string, (input: string) => Promise<string>>;

  constructor(handlers: Record<string, (input: string) => Promise<string>>) {
    this.handlers = new Map(Object.entries(handlers));
  }

  async execute(toolName: string, input: string): Promise<string> {
    const handler = this.handlers.get(toolName);
    if (handler) return handler(input);
    return `Tool "${toolName}" not found. Input: "${input}"`;
  }
}

export class CompositeToolExecutor implements ToolExecutor {
  private executors: ToolExecutor[];

  constructor(...executors: ToolExecutor[]) {
    this.executors = executors;
  }

  async execute(toolName: string, input: string): Promise<string> {
    for (const executor of this.executors) {
      try {
        const result = await executor.execute(toolName, input);
        if (
          !result.includes('not a recognized') &&
          !result.includes('not found')
        ) {
          return result;
        }
      } catch {
        continue;
      }
    }
    return `[${toolName}] No executor handled this tool.`;
  }
}

/**
 * Wraps a ToolExecutor with an allow/deny/ask permission policy.
 *
 * Resolution order for a tool:
 *   1. per-tool entry in `permissions`
 *   2. `defaultPermission` (the global default)
 *   3. 'ask' when an ask handler exists, otherwise 'allow'
 *
 * - allow: delegate to the wrapped executor
 * - deny:  refuse with a denial message the agent can read
 * - ask:   call the ask handler; a true answer delegates, false denies
 */
export class PermissionAwareToolExecutor implements ToolExecutor {
  private inner: ToolExecutor;
  private permissions: Record<
    string,
    import('@prism/shared-types').ToolPermission
  >;
  private defaultPermission: import('@prism/shared-types').ToolPermission;
  private askHandler?: (toolName: string, input: string) => Promise<boolean>;

  constructor(options: {
    inner: ToolExecutor;
    permissions?: Record<string, import('@prism/shared-types').ToolPermission>;
    defaultPermission?: import('@prism/shared-types').ToolPermission;
    onAsk?: (toolName: string, input: string) => Promise<boolean>;
  }) {
    this.inner = options.inner;
    this.permissions = options.permissions ?? {};
    this.defaultPermission = options.defaultPermission ?? 'ask';
    this.askHandler = options.onAsk;
  }

  async execute(toolName: string, input: string): Promise<string> {
    const level = this.permissions[toolName] ?? this.defaultPermission;

    if (level === 'deny') {
      return `[${toolName}] Permission denied: this tool is blocked. Continue without it.`;
    }

    if (level === 'ask') {
      if (this.askHandler) {
        const granted = await this.askHandler(toolName, input);
        if (!granted) {
          return `[${toolName}] Permission denied by user. Continue without it.`;
        }
      } else {
        // No handler available (non-interactive runs): deny by default.
        return `[${toolName}] Permission required (no prompt available). Continue without it.`;
      }
    }

    return this.inner.execute(toolName, input);
  }
}

const DEFAULT_REACT_PROMPT = `You are an autonomous agent. Given a task, think step by step.

For each step, respond with EXACTLY this JSON format:
{"thought":"<your reasoning>","action":"<tool_name>","action_input":"<input for tool>"}

When you have the final answer, respond with:
{"thought":"<reasoning>","action":"Final Answer","action_input":"<your answer>"}

Available tools:
{tools}

Begin!`;

const PLAN_AND_EXECUTE_PROMPT = `You are a planning agent. Break the task into steps, then execute each one.

Phase 1 - PLAN: Respond with a JSON plan:
{"thought":"<analysis>","action":"Plan","action_input":"<numbered list of steps>"}

Phase 2 - EXECUTE: For each planned step, respond with:
{"thought":"<reasoning about step>","action":"<tool_name>","action_input":"<input>"}

When all steps are done, respond with:
{"thought":"<final reasoning>","action":"Final Answer","action_input":"<your answer>"}

Available tools:
{tools}

Begin!`;

const REFLEXION_PROMPT = `You are a reflexive agent. After each action, evaluate your result.

For each step, respond with EXACTLY this JSON format:
{"thought":"<your reasoning>","action":"<tool_name>","action_input":"<input for tool>"}

After receiving an observation, you may reflect:
{"thought":"<evaluation of result>","action":"Reflect","action_input":"<what you learned and what to do differently>"}

When confident in your final answer, respond with:
{"thought":"<reasoning>","action":"Final Answer","action_input":"<your answer>"}

Available tools:
{tools}

Begin!`;

function getSystemPrompt(strategy: AgentStrategy, custom?: string): string {
  if (custom) return custom;
  switch (strategy) {
    case 'plan-and-execute':
      return PLAN_AND_EXECUTE_PROMPT;
    case 'reflexion':
      return REFLEXION_PROMPT;
    default:
      return DEFAULT_REACT_PROMPT;
  }
}

/** Compose personality + ranked memories onto a system prompt. */
function composeAgentPersona(
  base: string,
  personality?: string,
  memories?: AgentMemory[],
): string {
  let prompt = base;
  if (personality) {
    prompt += `\n\n## Personality\n${personality}`;
  }
  if (memories && memories.length > 0) {
    const ranked = [...memories]
      .sort((a, b) => (b.importance ?? 0.5) - (a.importance ?? 0.5))
      .slice(0, 10);
    prompt += `\n\n## Core Memories\n${ranked
      .map((m) => `- [${m.kind}] ${m.content}`)
      .join('\n')}`;
  }
  return prompt;
}

function toolDefsToDescriptions(tools: AgentToolDef[]): string {
  const enabled = tools.filter((t) => t.enabled);
  if (enabled.length === 0)
    return '- Final Answer: Provide the final answer to the task';
  return enabled.map((t) => `- ${t.name}: ${t.description}`).join('\n');
}

export interface AgentRunConfig {
  systemPrompt?: string;
  strategy?: AgentStrategy;
  temperature?: number;
  maxTokens?: number;
  tools?: AgentToolDef[];
  toolExecutor?: ToolExecutor;
  /** Per-tool permission overrides applied for every run of this service. */
  permissions?: Record<string, import('@prism/shared-types').ToolPermission>;
  /** Global default when a tool has no explicit entry. Default 'ask'. */
  defaultPermission?: import('@prism/shared-types').ToolPermission;
  /** Ask handler for 'ask'-level tools in non-interactive services. */
  onToolPermissionAsk?: (toolName: string, input: string) => Promise<boolean>;
}

export class ReActAgentService implements AgentService {
  readonly provider = 'react';
  private llm: LLMService;
  private maxSteps: number;
  private config: AgentRunConfig;

  constructor(llm: LLMService, maxSteps = 10, config: AgentRunConfig = {}) {
    this.llm = llm;
    this.maxSteps = maxSteps;
    this.config = config;
  }

  async run(request: AgentRequest): Promise<Result<AgentResult>> {
    try {
      const strategy = this.config.strategy ?? 'react';
      const systemPrompt = composeAgentPersona(
        getSystemPrompt(strategy, this.config.systemPrompt),
        request.personality,
        request.memories,
      );
      const tools =
        this.config.tools ??
        request.tools?.map((t) => ({ ...t, enabled: true })) ??
        [];
      const toolDescriptions =
        tools.length > 0
          ? toolDefsToDescriptions(tools)
          : '- Final Answer: Provide the final answer to the task';
      const baseExecutor =
        this.config.toolExecutor ?? new BuiltinToolExecutor();
      // Wrap with the permission policy: request overrides beat service-level
      // config; default falls back through ask-handler availability.
      const permissions = {
        ...(this.config.permissions ?? {}),
        ...(request.toolPermissions ?? {}),
      };
      const executor =
        Object.keys(permissions).length > 0 ||
        this.config.defaultPermission !== undefined ||
        request.toolPermissions !== undefined
          ? new PermissionAwareToolExecutor({
              inner: baseExecutor,
              permissions,
              defaultPermission: this.config.defaultPermission,
              onAsk:
                request.onToolPermissionAsk ?? this.config.onToolPermissionAsk,
            })
          : baseExecutor;
      const steps: AgentStep[] = [];
      const history: string[] = [];
      const maxSteps = request.maxSteps || this.maxSteps;
      const temperature = this.config.temperature ?? 0;
      const maxTokens = this.config.maxTokens ?? 1024;

      let currentInput = request.task;
      let totalTokens = 0;

      for (let step = 0; step < maxSteps; step++) {
        let prompt: string;
        if (history.length > 0) {
          prompt = `${systemPrompt.replace('{tools}', toolDescriptions)}\n\nTask: ${request.task}\n\n${history.join('\n')}\nObservation: ${currentInput}\nThought:`;
        } else {
          prompt = `${systemPrompt.replace('{tools}', toolDescriptions)}\n\nTask: ${request.task}`;
        }

        const llmResult = await this.llm.complete({
          messages: [
            {
              id: `sys-${step}`,
              role: 'system',
              content: systemPrompt.replace('{tools}', toolDescriptions),
              timestamp: Date.now(),
            },
            {
              id: `user-${step}`,
              role: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          temperature,
          maxTokens,
        });

        if (!llmResult.ok) return { ok: false, error: llmResult.error };
        totalTokens += llmResult.value.tokensUsed || 0;

        const raw = llmResult.value.content.trim();
        let parsed: Record<string, unknown>;
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        } catch {
          return {
            ok: true,
            value: {
              answer: raw,
              steps,
              tokensUsed: totalTokens,
              model: llmResult.value.model,
              agentId: request.agentId,
            },
          };
        }

        const thought = (parsed.thought as string) || '';
        const action = (parsed.action as string) || 'Final Answer';
        const actionInput = (parsed.action_input as string) || '';

        if (action === 'Final Answer') {
          steps.push({ thought, action, observation: actionInput });
          return {
            ok: true,
            value: {
              answer: actionInput,
              steps,
              tokensUsed: totalTokens,
              model: llmResult.value.model,
              agentId: request.agentId,
            },
          };
        }

        if (action === 'Reflect' || action === 'Plan') {
          steps.push({ thought, action, observation: actionInput });
          history.push(
            `Thought: ${thought}\nAction: ${action}(${actionInput})`,
          );
          currentInput = actionInput;
          continue;
        }

        const observation = await executor.execute(action, actionInput);
        steps.push({ thought, action, observation });
        history.push(
          `Thought: ${thought}\nAction: ${action}(${actionInput})\nObservation: ${observation}`,
        );
        currentInput = observation;
      }

      return {
        ok: false,
        error: 'Agent exceeded maximum steps without reaching a final answer',
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown agent error',
      };
    }
  }
}

export class CustomAgentService implements AgentService {
  readonly provider: string;
  private llm: LLMService;
  private agentDef: AgentRunConfig;
  private maxSteps: number;

  constructor(
    provider: string,
    llm: LLMService,
    agentDef: AgentRunConfig,
    maxSteps = 10,
  ) {
    this.provider = provider;
    this.llm = llm;
    this.agentDef = agentDef;
    this.maxSteps = maxSteps;
  }

  async run(request: AgentRequest): Promise<Result<AgentResult>> {
    const agent = new ReActAgentService(this.llm, this.maxSteps, this.agentDef);
    return agent.run(request);
  }
}

function createAgentClass(
  providerName: string,
  LLMClass: new (config: ServiceConfig) => LLMService,
) {
  return class implements AgentService {
    readonly provider = providerName;
    readonly config: ServiceConfig;
    readonly maxSteps: number;
    readonly agentConfig?: AgentRunConfig;
    constructor(
      config: ServiceConfig,
      maxSteps = 10,
      agentConfig?: AgentRunConfig,
    ) {
      this.config = config;
      this.maxSteps = maxSteps;
      this.agentConfig = agentConfig;
    }
    async run(request: AgentRequest): Promise<Result<AgentResult>> {
      const llm = new LLMClass(this.config);
      const agent = new ReActAgentService(llm, this.maxSteps, this.agentConfig);
      return agent.run(request);
    }
  };
}

export const OpenAIAgentService = createAgentClass('openai', OpenAILLMService);
export const ClaudeAgentService = createAgentClass('claude', ClaudeLLMService);
export const GeminiAgentService = createAgentClass('gemini', GeminiLLMService);
export const GroqAgentService = createAgentClass('groq', GroqLLMService);
export const DeepSeekAgentService = createAgentClass(
  'deepseek',
  DeepSeekLLMService,
);
export const GrokAgentService = createAgentClass('grok', GrokLLMService);
export const OpenRouterAgentService = createAgentClass(
  'openrouter',
  OpenRouterLLMService,
);
export const PoeAgentService = createAgentClass('poe', PoeLLMService);
export const NvidiaNimAgentService = createAgentClass(
  'nvidia-nim',
  NvidiaNimLLMService,
);
export const CerebrasAgentService = createAgentClass(
  'cerebras',
  CerebrasLLMService,
);
export const CloudflareWorkersAgentService = createAgentClass(
  'cloudflare-workers',
  CloudflareWorkersLLMService,
);
export const FireworksAgentService = createAgentClass(
  'fireworks',
  FireworksLLMService,
);
export const ZaiAgentService = createAgentClass('zai', ZaiLLMService);
export const QwenAgentService = createAgentClass('qwen', QwenLLMService);
export const TransformersAgentService = createAgentClass(
  'transformers',
  TransformersLLMService,
);
export const MistralAgentService = createAgentClass(
  'mistral',
  MistralLLMService,
);
export const CohereAgentService = createAgentClass('cohere', CohereLLMService);
export const TogetherAgentService = createAgentClass(
  'together',
  TogetherLLMService,
);
export const PerplexityAgentService = createAgentClass(
  'perplexity',
  PerplexityLLMService,
);
