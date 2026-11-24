import { systemClock, type Clock } from './clock.ts';
import { isForgeError } from './errors.ts';
import type { Result } from './result.ts';

/** Settings for the exponential backoff curve. */
export interface BackoffOptions {
  /** Delay cap before jitter for the first retry. Defaults to 100 ms. */
  readonly baseDelayMs?: number;
  /** Largest delay cap before jitter. Defaults to 10 000 ms. */
  readonly maxDelayMs?: number;
  /** Returns a number in [0, 1). Defaults to `Math.random`; inject it for tests. */
  readonly random?: () => number;
}

/** Details passed to {@link RetryOptions.onRetry} before each wait. */
export interface RetryInfo<E> {
  /** The attempt that just failed, starting at 1. */
  readonly attempt: number;
  /** How long the next wait will be. */
  readonly delayMs: number;
  readonly error: E;
}

/** Options for {@link retry}. */
export interface RetryOptions<E> extends BackoffOptions {
  /** Total attempts including the first. Defaults to 3. */
  readonly maxAttempts?: number;
  /**
   * Decides whether a failure is worth another attempt.
   * Defaults to retrying only `ForgeError`s whose code is retryable.
   */
  readonly shouldRetry?: (error: E, attempt: number) => boolean;
  /**
   * Longest `retryAfterMs` hint that is honoured. A failure asking for a longer
   * wait is returned instead of waited on. Defaults to 60 000 ms.
   */
  readonly maxRetryAfterMs?: number;
  /** Time source for waits. Defaults to the system clock. */
  readonly clock?: Clock;
  /**
   * Called before each wait, for logging. It is not called when no wait follows:
   * on success, when attempts run out, when `shouldRetry` returns false, or when a
   * `retryAfterMs` hint is longer than `maxRetryAfterMs`. An exception thrown here
   * propagates out of {@link retry}.
   */
  readonly onRetry?: (info: RetryInfo<E>) => void;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 60_000,
} as const;

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, got ${value}`);
  }
}

/**
 * Delay before retry number `retry` (1 for the first retry) using exponential
 * backoff with full jitter: `floor(cap * random())` where
 * `cap = min(maxDelayMs, baseDelayMs * 2^(retry-1))`, so the result is an integer
 * in `[0, cap]`. `random()` is clamped to [0, 1] and a non-finite value counts as 0,
 * so the result is always finite.
 */
export function backoffDelay(retry: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const random = options.random ?? Math.random;
  const growth = 2 ** Math.max(0, retry - 1);
  // Avoid 0 * Infinity (NaN) when the exponent overflows.
  const cap = base === 0 ? 0 : Math.min(max, base * growth);
  const sample = random();
  const r = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
  return Math.floor(cap * r);
}

/**
 * Reads a `retryAfterMs` hint from an error, such as the one a `ForgeError`
 * carries for rate limits. Returns `undefined` when there is no usable hint.
 */
export function retryAfterHint(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const hint = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof hint === 'number' && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
}

function defaultShouldRetry(error: unknown): boolean {
  return isForgeError(error) && error.retryable;
}

/**
 * Runs `fn` until it succeeds, a failure is not retryable, or attempts run out.
 * Waits between attempts with {@link backoffDelay}; when the error carries a
 * `retryAfterMs` hint, waits at least that long. Returns the last result.
 * `fn` returns a `Result`; a thrown error is a programmer error and is not retried.
 * Throws a `RangeError` for invalid options.
 */
export async function retry<T, E>(
  fn: (attempt: number) => Promise<Result<T, E>>,
  options: RetryOptions<E> = {},
): Promise<Result<T, E>> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer of at least 1, got ${maxAttempts}`);
  }
  assertNonNegative('baseDelayMs', options.baseDelayMs ?? DEFAULTS.baseDelayMs);
  assertNonNegative('maxDelayMs', options.maxDelayMs ?? DEFAULTS.maxDelayMs);
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULTS.maxRetryAfterMs;
  assertNonNegative('maxRetryAfterMs', maxRetryAfterMs);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const clock = options.clock ?? systemClock;

  for (let attempt = 1; ; attempt++) {
    const result = await fn(attempt);
    if (result.ok || attempt >= maxAttempts || !shouldRetry(result.error, attempt)) return result;

    const hint = retryAfterHint(result.error);
    if (hint !== undefined && hint > maxRetryAfterMs) return result;
    const backoff = backoffDelay(attempt, options);
    const delayMs = hint === undefined ? backoff : Math.max(hint, backoff);

    options.onRetry?.({ attempt, delayMs, error: result.error });
    await clock.sleep(delayMs);
  }
}
