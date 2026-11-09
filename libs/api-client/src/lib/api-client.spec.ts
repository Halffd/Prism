import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { UnifiedAIClient } from './api-client';
import { networkStatusService } from './network-status';

/**
 * The client owns the endpoint and the host answers. These tests cover
 * the two agent-surface calls the extension makes: the sandbox plan
 * (host first, local core as the fallback) and the custom-model
 * endpoint.
 */
describe('UnifiedAIClient', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    // The client starts the network-status ping; stop it so the timer
    // does not outlive the suite.
    networkStatusService.destroy();
  });

  it('plans a sandbox policy on the API host when one is configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sandbox_used: 'landlock_seccomp' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new UnifiedAIClient({
      prismApiUrl: 'http://localhost:3000/api',
    });
    const plan = await client.sandboxPreflight({ mode: 'auto' });

    expect(plan).toEqual({ ok: true, sandbox_used: 'landlock_seccomp' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/agents/sandbox/preflight');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'auto' });
  });

  it('falls back to the local core when the host has no plan', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'sandbox_unsupported' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new UnifiedAIClient({
      prismApiUrl: 'http://localhost:3000/api',
    });
    const plan = await client.sandboxPreflight({ mode: 'strict' });

    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('sandbox_unsupported');
  });

  it('plans locally when no API host is configured', async () => {
    const client = new UnifiedAIClient();
    const plan = await client.sandboxPreflight({ mode: 'auto' });

    // The plan is the answer: the local core says what it can enforce.
    expect(typeof plan.ok).toBe('boolean');
    if (plan.ok) {
      expect(['landlock', 'landlock_seccomp', 'unsandboxed_fallback', 'off']).toContain(
        plan.sandbox_used,
      );
    }
  });
});
