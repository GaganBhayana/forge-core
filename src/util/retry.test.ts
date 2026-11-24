import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from './clock.ts';
import { ForgeError } from './errors.ts';
import { err, ok, type Result } from './result.ts';
import { backoffDelay, retry, retryAfterHint, type RetryInfo } from './retry.ts';

const upstream = () => new ForgeError('UPSTREAM', 'server error');
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Returns a function that fails `failures` times with `makeError`, then succeeds. */
function failing<E>(failures: number, makeError: () => E) {
  const calls: number[] = [];
  const fn = async (attempt: number): Promise<Result<string, E>> => {
    calls.push(attempt);
    return calls.length > failures ? ok('done') : err(makeError());
  };
  return { fn, calls };
}

test('backoffDelay doubles the cap and stops at maxDelayMs', () => {
  const top = { baseDelayMs: 100, maxDelayMs: 1_000, random: () => 1 };
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, top)),
    [100, 200, 400, 800, 1_000, 1_000],
  );
});

test('backoffDelay applies full jitter across [0, cap]', () => {
  assert.equal(backoffDelay(3, { baseDelayMs: 100, random: () => 0 }), 0);
  assert.equal(backoffDelay(3, { baseDelayMs: 100, random: () => 0.5 }), 200);
  assert.equal(backoffDelay(3, { baseDelayMs: 100, random: () => 7 }), 400);
  assert.equal(backoffDelay(3, { baseDelayMs: 100, random: () => -1 }), 0);
});

test('retry succeeds on the first attempt without sleeping', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(0, upstream);
  assert.deepEqual(await retry(fn, { clock }), ok('done'));
  assert.deepEqual(calls, [1]);
  assert.deepEqual(clock.sleeps, []);
});

test('retry waits the backoff sequence between attempts', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(3, upstream);
  const seen: RetryInfo<ForgeError>[] = [];
  const result = await retry(fn, {
    clock,
    maxAttempts: 5,
    baseDelayMs: 100,
    random: () => 1,
    onRetry: (info) => seen.push(info),
  });
  assert.deepEqual(result, ok('done'));
  assert.deepEqual(calls, [1, 2, 3, 4]);
  assert.deepEqual(clock.sleeps, [100, 200, 400]);
  assert.equal(clock.now(), 700);
  assert.deepEqual(seen.map((s) => [s.attempt, s.delayMs]), [[1, 100], [2, 200], [3, 400]]);
});

test('retry does not call again before the delay has passed', async () => {
  const clock = new FakeClock();
  const { fn, calls } = failing(1, upstream);
  const pending = retry(fn, { clock, baseDelayMs: 100, random: () => 1 });
  await flush();
  assert.deepEqual(calls, [1]);
  clock.advance(99);
  await flush();
  assert.deepEqual(calls, [1]);
  clock.advance(1);
  assert.deepEqual(await pending, ok('done'));
  assert.deepEqual(calls, [1, 2]);
});

test('retry returns the last error when attempts run out', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(10, upstream);
  const result = await retry(fn, { clock, maxAttempts: 3, random: () => 1 });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(clock.sleeps.length, 2);
});

test('non-retryable errors stop immediately', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(5, () => new ForgeError('UNAUTHORIZED', 'bad token'));
  const result = await retry(fn, { clock, maxAttempts: 5 });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(clock.sleeps, []);
});

test('the default predicate does not retry plain errors or strings', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const plain = failing(5, () => new Error('boom'));
  await retry(plain.fn, { clock });
  assert.deepEqual(plain.calls, [1]);
  const text = failing(5, () => 'nope');
  await retry(text.fn, { clock });
  assert.deepEqual(text.calls, [1]);
});

test('a custom shouldRetry sees the error and attempt number', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(5, () => 'flaky');
  const asked: [string, number][] = [];
  const result = await retry(fn, {
    clock,
    maxAttempts: 10,
    shouldRetry: (error, attempt) => {
      asked.push([error, attempt]);
      return attempt < 2;
    },
  });
  assert.deepEqual(result, err('flaky'));
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(asked, [['flaky', 1], ['flaky', 2]]);
});

test('a retryAfterMs hint sets the minimum wait', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn } = failing(2, () => new ForgeError('RATE_LIMITED', 'slow down', { retryAfterMs: 5_000 }));
  const result = await retry(fn, { clock, random: () => 1 });
  assert.deepEqual(result, ok('done'));
  assert.deepEqual(clock.sleeps, [5_000, 5_000]);
});

test('backoff wins when it is longer than the hint', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn } = failing(1, () => new ForgeError('RATE_LIMITED', 'slow down', { retryAfterMs: 10 }));
  await retry(fn, { clock, baseDelayMs: 500, random: () => 1 });
  assert.deepEqual(clock.sleeps, [500]);
});

test('a hint longer than maxRetryAfterMs returns the error instead of waiting', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  const { fn, calls } = failing(1, () => new ForgeError('RATE_LIMITED', 'reset in an hour', { retryAfterMs: 3_600_000 }));
  const result = await retry(fn, { clock, maxRetryAfterMs: 60_000 });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(clock.sleeps, []);
});

test('retryAfterHint reads only usable numbers', () => {
  assert.equal(retryAfterHint(new ForgeError('RATE_LIMITED', 'x', { retryAfterMs: 250 })), 250);
  assert.equal(retryAfterHint({ retryAfterMs: 0 }), 0);
  assert.equal(retryAfterHint({ retryAfterMs: -5 }), undefined);
  assert.equal(retryAfterHint({ retryAfterMs: Number.NaN }), undefined);
  assert.equal(retryAfterHint({ retryAfterMs: '100' }), undefined);
  assert.equal(retryAfterHint('RATE_LIMITED'), undefined);
  assert.equal(retryAfterHint(null), undefined);
});

test('a thrown error is not retried', async () => {
  const clock = new FakeClock({ autoAdvance: true });
  let calls = 0;
  await assert.rejects(
    retry(async () => {
      calls++;
      throw new TypeError('bug');
    }, { clock }),
    TypeError,
  );
  assert.equal(calls, 1);
});

test('invalid options throw a RangeError', async () => {
  const { fn } = failing(0, upstream);
  await assert.rejects(retry(fn, { maxAttempts: 0 }), RangeError);
  await assert.rejects(retry(fn, { maxAttempts: 1.5 }), RangeError);
  await assert.rejects(retry(fn, { baseDelayMs: -1 }), RangeError);
  await assert.rejects(retry(fn, { maxDelayMs: Number.NaN }), RangeError);
  await assert.rejects(retry(fn, { maxRetryAfterMs: -1 }), RangeError);
});
