import type {
  AgentRequest,
  AgentResult,
  AgentStep,
  AgentToolDef,
  AgentStrategy,
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
  async execute(toolName: string, input: string): Promise<string> {
    switch (toolName as BuiltinToolName) {
      case 'web_search':
        return `[web_search] Query: "${input}" — Connect a WebSearchService to get real results. Stub returns: no results found.`;
      case 'calculator':
        return this.calc(input);
      case 'fetch_url':
        return `[fetch_url] URL: "${input}" — Connect an HTTP client to fetch real content. Stub returns: page content not available.`;
      case 'code_eval':
        return this.codeEval(input);
      case 'read_file':
        return `[read_file] Path: "${input}" — File access not available in sandbox. Stub returns: file not accessible.`;
      default:
        return `Tool "${toolName}" is not a recognized built-in tool. Input: "${input}"`;
    }
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
    return `No executor found for tool "${toolName}". Input: "${input}"`;
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
      const systemPrompt = getSystemPrompt(strategy, this.config.systemPrompt);
      const tools =
        this.config.tools ??
        request.tools?.map((t) => ({ ...t, enabled: true })) ??
        [];
      const toolDescriptions =
        tools.length > 0
          ? toolDefsToDescriptions(tools)
          : '- Final Answer: Provide the final answer to the task';
      const executor = this.config.toolExecutor ?? new BuiltinToolExecutor();
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
