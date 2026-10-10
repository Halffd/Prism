import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Server-side tool execution — explicit, permission-checked.
 *
 * The Prism API is a self-hosted Node server, so it CAN execute host
 * commands. That is exactly why execution here is:
 *   1. Gated by PRISM_ENABLE_TOOL_EXECUTION=1 (default OFF — a self-hosted
 *      instance must opt in consciously),
 *   2. Limited to an allowlist of command prefixes (PRISM_TOOL_ALLOWLIST,
 *      comma-separated; default read-only tools: ls, cat, head, tail, pwd,
 *      grep, find, wc, file, git log, git status, git diff),
 *   3. Timed and output-capped.
 *
 * File reads are restricted to PRISM_TOOL_ROOT (default cwd).
 */

interface ToolExecutionRequest {
  tool: 'shell' | 'read_file';
  input: string;
}

interface ToolExecutionResponse {
  success: boolean;
  output?: string;
  error?: string;
}

const DEFAULT_ALLOWLIST = [
  'ls',
  'cat',
  'head',
  'tail',
  'pwd',
  'grep',
  'find',
  'wc',
  'file',
  'git log',
  'git status',
  'git diff',
];

function getAllowlist(): string[] {
  const raw = process.env.PRISM_TOOL_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowed(command: string): boolean {
  const trimmed = command.trim();
  return getAllowlist().some((prefix) => trimmed.startsWith(prefix));
}

export const toolsRouter = Router();

toolsRouter.post('/execute', async (req: Request, res: Response) => {
  if (process.env.PRISM_ENABLE_TOOL_EXECUTION !== '1') {
    return res.status(403).json({
      success: false,
      error:
        'Tool execution is disabled on this server. Set PRISM_ENABLE_TOOL_EXECUTION=1 to opt in.',
    } satisfies ToolExecutionResponse);
  }

  const { tool, input } = (req.body ?? {}) as Partial<ToolExecutionRequest>;

  if (!tool || !input || typeof input !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'tool ("shell" | "read_file") and input are required',
    } satisfies ToolExecutionResponse);
  }

  if (tool === 'read_file') {
    const root = process.env.PRISM_TOOL_ROOT || process.cwd();
    // Path traversal guard: resolved path must stay under root
    const pathMod = await import('path');
    const resolved = pathMod.resolve(input);
    if (!resolved.startsWith(pathMod.resolve(root))) {
      return res.status(403).json({
        success: false,
        error: `Path is outside PRISM_TOOL_ROOT (${root})`,
      } satisfies ToolExecutionResponse);
    }
    try {
      const content = await readFile(resolved, 'utf-8');
      return res.json({
        success: true,
        output:
          content.length > 4000
            ? `${content.slice(0, 4000)}…[truncated]`
            : content,
      } satisfies ToolExecutionResponse);
    } catch (err) {
      return res.json({
        success: false,
        error: (err as Error).message,
      } satisfies ToolExecutionResponse);
    }
  }

  if (tool === 'shell') {
    if (!isAllowed(input)) {
      return res.status(403).json({
        success: false,
        error: `Command not in allowlist. Allowed prefixes: ${getAllowlist().join(', ')}`,
      } satisfies ToolExecutionResponse);
    }
    try {
      const { stdout, stderr } = await execAsync(input, {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      return res.json({
        success: true,
        output:
          out.length > 4000
            ? `${out.slice(0, 4000)}…[truncated]`
            : out || '(no output)',
      } satisfies ToolExecutionResponse);
    } catch (err) {
      const e = err as { message?: string; code?: number | string };
      return res.json({
        success: false,
        error: `exit ${e.code ?? '?'}: ${e.message ?? String(err)}`,
      } satisfies ToolExecutionResponse);
    }
  }

  return res.status(400).json({
    success: false,
    error: `Unknown tool "${tool}"`,
  } satisfies ToolExecutionResponse);
});
