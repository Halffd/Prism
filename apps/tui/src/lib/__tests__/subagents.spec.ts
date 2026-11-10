import { describe, expect, it, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mcpConfigPath } from '../mcp';
import { subagentRegistry, subagentTools } from '../background-agents';

/**
 * The registry plus tool clamp run through the real wasm core — the
 * same SubagentRegistry the daemon and extension consult.
 */
describe('tui subagents (core registry parity)', () => {
  const saved = process.env.PRISM_TUI_MCP_CONFIG;
  let file: string | null = null;

  afterEach(() => {
    if (file) {
      fs.rmSync(file, { force: true });
      file = null;
    }
    if (saved === undefined) {
      delete process.env.PRISM_TUI_MCP_CONFIG;
    } else {
      process.env.PRISM_TUI_MCP_CONFIG = saved;
    }
  });

  function configFile(content: unknown): void {
    file = path.join(os.tmpdir(), `subagent-spec-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(content));
    process.env.PRISM_TUI_MCP_CONFIG = file;
    expect(mcpConfigPath()).toBe(file);
  }

  it('serves the shipped registry when no config exists', async () => {
    delete process.env.PRISM_TUI_MCP_CONFIG;
    const { specs, errors } = await subagentRegistry();
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.name).sort()).toEqual([
      'browser-use',
      'bugbot',
      'ci-investigation',
      'explore',
      'security-review',
      'shell-ops',
    ]);
  });

  it('upserts custom specs from the config file (same file as MCP)', async () => {
    configFile({
      mcpServers: { calc: { command: 'true' } },
      subagents: [
        {
          name: 'tui-scout',
          description: 'Quick TUI-side scout',
          tool_allowlist: ['read_file'],
        },
        // same name replaces the shipped entry (core upsert semantics)
        {
          name: 'explore',
          description: 'TUI-tuned explorer',
          forced_model: 'cheap-fast-model',
          tool_allowlist: [],
        },
      ],
    });
    const { specs, errors } = await subagentRegistry();
    expect(errors).toEqual([]);
    const scout = specs.find((s) => s.name === 'tui-scout');
    expect(scout).toEqual({
      name: 'tui-scout',
      description: 'Quick TUI-side scout',
      forced_model: null,
      tool_allowlist: ['read_file'],
    });
    expect(specs.find((s) => s.name === 'explore')?.description).toBe(
      'TUI-tuned explorer',
    );
    expect(specs.find((s) => s.name === 'explore')?.forced_model).toBe(
      'cheap-fast-model',
    );
  });

  it('rejects invalid custom entries without dropping the ship set', async () => {
    configFile({
      subagents: [
        { name: 'Bad Name!', description: 'x' },
        { name: 'ok-name' },
        { name: 'bad-allow', description: 'x', tool_allowlist: 'nope' },
        { name: 'ok2', description: 'fine' },
      ],
    });
    const { specs, errors } = await subagentRegistry();
    expect(errors).toHaveLength(3);
    expect(specs.some((s) => s.name === 'ok2')).toBe(true);
    expect(specs.some((s) => s.name === 'Bad Name!')).toBe(false);
    // The shipped six are untouched by the junk.
    expect(specs.some((s) => s.name === 'explore')).toBe(true);
  });

  it('clamps a subagent surface through the real core wasm', async () => {
    // The node surface: NODE_TOOLS names.
    const exploreTools = await subagentTools('explore');
    expect(exploreTools.map((t) => t.name).sort()).toEqual([
      'calculator',
      'read_file',
    ]);
    // An empty allowlist means the full host surface.
    const browserTools = await subagentTools('browser-use');
    expect(browserTools).toHaveLength(6);
    // Unknown name fails via the core's error path.
    await expect(subagentTools('no-such-agent')).rejects.toThrow(
      'unknown subagent',
    );
  });
});
