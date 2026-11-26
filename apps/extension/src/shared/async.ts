/**
 * Bounded promise helper for extension messaging.
 *
 * Chrome message channels can stay open forever when a listener returns
 * `true` without answering. A send must never wait on page context: a
 * missing context is worse than a short delay, but an unanswered channel
 * blocks the whole composer. Callers pass the value to use when the work
 * times out or rejects.
 */
export function withFallback<T>(
  work: () => Promise<T> | T,
  timeoutMs: number,
  fallback: T | (() => T),
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;

    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const fallbackValue = () =>
      typeof fallback === 'function' ? (fallback as () => T)() : fallback;

    const timer = setTimeout(() => finish(fallbackValue()), timeoutMs);

    Promise.resolve()
      .then(work)
      .then(finish, () => finish(fallbackValue()));
  });
}
