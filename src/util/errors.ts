/** Machine-readable error codes shared by every forge-core module. */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM',
  'BUDGET_EXCEEDED',
] as const;

/** One of {@link ERROR_CODES}. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Optional details attached to a {@link ForgeError}. */
export interface ForgeErrorOptions {
  /** The underlying error, if any. */
  readonly cause?: unknown;
  /** Hint for retry logic, for example from a `retry-after` header. */
  readonly retryAfterMs?: number;
  /** Extra structured context for logs. Never put secrets here. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Base error for expected failures, carried inside a `Result`. */
export class ForgeError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | undefined;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: ForgeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ForgeError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details ?? {};
  }

  /** True for codes where a later retry may succeed. */
  get retryable(): boolean {
    return this.code === 'RATE_LIMITED' || this.code === 'TIMEOUT' || this.code === 'UPSTREAM';
  }
}

/** Type guard for {@link ForgeError}, optionally checking the code. */
export function isForgeError(value: unknown, code?: ErrorCode): value is ForgeError {
  return value instanceof ForgeError && (code === undefined || value.code === code);
}
