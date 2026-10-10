import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import type { ToolExecutor } from '@prism/agent';

const execAsync = promisify(exec);

/**
 * TUI-side tool executor. Runs on Node/Bun, so it can execute real shell
 * commands and read the filesystem — materially different from the
 * browser-sandboxed executor in libs/agent.
 *
 * Security: shell commands and file reads are ALWAYS routed through the
 * PermissionAwareToolExecutor (the caller wraps this executor with the
 * session's permission policy). This class itself only implements execution.
 */
export class NodeToolExecutor implements ToolExecutor {
  /** Max stdout captured from a command (chars). */
  maxOutput = 4000;
  /** Shell command timeout (ms). */
  timeoutMs = 30_000;

  async execute(toolName: string, input: string): Promise<string> {
    switch (toolName) {
      case 'shell':
      case 'run_command':
        return this.shell(input);
      case 'read_file':
        return this.readFileTool(input);
      case 'web_search':
      case 'calculator':
      case 'fetch_url':
      case 'code_eval':
        // Delegate the sandbox-safe tools to the shared builtin executor
        const { BuiltinToolExecutor } = await import('@prism/agent');
        return new BuiltinToolExecutor().execute(toolName, input);
      default:
        return `Tool "${toolName}" is not recognized by the TUI executor. Input: "${input}"`;
    }
  }

  private async shell(command: string): Promise<string> {
    if (!command.trim()) {
      return '[shell] Error: empty command';
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      });
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (!out) return `[shell] (no output) exit 0`;
      return out.length > this.maxOutput
        ? `${out.slice(0, this.maxOutput)}…[truncated]`
        : out;
    } catch (err) {
      const e = err as { message?: string; code?: number | string };
      return `[shell] Error (exit ${e.code ?? '?'}): ${e.message ?? String(err)}`;
    }
  }

  private async readFileTool(path: string): Promise<string> {
    try {
      const content = await readFile(path, 'utf-8');
      return content.length > this.maxOutput
        ? `${content.slice(0, this.maxOutput)}…[truncated]`
        : content;
    } catch (err) {
      return `[read_file] Error: ${(err as Error).message}`;
    }
  }
}
