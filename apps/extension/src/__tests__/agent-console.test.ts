import { describe, expect, it } from '@jest/globals';
import {
  bindAgentConsole,
  classifyObservation,
  clampedToolCall,
  loadAgentConsole,
  repairToolCall,
  sandboxPosture,
} from '../chat/agentConsole';

/**
 * The agent console is the extension's view of the core's agent
 * surface. Every answer comes from the core wasm, so these tests drive
 * the real core: a browser cannot enforce Landlock, a node host can
 * plan for it.
 */
describe('agent console', () => {
  it('classifies a tool observation into the closed taxonomy', async () => {
    const console_ = await loadAgentConsole();

    const denied = console_.classifyObservation(
      '[read_file] Permission denied: filesystem access is not available.',
    );
    expect(denied.kind).toBe('permission_denied');
    expect(denied.isError).toBe(true);
    expect(denied.detail).toContain('blocked by policy');

    const clean = console_.classifyObservation('echo:hi');
    expect(clean.kind).toBe('none');
    expect(clean.isError).toBe(false);
    expect(clean.detail).toBeNull();
  });

  it('repairs a spilled tool argument', async () => {
    const console_ = await loadAgentConsole();

    const repaired = console_.repairToolCall('{"input": "src/lib.rs"}');
    expect(repaired.input).toBe('src/lib.rs');
    expect(repaired.repaired).toBe(true);
    expect(repaired.notes.join(' ')).toContain('envelope');

    const untouched = console_.repairToolCall('src/lib.rs');
    expect(untouched.input).toBe('src/lib.rs');
    expect(untouched.repaired).toBe(false);
  });

  it('clamps a tool that is not advertised', async () => {
    const console_ = await loadAgentConsole();

    const allowed = console_.clampToolCall(['calculator'], 'calculator');
    expect(allowed.allowed).toBe(true);

    const refused = console_.clampToolCall(['calculator'], 'shell_exec');
    expect(refused.allowed).toBe(false);
    expect(refused.error).toContain('tool_clamped');
    expect(refused.error).toContain('calculator');
  });

  it('lists the shipped subagents with their tool allowlists', async () => {
    const console_ = await loadAgentConsole();

    const specs = console_.listSubagents();
    const names = specs.map((s) => s.name);
    expect(names).toContain('explore');
    const explore = specs.find((s) => s.name === 'explore');
    expect(explore?.tool_allowlist.length).toBeGreaterThan(0);
  });

  it('resolves a subagent model in the forced order', async () => {
    const console_ = await loadAgentConsole();

    // The shipped specs carry no forced model: the session model wins.
    const session = console_.resolveSubagentModel('explore', 'session-model');
    expect(session?.resolution?.model).toBe('session-model');
    expect(session?.resolution?.tier).toBe('session');

    // Without a session model the provider default is the last tier.
    const fallback = console_.resolveSubagentModel(
      'bugbot',
      '',
      'provider-default',
    );
    expect(fallback?.resolution?.model).toBe('provider-default');
    expect(fallback?.resolution?.tier).toBe('provider_default');

    // Nothing to resolve: the console reports why.
    const unresolved = console_.resolveSubagentModel('bugbot', '', null);
    expect(unresolved?.resolution).toBeNull();
    expect(unresolved?.error).toBeTruthy();

    // An unknown subagent is not in the registry at all.
    expect(console_.resolveSubagentModel('ghost', 'session-model')).toBeNull();
  });

  it('badges the sandbox posture of a host plan', () => {
    const enforced = sandboxPosture(
      { mode: 'auto' },
      { ok: true, sandbox_used: 'landlock_seccomp' },
    );
    expect(enforced.backend).toBe('landlock_seccomp');
    expect(enforced.honoured).toBe(true);
    expect(enforced.tone).toBe('ok');

    const fallback = sandboxPosture(
      { mode: 'auto' },
      { ok: true, sandbox_used: 'unsandboxed_fallback' },
    );
    expect(fallback.backend).toBe('unsandboxed');
    expect(fallback.tone).toBe('warn');

    const refused = sandboxPosture(
      { mode: 'strict' },
      { ok: false, error: 'sandbox_unsupported' },
    );
    expect(refused.backend).toBe('unsupported');
    expect(refused.honoured).toBe(false);
    expect(refused.tone).toBe('error');
    expect(refused.reason).toBe('sandbox_unsupported');
  });

  it('plans a policy with the local core', async () => {
    const console_ = await loadAgentConsole();
    const plan = console_.planSandbox({ mode: 'strict' });
    // The plan is the answer; a host that cannot enforce says so.
    expect(typeof plan.ok).toBe('boolean');
  });

  it('binds the pure helpers to a core', async () => {
    const console_ = await loadAgentConsole();
    const rebound = bindAgentConsole(console_.core);
    expect(rebound.classifyObservation('echo:hi').kind).toBe('none');
    expect(classifyObservation(console_.core, 'echo:hi').kind).toBe('none');
    expect(repairToolCall(console_.core, '"a.txt"').input).toBe('a.txt');
    expect(clampedToolCall(console_.core, ['echo'], 'echo').allowed).toBe(true);
  });
});
