/**
 * The agent console — the agentd insights as the extension sees them.
 *
 * Cursor's `agentd` keeps three contracts in front of its agent loop:
 * a sandbox policy that fails closed, a tool-call gate (clamp, repair,
 * classify) and a subagent registry with a forced-model order. The core
 * owns all three; this module is the extension's view of them.
 *
 * Nothing here decides policy: every answer comes from the core wasm
 * (`@prism/ai-core`), so the extension, the CLI, the desktop app and
 * the API classify the same observation the same way.
 */
import {
  classifyToolObservation,
  clampToolCall,
  loadCore,
  repairToolInput,
  resolveSubagentModel,
  sandboxPlan,
  subagents,
  type SandboxPlan,
  type SandboxPolicy,
  type SubagentModelResolution,
  type SubagentSpec,
  type ToolErrorKindName,
  type WasmCore,
} from '@prism/ai-core';

/** The backend a host applies to a spawned process. */
export type SandboxBackend =
  | 'landlock_seccomp'
  | 'landlock'
  | 'unsandboxed'
  | 'off'
  | 'unsupported';

/** What the agent header shows about the host that runs the agent. */
export interface SandboxPosture {
  /** The mode the policy asked for. */
  mode: 'off' | 'auto' | 'strict';
  /** The backend the host would apply. */
  backend: SandboxBackend;
  /** Whether the requested mode is honoured on this host. */
  honoured: boolean;
  /** Badge text. */
  label: string;
  /** Badge tone: `ok` enforced, `warn` degraded, `error` refused. */
  tone: 'ok' | 'warn' | 'error';
  /** The closed outcome variant when the posture is not honoured. */
  reason?: string;
}

/** A tool argument after the repair layer normalised it. */
export interface RepairedToolCall {
  /** The input the tool actually receives. */
  input: string;
  /** Every normalisation applied, in order. */
  notes: string[];
  /** Whether the call had to be repaired. */
  repaired: boolean;
}

/** A tool observation, classified into the core's closed taxonomy. */
export interface ClassifiedObservation {
  /** The taxonomy entry. */
  kind: ToolErrorKindName;
  /** The actionable advice the core appends to the observation. */
  detail: string | null;
  /** Badge text. */
  label: string;
  /** Whether the observation is an error at all. */
  isError: boolean;
}

/** A clamped tool call. */
export interface ClampedToolCall {
  /** Whether the tool may run. */
  allowed: boolean;
  /** The fail-closed reason when it may not. */
  error?: string;
}

/** One shipped subagent with the model it resolves to. */
export interface SubagentEntry {
  /** The registry entry. */
  spec: SubagentSpec;
  /** The model the subagent runs with, and the tier that decided it. */
  resolution: SubagentModelResolution | null;
  /** Why no model resolved (nothing to fall back to). */
  error?: string;
}

/** The console: the core's agent surface, bound for one host. */
export interface AgentConsole {
  /** The core the answers come from. */
  readonly core: WasmCore;
  /** Posture of a host plan for a policy. */
  sandboxPosture(policy: SandboxPolicy, plan: SandboxPlan): SandboxPosture;
  /** Plan a policy with the local core (no host involved). */
  planSandbox(policy: SandboxPolicy): SandboxPlan;
  /** Normalise a model-produced tool argument. */
  repairToolCall(rawInput: string): RepairedToolCall;
  /** Classify a tool observation. */
  classifyObservation(observation: string): ClassifiedObservation;
  /** Clamp a tool call to the advertised surface. */
  clampToolCall(advertised: string[], tool: string): ClampedToolCall;
  /** The shipped subagent registry. */
  listSubagents(): SubagentSpec[];
  /** Resolve a subagent's model in the core's forced order. */
  resolveSubagentModel(
    name: string,
    sessionModel?: string,
    providerDefault?: string | null,
  ): SubagentEntry | null;
}

/** The badge text of a tool-error kind. */
export function toolErrorLabel(kind: ToolErrorKindName): string {
  switch (kind) {
    case 'not_recognized':
      return 'unknown tool';
    case 'permission_denied':
      return 'blocked';
    case 'invalid_input':
      return 'bad argument';
    case 'not_found':
      return 'not found';
    case 'environment':
      return 'environment error';
    default:
      return 'ok';
  }
}

/**
 * The posture of a host for a policy.
 *
 * `strict` fails closed: a host that cannot enforce the sandbox refuses
 * the plan, and the badge says so. `auto` degrades to an unsandboxed
 * fallback, which is a warning, not an error.
 */
export function sandboxPosture(
  policy: SandboxPolicy,
  plan: SandboxPlan,
): SandboxPosture {
  const mode = policy.mode ?? 'auto';
  if (!plan.ok) {
    return {
      mode,
      backend: 'unsupported',
      honoured: false,
      label: 'sandbox: unsupported',
      tone: 'error',
      reason: plan.error,
    };
  }
  switch (plan.sandbox_used) {
    case 'landlock_seccomp':
      return {
        mode,
        backend: 'landlock_seccomp',
        honoured: true,
        label: 'sandbox: landlock+seccomp',
        tone: 'ok',
      };
    case 'landlock':
      return {
        mode,
        backend: 'landlock',
        honoured: true,
        label: 'sandbox: landlock',
        tone: 'ok',
      };
    case 'unsandboxed_fallback':
      return {
        mode,
        backend: 'unsandboxed',
        honoured: mode !== 'strict',
        label: 'sandbox: none (auto fallback)',
        tone: mode === 'strict' ? 'error' : 'warn',
        reason: 'unsandboxed_fallback',
      };
    default:
      return {
        mode,
        backend: 'off',
        honoured: mode === 'off',
        label: 'sandbox: off',
        tone: mode === 'off' ? 'ok' : 'warn',
        reason: 'off',
      };
  }
}

/** Normalise a model-produced tool argument. */
export function repairToolCall(
  core: WasmCore,
  rawInput: string,
): RepairedToolCall {
  const report = repairToolInput(core, rawInput);
  return {
    input: report.input,
    notes: report.notes,
    repaired: report.notes.length > 0,
  };
}

/** Classify a tool observation into the core's closed taxonomy. */
export function classifyObservation(
  core: WasmCore,
  observation: string,
): ClassifiedObservation {
  const { kind, detail } = classifyToolObservation(core, observation);
  return {
    kind,
    detail,
    label: toolErrorLabel(kind),
    isError: kind !== 'none',
  };
}

/** Clamp a tool call to the advertised surface. */
export function clampedToolCall(
  core: WasmCore,
  advertised: string[],
  tool: string,
): ClampedToolCall {
  const result = clampToolCall(core, advertised, tool);
  return result.ok ? { allowed: true } : { allowed: false, error: result.error };
}

/** Bind the console to a core. */
export function bindAgentConsole(core: WasmCore): AgentConsole {
  return {
    core,
    sandboxPosture,
    planSandbox: (policy) => sandboxPlan(core, policy),
    repairToolCall: (rawInput) => repairToolCall(core, rawInput),
    classifyObservation: (observation) =>
      classifyObservation(core, observation),
    clampToolCall: (advertised, tool) =>
      clampedToolCall(core, advertised, tool),
    listSubagents: () => subagents(core),
    resolveSubagentModel: (name, sessionModel = '', providerDefault = null) => {
      const spec = subagents(core).find((s) => s.name === name);
      if (!spec) {
        return null;
      }
      try {
        return {
          spec,
          resolution: resolveSubagentModel(
            core,
            name,
            sessionModel,
            providerDefault,
          ),
        };
      } catch (e) {
        return { spec, resolution: null, error: (e as Error).message };
      }
    },
  };
}

/** Load the core and bind the console. */
export async function loadAgentConsole(): Promise<AgentConsole> {
  return bindAgentConsole(await loadCore());
}
