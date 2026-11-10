import { describe, expect, it, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  connectMcp,
  loadMcpConfig,
  mcpConfigPath,
  parseToolArgs,
  sanitizeToolPart,
  type McpSession,
} from '../mcp';

// Runs against a real node child acting as an MCP server (stdio).
const SERVER = path.join(__dirname, 'mcp-fake-server.mjs');

describe('tui mcp (stdio json-rpc client)', () => {
  const sessions: McpSession[] = [];
  const savedEnv: Record<string, string | undefined> = {
    PRISM_TUI_MCP_CONFIG: process.env.PRISM_TUI_MCP_CONFIG,
  };
  afterEach(() => {
    for (const s of sessions.splice(0)) {
      s.stop();
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  function configWith(extra: Record<string, unknown> = {}) {
    return {
      mcpServers: {
        calc: {
          command: process.execPath,
          args: [SERVER],
          ...(extra as object),
        },
      },
    };
  }

  it('sanitizes whole tool names into the core name class', () => {
    expect(sanitizeToolPart('Get-Weather!')).toBe('get_weather');
    expect(sanitizeToolPart('Boom!')).toBe('boom');
    expect(sanitizeToolPart('   ')).toBe('unnamed');
  });

  it('maps the agent bare-string input onto the declared argument', () => {
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArgs('hello', { inputSchema: { properties: { text: {} } } })).toEqual({
      text: 'hello',
    });
    expect(parseToolArgs('hello')).toEqual({ input: 'hello' });
  });

  it('loads the config from the override path and rejects junk', () => {
    const file = path.join(os.tmpdir(), `mcp-spec-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(configWith()));
    process.env.PRISM_TUI_MCP_CONFIG = file;
    expect(loadMcpConfig()?.config.mcpServers.calc.command).toBe(process.execPath);

    fs.writeFileSync(file, '{not json');
    expect(loadMcpConfig()).toBeNull();

    fs.writeFileSync(file, JSON.stringify({ mcpServers: {} }));
    expect(loadMcpConfig()).toBeNull();

    fs.writeFileSync(file, JSON.stringify({ mcpServers: { bad: { command: '   ' } } }));
    expect(loadMcpConfig()).toBeNull();

    fs.unlinkSync(file);
    // Without the override the path falls back to the core config root.
    delete process.env.PRISM_TUI_MCP_CONFIG;
    expect(mcpConfigPath()).not.toBe(file);
  });

  it('connects, lists sanitized tools and calls them on the child', async () => {
    const { session, errors } = await connectMcp(configWith());
    expect(errors).toEqual([]);
    expect(session).not.toBeNull();
    sessions.push(session!);

    const names = session!.tools.map((t) => t.name).sort();
    expect(names).toEqual(['mcp__calc__add', 'mcp__calc__boom', 'mcp__calc__echo']);
    expect(session!.toolMap['mcp__calc__echo']).toEqual({
      server: 'calc',
      tool: 'echo',
    });

    // JSON args pass through; a bare string wraps into the schema's
    // single declared property.
    expect(await session!.executor.execute('mcp__calc__add', '{"a":2,"b":3}')).toBe('5');
    expect(await session!.executor.execute('mcp__calc__echo', 'hi there')).toBe(
      'echo:{"text":"hi there"}',
    );
    // isError results reach the model under the core-classified prefix.
    expect(await session!.executor.execute('mcp__calc__echo', '{"text":"fail"}')).toBe(
      'Error: requested failure',
    );
    // An unmapped name fails closed in the same class the clamp uses.
    expect(await session!.executor.execute('mcp__calc__nope', 'x')).toContain(
      'is not a recognized MCP tool',
    );
  });

  it('keeps working when one configured server is dead on arrival', async () => {
    const config = {
      mcpServers: {
        ghost: {
          command: 'prism-tui-definitely-not-a-binary-xyz',
          args: [],
        },
        calc: { command: process.execPath, args: [SERVER] },
      },
    };
    const { session, errors } = await connectMcp(config);
    expect(errors.some((e) => e.startsWith('ghost:'))).toBe(true);
    expect(session).not.toBeNull();
    sessions.push(session!);
    // The surviving server's tools are all the session advertises.
    expect(session!.tools.every((t) => t.name.startsWith('mcp__calc__'))).toBe(true);
  });

  it('fails closed on a silent (hung) server — nothing is advertised', async () => {
    // A real child that never answers: init can only time out.
    const config = {
      mcpServers: {
        silent: { command: 'sleep', args: ['30'] },
      },
    };
    const { session, errors } = await connectMcp(config, { timeoutMs: 400 });
    expect(session).toBeNull();
    expect(errors[0]).toContain('silent');
  });
});
