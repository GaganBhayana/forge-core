import { setTimeout as delay } from 'node:timers/promises';

/**
 * Source of time and waiting. Code that sleeps or reads the time takes a
 * `Clock` so tests can swap in a {@link FakeClock} and run instantly.
 */
export interface Clock {
  /** Current time in milliseconds since the Unix epoch. */
  now(): number;
  /** Resolves after `ms` milliseconds. Negative or non-finite values wait 0 ms. */
  sleep(ms: number): Promise<void>;
}

function toDelay(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** The real clock: `Date.now` and timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => delay(toDelay(ms)),
};

/** Options for {@link FakeClock}. */
export interface FakeClockOptions {
  /** Starting time in milliseconds. Defaults to 0. */
  readonly start?: number;
  /**
   * When true, `sleep` moves time forward by the requested amount and resolves
   * right away. When false (the default), sleepers wait for {@link FakeClock.advance}.
   */
  readonly autoAdvance?: boolean;
}

interface Sleeper {
  readonly wakeAt: number;
  readonly resolve: () => void;
}

/** A clock for tests. Time only moves when the test says so. */
export class FakeClock implements Clock {
  /** Every duration passed to `sleep`, in call order, after clamping. */
  readonly sleeps: number[] = [];
  #now: number;
  #autoAdvance: boolean;
  #sleepers: Sleeper[] = [];

  constructor(options: FakeClockOptions = {}) {
    this.#now = options.start ?? 0;
    this.#autoAdvance = options.autoAdvance ?? false;
  }

  now(): number {
    return this.#now;
  }

  sleep(ms: number): Promise<void> {
    const wait = toDelay(ms);
    this.sleeps.push(wait);
    if (this.#autoAdvance) {
      this.#now += wait;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#sleepers.push({ wakeAt: this.#now + wait, resolve });
    });
  }

  /** Number of sleeps still waiting. */
  get pending(): number {
    return this.#sleepers.length;
  }

  /**
   * Moves time forward by `ms` and wakes every sleeper that is now due,
   * earliest first. Throws a `RangeError` for a negative or non-finite `ms`.
   */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance expects a non-negative finite number, got ${ms}`);
    }
    this.#now += ms;
    const due = this.#sleepers.filter((s) => s.wakeAt <= this.#now).sort((a, b) => a.wakeAt - b.wakeAt);
    this.#sleepers = this.#sleepers.filter((s) => s.wakeAt > this.#now);
    for (const sleeper of due) sleeper.resolve();
  }
}
