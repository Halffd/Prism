import express from 'express';
import type * as http from 'http';
import { agentsRouter } from './agents.routes';

/** Tiny harness: the router under test on an ephemeral port. */
function listen(): Promise<{ server: http.Server; url: string }> {
  const a = express();
  a.use(express.json());
  a.use('/api/agents', agentsRouter);
  const server = a.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('ephemeral port failed');
  }
  return Promise.resolve({ server, url: `http://127.0.0.1:${address.port}/api/agents` });
}

async function post(base: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('agents.routes (prism-core wasm bindings)', () => {
  let server: http.Server | undefined;
  let base: string;
  beforeEach(async () => {
    const h = await listen();
    server = h.server;
    base = h.url;
  });
  afterEach(() => {
    server?.close();
  });

  it('GET /subagents lists the shipped registry with allowlists', async () => {
    const res = await fetch(`${base}/subagents`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const names = body.subagents.map((s: { name: string }) => s.name);
    expect(names).toContain('explore');
    expect(names).toContain('security-review');
    const explore = body.subagents.find((s: { name: string }) => s.name === 'explore');
    expect(explore.tool_allowlist.length).toBeGreaterThan(0);
  });

  it('POST /subagents/:name/model resolves in the documented order', async () => {
    const session = await (
      await post(base, '/subagents/explore/model', {
        session_model: 'premium',
        provider_default: 'prov-default',
      })
    ).json();
    expect(session.resolution.tier).toBe('session');

    const fallback = await (
      await post(base, '/subagents/bugbot/model', { provider_default: 'prov-default' })
    ).json();
    expect(fallback.resolution).toEqual({
      model: 'prov-default',
      tier: 'provider_default',
    });

    const unknown = await post(base, '/subagents/ghost/model', {});
    const body = await unknown.json();
    expect(unknown.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('POST /tools/repair normalises envelope-wrapped arguments', async () => {
    const repaired = await (
      await post(base, '/tools/repair', { input: '{"input": "/etc/hosts"}' })
    ).json();
    expect(repaired.input).toBe('/etc/hosts');
    expect(repaired.notes[0]).toContain('envelope');

    const clean = await (await post(base, '/tools/repair', { input: 'plain code path' })).json();
    expect(clean.input).toBe('plain code path');
    expect(clean.notes).toEqual([]);
  });

  it('POST /tools/repair rejects a non-string input', async () => {
    const res = await post(base, '/tools/repair', { input: 42 });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain('input (string)');
  });

  it('POST /tools/classify maps observation text to the closed taxonomy', async () => {
    const notFound = await (
      await post(base, '/tools/classify', {
        observation: '[read_file] Error: No such file or directory',
      })
    ).json();
    expect(notFound.kind).toBe('not_found');
    expect(notFound.detail).toContain('target missing');

    const clean = await (
      await post(base, '/tools/classify', { observation: 'echo:hi' })
    ).json();
    expect(clean.kind).toBe('none');
    expect(clean.detail).toBeNull();
  });

  it('POST /tools/clamp fails closed for a tool that is not advertised', async () => {
    const allowed = await post(base, '/tools/clamp', {
      advertised: ['calculator', 'read_file'],
      tool: 'calculator',
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).ok).toBe(true);

    const refused = await post(base, '/tools/clamp', {
      advertised: ['calculator', 'read_file'],
      tool: 'shell_exec',
    });
    const body = await refused.json();
    expect(refused.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('tool_clamped');
    expect(body.error).toContain('calculator');
  });

  it('POST /tools/clamp rejects a malformed request', async () => {
    const res = await post(base, '/tools/clamp', { advertised: 'calculator', tool: 'x' });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain('advertised');
  });

  it('POST /sandbox/preflight plans auto mode without spawning', async () => {
    const j = await (
      await post(base, '/sandbox/preflight', {
        mode: 'auto',
        network: { mode: 'blocked' },
      })
    ).json();
    // Deterministic: auto always plans (unsupported hosts degrade with
    // provenance, `unsandboxed_fallback` recorded).
    expect(j.success).toBe(true);
    expect(j.sandbox_used).toBe('unsandboxed_fallback');
  });

  it('POST /sandbox/preflight surfaces the closed outcome, even rejected', async () => {
    const j = await (await post(base, '/sandbox/preflight', { mode: 'strict' })).json();
    expect(j.success).toBe(true);
    expect(j.error).toBe('sandbox_unsupported');
  });
});
