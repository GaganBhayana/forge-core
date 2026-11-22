/**
 * A value that is either a success (`ok: true`) or an expected failure (`ok: false`).
 * Use it for validation, parsing and remote calls; throw only for programmer errors.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** The success branch of a {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure branch of a {@link Result}. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Wraps a value as a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an error as a failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** True when the result is a success. Narrows the type. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** True when the result is a failure. Narrows the type. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforms the success value; failures pass through unchanged. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transforms the error; successes pass through unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chains a step that can itself fail. Stops at the first failure. */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

/** Returns the success value, or `fallback` for a failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Collects an array of results into one: all values on success,
 * or the first failure in input order.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Runs an async function and captures a thrown value as a failure.
 * Use at boundaries where third-party code may throw.
 */
export async function fromPromise<T>(run: () => Promise<T>): Promise<Result<T, unknown>> {
  try {
    return ok(await run());
  } catch (error) {
    return err(error);
  }
}
