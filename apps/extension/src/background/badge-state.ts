/**
 * Action badge state machine for the Prism extension.
 *
 * Ported from AI Blaze's badge handling: a small set of states drives the
 * action title, badge text and badge colour. The controller owns every
 * `chrome.action` call so the rest of the service worker only has to express
 * intent (`setState('busy')`) instead of manipulating browser APIs.
 *
 * All chrome calls are defensive: the service worker must never throw, and
 * the module has to stay safe under the jest-chrome mock where `chrome.action`
 * may be partially implemented.
 */

export type PrismBadgeState = 'idle' | 'busy' | 'transcribing' | 'disabled';

export interface BadgeSnapshot {
  state: PrismBadgeState;
  title: string;
  badgeText: string;
  badgeColor?: string;
  count?: number;
}

/**
 * Handle for the badge ticker. Named locally so the module does not publish a
 * `ReturnType<typeof setInterval>` contract.
 */
type BadgeTimer = ReturnType<typeof setInterval>;

export interface BadgeStateOptions {
  /** Number of in-flight operations; drives the live elapsed badge. */
  count?: number;
  /** Overrides the default title, e.g. to explain why the page is disabled. */
  title?: string;
}

/** Orange used by AI Blaze for in-flight work. */
const BUSY_BADGE_COLOR = '#fea44a';
const TRANSCIBING_BADGE_COLOR = '#d2e3fc';

const DEFAULT_TITLES: Record<PrismBadgeState, string> = {
  idle: 'Prism - Context AI Assistant',
  busy: 'Prism is working…',
  transcribing: 'Prism is transcribing your speech',
  disabled: 'Prism cannot run on this page',
};

/**
 * Pure projection of a state into the values the action button should show.
 */
export function badgeSnapshotFor(
  state: PrismBadgeState,
  options: BadgeStateOptions = {},
): BadgeSnapshot {
  const title = options.title ?? DEFAULT_TITLES[state];

  switch (state) {
    case 'busy': {
      const count = Math.max(0, options.count ?? 1);
      return {
        state,
        title,
        badgeText: count > 1 ? `x${count}` : '',
        badgeColor: BUSY_BADGE_COLOR,
        count,
      };
    }
    case 'transcribing':
      return {
        state,
        title,
        badgeText: '🎤',
        badgeColor: TRANSCIBING_BADGE_COLOR,
      };
    case 'disabled':
      return {
        state,
        title,
        badgeText: '',
      };
    case 'idle':
    default:
      return {
        state: 'idle',
        title,
        badgeText: '',
      };
  }
}

/** Minimal shape of the action APIs this controller uses. */
interface ActionApi {
  setTitle?: (details: { title: string }) => unknown;
  setBadgeText?: (details: { text: string }) => unknown;
  setBadgeBackgroundColor?: (details: { color: string }) => unknown;
  setIcon?: (details: { path: string | Record<string, string> }) => unknown;
}

/**
 * Owns the chrome.action calls for the badge.
 *
 * Redundant writes are skipped so a busy state does not spam the browser
 * with identical `setBadgeText` calls every tick.
 */
export class BadgeController {
  private snapshot: BadgeSnapshot | null = null;
  private timer: BadgeTimer | null = null;
  private startedAt: number | null = null;
  private runningCount = 0;
  private action: ActionApi | null;

  constructor(action?: ActionApi | null) {
    this.action =
      action ??
      (typeof chrome !== 'undefined' && chrome.action
        ? (chrome.action as unknown as ActionApi)
        : null);
  }

  /**
   * Applies a state. Repeated calls with the same snapshot are ignored.
   */
  setState(state: PrismBadgeState, options: BadgeStateOptions = {}): void {
    if (state === 'busy') {
      // The busy state owns a live ticker, so it always goes through
      // setRunningCount; otherwise the same transition would be applied
      // twice and the redundant-write guard below would never fire.
      this.setRunningCount(options.count ?? Math.max(1, this.runningCount));
      return;
    }

    if (this.runningCount > 0) {
      this.stopTimer();
      this.runningCount = 0;
      this.startedAt = null;
    }

    const snapshot = badgeSnapshotFor(state, options);

    if (this.snapshot && this.isSameSnapshot(this.snapshot, snapshot)) {
      return;
    }

    this.snapshot = snapshot;
    this.apply(snapshot);
  }

  /**
   * Sets the number of in-flight operations. While the count is above zero a
   * single interval drives a live elapsed-seconds badge.
   */
  setRunningCount(count: number): void {
    const next = Math.max(0, count);
    const wasRunning = this.runningCount > 0;

    this.runningCount = next;

    if (next === 0) {
      this.stopTimer();
      this.startedAt = null;
      this.setState('idle');
      return;
    }

    if (!wasRunning) {
      this.startedAt = Date.now();
    }

    const snapshot = badgeSnapshotFor('busy', { count: next });
    if (!this.snapshot || !this.isSameSnapshot(this.snapshot, snapshot)) {
      this.snapshot = snapshot;
      this.apply(snapshot);
    }

    this.startTimer();
  }

  /** Resets the badge to its idle appearance and stops any timer. */
  clear(): void {
    this.stopTimer();
    this.runningCount = 0;
    this.startedAt = null;
    this.snapshot = null;
    this.apply(badgeSnapshotFor('idle'));
  }

  /** Exposed for tests and for the service worker's own bookkeeping. */
  getSnapshot(): BadgeSnapshot | null {
    return this.snapshot;
  }

  private isSameSnapshot(a: BadgeSnapshot, b: BadgeSnapshot): boolean {
    return (
      a.state === b.state &&
      a.title === b.title &&
      a.badgeText === b.badgeText &&
      a.badgeColor === b.badgeColor &&
      a.count === b.count
    );
  }

  private startTimer(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      const elapsed = this.startedAt === null ? 0 : Date.now() - this.startedAt;
      const seconds = Math.floor(elapsed / 1000);
      const text =
        this.runningCount > 1 ? `x${this.runningCount}` : `${seconds}s`;

      if (this.snapshot && this.snapshot.badgeText === text) {
        return;
      }

      const snapshot: BadgeSnapshot = {
        state: 'busy',
        title: this.snapshot?.title ?? DEFAULT_TITLES.busy,
        badgeText: text,
        badgeColor: BUSY_BADGE_COLOR,
        count: this.runningCount,
      };
      this.snapshot = snapshot;
      this.apply(snapshot);
    }, 1000);

    // Node keeps the event loop alive for pending timers; unref so the
    // service worker (and jest) are not held open by the badge ticker.
    const timer = this.timer as unknown as { unref?: () => void };
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Pushes a snapshot to the action button. Every call is individually
   * guarded so a missing or failing browser API cannot break the worker.
   */
  private apply(snapshot: BadgeSnapshot): void {
    const action = this.action;
    if (!action) {
      return;
    }

    this.safeCall(() => action.setTitle?.({ title: snapshot.title }));
    this.safeCall(() => action.setBadgeText?.({ text: snapshot.badgeText }));

    const badgeColor = snapshot.badgeColor;
    if (badgeColor) {
      this.safeCall(() =>
        action.setBadgeBackgroundColor?.({ color: badgeColor }),
      );
    }
  }

  private safeCall(fn: () => unknown): void {
    try {
      const result = fn();
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => {
          /* the action API rejected; the badge is cosmetic */
        });
      }
    } catch {
      /* the action API is unavailable or rejected; the badge is cosmetic */
    }
  }
}
