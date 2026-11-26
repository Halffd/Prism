import { withFallback } from '../shared/async';

describe('withFallback', () => {
  it('returns the resolved value', async () => {
    const result = await withFallback(async () => 'ready', 100, 'fallback');
    expect(result).toBe('ready');
  });

  it('uses the fallback when the work rejects', async () => {
    const result = await withFallback(
      async () => {
        throw new Error('no receiver');
      },
      100,
      'fallback',
    );
    expect(result).toBe('fallback');
  });

  it('uses the fallback when a message channel never answers', async () => {
    const result = await withFallback(
      () => new Promise<string>(() => {}),
      10,
      () => 'timed-out',
    );
    expect(result).toBe('timed-out');
  });
});
