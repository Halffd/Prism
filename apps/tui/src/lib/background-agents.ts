import * as fs from 'fs';
import {
  clampSubagentTools,
  loadCore,
  resolveSubagentModel,
  subagents,
  type SubagentSpec,
} from '@prism/ai-core';
import { NODE_TOOLS } from './node-tool-executor';
import { mcpConfigPath, type McpSession } from './mcp';
import type { AgentTool } from '@prism/shared-types';

/**
 * Subagents for the TUI, on the core's registry: the six shipped
 * profiles (explore, security-review, bugbot, ci-investigation,
 * browser-use, shell-ops) plus any `subagents` entries in the same
 * config file the MCP servers come from (`~/.config/prism/mcp.json`,
 * Cursor-style single-file setup).
 *
 * Every run resolves its model through the core's forced order
 * (spec → session → provider default) and clamps its tool surface to
 * the allowlist intersected with the host's advertised surface — the
 * same core path the extension and daemon take.
 */

export type { SubagentSpec };

export interface SubagentResolution {
  model: string;
  tier: 'subagent_forced' | 'session' | 'provider_default';
}

/** Custom spec entry in the config file (same fields as the core's). */
interface ConfigSubagent {
  name?: unknown;
  description?: unknown;
  forced_model?: unknown;
  tool_allowlist?: unknown;
}

/**
 * The registry as the TUI sees it: the shipped six, upserted with any
 * valid `subagents` entries from the config file. Returns the specs
 * plus per-entry errors — a bad custom entry never kills the shipped
 * registry.
 */
export async function subagentRegistry(): Promise<{
  specs: SubagentSpec[];
  errors: string[];
}> {
  const core = await loadCore();
  const specs = subagents(core);
  const errors: string[] = [];
  const path = mcpConfigPath();
  let raw: unknown;
  try {
    // Same file the MCP servers come from; absent key = stock registry.
    raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch {
    return { specs, errors };
  }
  const entries = (raw as { subagents?: unknown }).subagents;
  if (entries === undefined) {
    return { specs, errors };
  }
  if (!Array.isArray(entries)) {
    errors.push(`${path}: "subagents" must be an array`);
    return { specs, errors };
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as ConfigSubagent;
    const label = `${path}: subagents[${i}]`;
    if (
      typeof e?.name !== 'string' ||
      !/^[a-z][a-z0-9_-]*$/.test(e.name)
    ) {
      errors.push(`${label}: "name" must be kebab/snake-case ([a-z][a-z0-9_-]*)`);
      continue;
    }
    if (typeof e.description !== 'string') {
      errors.push(`${label}: "description" must be a string`);
      continue;
    }
    if (
      e.tool_allowlist !== undefined &&
      (!Array.isArray(e.tool_allowlist) ||
        e.tool_allowlist.some((t) => typeof t !== 'string'))
    ) {
      errors.push(`${label}: "tool_allowlist" must be an array of tool names`);
      continue;
    }
    // Upsert semantics match the core's registry: same name replaces.
    const spec: SubagentSpec = {
      name: e.name,
      description: e.description,
      forced_model: typeof e.forced_model === 'string' ? e.forced_model : null,
      tool_allowlist: (e.tool_allowlist as string[] | undefined) ?? [],
    };
    const idx = specs.findIndex((s) => s.name === spec.name);
    if (idx >= 0) {
      specs[idx] = spec;
    } else {
      specs.push(spec);
    }
  }
  return { specs, errors };
}

/**
 * Effective tool surface for one subagent run: the allowlist
 * intersected with the host's advertised names (node tools + MCP), via
 * the core's clamp. Empty allowlist = the full surface.
 */
export async function subagentTools(
  name: string,
  mcp?: McpSession | null,
): Promise<AgentTool[]> {
  const core = await loadCore();
  const surface: AgentTool[] = mcp ? [...NODE_TOOLS, ...mcp.tools] : NODE_TOOLS;
  const effective = clampSubagentTools(
    core,
    name,
    surface.map((t) => t.name),
  );
  return surface.filter((t) => effective.includes(t.name));
}

/**
 * Resolved model for one subagent run, using the host session model
 * (aiConfig.model) and the provider's default tier as fallbacks.
 */
export async function subagentModel(
  name: string,
  sessionModel: string,
  providerDefault?: string | null,
): Promise<SubagentResolution> {
  const core = await loadCore();
  const r = resolveSubagentModel(core, name, sessionModel, providerDefault);
  return { model: r.model, tier: r.tier };
}

// ---- background agent runs -----------------------------------------------

export type BackgroundStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BackgroundJob {
  id: string;
  specName: string;
  task: string;
  status: BackgroundStatus;
  startedAt: number;
  finishedAt?: number;
  /** Final answer text on 'done'. */
  answer?: string;
  error?: string;
}

/** The runner the manager calls per job (async, cancellable not
 *  required: a failed run just reports 'failed'). */
export type BackgroundRunner = (
  specName: string,
  task: string,
) => Promise<{ ok: boolean; answer?: string; error?: string }>;

/** Deterministic background job queue: statuses flow queued → running
 *  → done|failed, and listeners are notified on every transition. */
export class BackgroundAgentManager {
  private jobs: BackgroundJob[] = [];
  private listeners = new Set<(job: BackgroundJob) => void>();
  private counter = 0;

  constructor(private runner: BackgroundRunner) {}

  /** Queue a job. Returns immediately; the runner drives status. */
  spawn(specName: string, task: string): BackgroundJob {
    const id = `bg_${(++this.counter).toString(16)}_${Date.now().toString(16)}`;
    const job: BackgroundJob = {
      id,
      specName,
      task,
      status: 'queued',
      startedAt: Date.now(),
    };
    this.jobs.push(job);
    this.notify(job);
    // Defer the drive so the caller observes the 'queued' state first.
    queueMicrotask(() => void this.drive(job));
    return job;
  }

  private async drive(job: BackgroundJob): Promise<void> {
    this.transition(job, 'running');
    try {
      const res = await this.runner(job.specName, job.task);
      if (res.ok) {
        job.answer = res.answer;
        job.error = undefined;
        this.transition(job, 'done');
      } else {
        job.error = res.error ?? 'subagent run failed';
        this.transition(job, 'failed');
      }
    } catch (err) {
      job.error = (err as Error).message;
      this.transition(job, 'failed');
    }
    job.finishedAt = Date.now();
  }

  private transition(job: BackgroundJob, status: BackgroundStatus): void {
    job.status = status;
    this.notify(job);
  }

  private notify(job: BackgroundJob): void {
    for (const l of [...this.listeners]) {
      l(job);
    }
  }

  /** Subscribe to job transitions; returns the unsubscribe fn. */
  subscribe(fn: (job: BackgroundJob) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): readonly BackgroundJob[] {
    return this.jobs;
  }

  /** One job by id, for /agents status <id>. */
  get(id: string): BackgroundJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  /** Newest job quoting a spec, or undefined. */
  latestFor(specName: string): BackgroundJob | undefined {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (this.jobs[i].specName === specName) {
        return this.jobs[i];
      }
    }
    return undefined;
  }
}

/** A one-line status text for the chat transcript. */
export function jobLine(job: BackgroundJob): string {
  switch (job.status) {
    case 'queued':
      return `[bg ${job.specName}] queued (${job.id})`;
    case 'running':
      return `[bg ${job.specName}] running (${job.id})`;
    case 'done':
      return [
        `[bg ${job.specName}] done (${job.id})`,
        job.answer ?? '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'failed':
      return `[bg ${job.specName}] failed (${job.id}): ${job.error ?? 'unknown error'}`;
  }
}
