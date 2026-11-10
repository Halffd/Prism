import { describe, expect, it } from '@jest/globals';
import {
  BackgroundAgentManager,
  jobLine,
  type BackgroundRunner,
} from '../background-agents';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Poll until the condition holds (bounded); jest has no vi.waitFor. */
async function waitUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('tui background agents', () => {
  it('flows queued → running → done and notifies each step', async () => {
    const gate = deferred<{ ok: boolean; answer?: string }>();
    const runner: BackgroundRunner = () => gate.promise;
    const manager = new BackgroundAgentManager(runner);
    const statuses: string[] = [];
    manager.subscribe((job) => statuses.push(`${job.specName}:${job.status}`));

    const job = manager.spawn('explore', 'map the crates');
    expect(job.id).toMatch(/^bg_[0-9a-f]+_[0-9a-f]+$/);
    expect(job.status).toBe('queued');
    expect(statuses).toEqual(['explore:queued']);

    await waitUntil(() => job.status === 'running');
    expect(statuses).toEqual(['explore:queued', 'explore:running']);

    gate.resolve({ ok: true, answer: '3 crates, 1 bin' });
    await waitUntil(() => job.status === 'done');
    expect(job.answer).toBe('3 crates, 1 bin');
    expect(statuses).toEqual([
      'explore:queued',
      'explore:running',
      'explore:done',
    ]);
    expect(job.finishedAt).toBeGreaterThan(0);
  });

  it('reports failures as failed with the runner error', async () => {
    const runner: BackgroundRunner = async () => ({
      ok: false,
      error: 'model unavailable',
    });
    const manager = new BackgroundAgentManager(runner);
    const job = manager.spawn('bugbot', 'triage the report');
    await waitUntil(() => job.status === 'failed');
    expect(job.error).toBe('model unavailable');
    expect(jobLine(job)).toContain('failed');
  });

  it('catches runner exceptions as failures', async () => {
    const runner: BackgroundRunner = async () => {
      throw new Error('llm exploded');
    };
    const manager = new BackgroundAgentManager(runner);
    const job = manager.spawn('shell-ops', 'x');
    await waitUntil(() => job.status === 'failed');
    expect(job.error).toBe('llm exploded');
  });

  it('unsubscribes cleanly and serves list/get/latestFor', async () => {
    const runner: BackgroundRunner = async () => ({ ok: true, answer: 'a' });
    const manager = new BackgroundAgentManager(runner);
    const seen: string[] = [];
    const unsubscribe = manager.subscribe((job) => seen.push(job.id));
    unsubscribe();

    const job = manager.spawn('explore', 't');
    await waitUntil(() => job.status === 'done');
    expect(seen).toEqual([]);
    expect(manager.list()).toHaveLength(1);
    expect(manager.get(job.id)?.specName).toBe('explore');
    expect(manager.get('missing')).toBeUndefined();
    expect(manager.latestFor('explore')?.id).toBe(job.id);
    expect(manager.latestFor('shell-ops')).toBeUndefined();
  });
});
