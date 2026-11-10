import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentTool } from '@prism/shared-types';
import type { ToolExecutor } from '@prism/agent';

/**
 * MCP over stdio for the TUI — the same `mcpServers` config shape Cursor
 * reads (`~/.config/prism/mcp.json`, or `PRISM_TUI_MCP_CONFIG`). Each
 * server is a child process spoken to with JSON-RPC 2.0 over newline-
 * delimited stdin/stdout: `initialize` handshake, then `tools/list`,
 * then `tools/call`.
 *
 * Tool names from foreign code are never advertised raw: every MCP tool
 * surfaces as `mcp__<server>__<tool>` sanitized to `[a-z0-9_]+` (the
 * core's id rule for tool names), and the sanitized→(server, tool) map
 * lives in the session, mirroring Cursor's toolNameMap.
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** Raw tool entry from `tools/list` (subset we consume). */
interface McpToolRaw {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** Where one advertised sanitized tool came from. */
export interface McpToolRef {
  server: string;
  tool: string;
}

/** Config path: env override wins, else the core's config root. */
export function mcpConfigPath(): string {
  const override = process.env.PRISM_TUI_MCP_CONFIG;
  if (override) {
    return override;
  }
  const configHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'prism', 'mcp.json');
}

/** Load the mcpServers config; null when absent, malformed or empty. */
export function loadMcpConfig(): { config: McpConfig; path: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(mcpConfigPath(), 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<McpConfig>;
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      return null;
    }
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
      if (
        cfg &&
        typeof cfg === 'object' &&
        typeof (cfg as McpServerConfig).command === 'string' &&
        (cfg as McpServerConfig).command.trim() !== ''
      ) {
        servers[name] = cfg as McpServerConfig;
      }
    }
    if (Object.keys(servers).length === 0) {
      return null;
    }
    return { config: { mcpServers: servers }, path: mcpConfigPath() };
  } catch {
    return null;
  }
}

/** The core's tool-name class: lowercase `[a-z0-9_]`, non-empty. */
export function sanitizeToolPart(part: string): string {
  const cleaned = part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'unnamed' : cleaned;
}

/** One child process speaking JSON-RPC 2.0 over stdio. */
export class StdioMcpServer {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private stderrTail = '';

  constructor(
    /** Configured server key (goes into the sanitized tool name). */
    readonly name: string,
    private cfg: McpServerConfig,
    /** Per-request timeout (ms); MCP servers that hang get cut off. */
    private requestTimeoutMs = 30_000,
  ) {}

  /** Whether the child process is still with us. */
  get alive(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Spawn + `initialize` handshake + `initialized` notification. */
  async start(): Promise<void> {
    this.child = spawn(this.cfg.command, this.cfg.args ?? [], {
      env: { ...process.env, ...this.cfg.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = this.child;
    child.on('exit', () => {
      // Every waiter fails on transport death, not hang.
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const p of pending) {
        p.reject(new Error(`mcp server "${this.name}" exited`));
      }
    });
    child.on('error', (err: Error) => {
      // spawn ENOENT and friends: transport is dead from call one.
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const p of pending) {
        p.reject(new Error(`mcp server "${this.name}" failed to start: ${err.message}`));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep a tail for diagnostics; servers log on stderr.
      this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-2000);
    });
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk.toString()));

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'prism-tui', version: '0.1.0' },
    });
    this.notify('notifications/initialized');
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) {
        return;
      }
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim() === '') {
        continue;
      }
      let msg: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id !== 'number' || !this.pending.has(msg.id)) {
        continue;
      }
      const waiter = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        waiter.reject(new Error(msg.error.message ?? 'mcp request failed'));
      } else {
        waiter.resolve(msg.result);
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.alive || !this.child?.stdin?.writable) {
      throw new Error(`mcp server "${this.name}" is not running`);
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  /** Send a request and await its result (timed out = dead call). */
  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const waiter: {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    } = { resolve: () => {}, reject: () => {}, timer: setTimeout(() => {}) };
    const promise = new Promise<unknown>((resolve, reject) => {
      waiter.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `mcp request "${method}" timed out (${this.requestTimeoutMs}ms)`,
          ),
        );
      }, this.requestTimeoutMs);
      waiter.resolve = (v) => {
        clearTimeout(waiter.timer);
        resolve(v);
      };
      waiter.reject = (e) => {
        clearTimeout(waiter.timer);
        reject(e);
      };
    });
    try {
      this.send({ jsonrpc: '2.0', id, method, params });
    } catch (err) {
      waiter.reject(err as Error);
      throw err;
    }
    this.pending.set(id, waiter);
    return promise;
  }

  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** `tools/list` — raw tools straight from the server. */
  async listTools(): Promise<McpToolRaw[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: McpToolRaw[];
    };
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /** `tools/call` — input is the JSON-string args the agent produced. */
  async callTool(tool: string, input: string, schema?: McpToolRaw): Promise<string> {
    const args = parseToolArgs(input, schema);
    const result = (await this.request('tools/call', {
      name: tool,
      arguments: args,
    })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
    // The core's observation classifier keys off "Error:" — keep that
    // prefix exact on flagged results.
    return result.isError ? `Error: ${text || 'mcp tool failed'}` : text;
  }

  /** Last stderr lines (diagnostics for a dead server). */
  diagnostics(): string {
    return this.stderrTail;
  }

  /** Non-panicking close: kill the child, fail remaining waiters. */
  stop(): void {
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.kill();
      } catch {
        // already gone — exit listener does the cleanup
      }
    }
    this.child = null;
  }
}

/** Map the agent's string input onto `tools/call` arguments. JSON
 *  objects pass through; a bare string wraps into the tool's single
 *  declared property (the ReAct agent favors a raw string there). */
export function parseToolArgs(input: string, schema?: McpToolRaw): unknown {
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to the bare-string handling
    }
  }
  const props = schema?.inputSchema?.properties;
  const keys = props ? Object.keys(props) : [];
  if (keys.length === 1) {
    return { [keys[0]]: input };
  }
  return { input };
}

/** One connected config: every server reachable, its tools listed. */
export interface McpSession {
  tools: AgentTool[];
  /** sanitized tool name → origin (the toolNameMap). */
  toolMap: Record<string, McpToolRef>;
  executor: ToolExecutor;
  stop(): void;
}

/** Connect to every configured server; individual failures are
 *  reported, not fatal (Cursor behaves the same: dead tools are absent,
 *  the rest of the session keeps working). */
export async function connectMcp(
  config?: McpConfig | null,
  opts?: { timeoutMs?: number },
): Promise<{ session: McpSession | null; errors: string[] }> {
  const loaded = config
    ? { config, path: '' }
    : loadMcpConfig();
  const errors: string[] = [];
  if (!loaded) {
    return { session: null, errors };
  }
  const servers: StdioMcpServer[] = [];
  const tools: AgentTool[] = [];
  const toolMap: Record<string, McpToolRef> = {};
  /** advertised name → connection + raw entry, for the executor. */
  const byAdvertised = new Map<
    string,
    { server: StdioMcpServer; raw: McpToolRaw }
  >();

  for (const [name, cfg] of Object.entries(loaded.config.mcpServers)) {
    const server = new StdioMcpServer(name, cfg, opts?.timeoutMs ?? 30_000);
    try {
      await server.start();
      const rawTools = await server.listTools();
      servers.push(server);
      for (const raw of rawTools) {
        // Advertised name: mcp__<server>__<tool>, always in the core's
        // tool-name class; collisions get a numeric suffix.
        let advertised = `mcp__${sanitizeToolPart(name)}__${sanitizeToolPart(raw.name)}`;
        while (toolMap[advertised]) {
          advertised = `${advertised}_2`;
        }
        toolMap[advertised] = { server: name, tool: raw.name };
        byAdvertised.set(advertised, { server, raw });
        tools.push({
          name: advertised,
          description: `MCP (${name}): ${raw.description ?? raw.name}`,
          parameters: raw.inputSchema?.properties ?? {},
        });
      }
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
      server.stop();
    }
  }
  if (servers.length === 0) {
    return { session: null, errors };
  }

  const executor: ToolExecutor = {
    async execute(toolName: string, input: string): Promise<string> {
      const hit = byAdvertised.get(toolName);
      if (!hit) {
        // The core's clamp classification keys off this exact phrasing.
        return `Tool "${toolName}" is not a recognized MCP tool.`;
      }
      if (!hit.server.alive) {
        return `Error: mcp server "${hit.server.name}" is not running`;
      }
      try {
        return await hit.server.callTool(hit.raw.name, input, hit.raw);
      } catch (err) {
        return `Error: mcp call failed: ${(err as Error).message}`;
      }
    },
  };

  return {
    session: {
      tools,
      toolMap,
      executor,
      stop() {
        for (const server of servers) {
          server.stop();
        }
      },
    },
    errors,
  };
}

// One connect per process: MCP servers are long-lived children, so
// respawning them per agent run would be the Cursor-unlike thing.
let cachedConnect: Promise<{ session: McpSession | null; errors: string[] }> | null =
  null;

/** Connect once and reuse the session for the process lifetime. */
export function mcpSessionOnce(): Promise<{
  session: McpSession | null;
  errors: string[];
}> {
  cachedConnect ??= connectMcp();
  return cachedConnect;
}
