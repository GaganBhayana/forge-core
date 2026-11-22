import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, andThen, err, fromPromise, isErr, isOk, map, mapErr, ok, unwrapOr, type Result } from './result.ts';

const parseIntResult = (text: string): Result<number, string> => {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? err(`not a number: ${text}`) : ok(value);
};

test('ok and err build the two branches', () => {
  assert.deepEqual(ok(1), { ok: true, value: 1 });
  assert.deepEqual(err('x'), { ok: false, error: 'x' });
});

test('isOk and isErr narrow correctly', () => {
  const good: Result<number, string> = ok(2);
  const bad: Result<number, string> = err('boom');
  assert.equal(isOk(good), true);
  assert.equal(isErr(good), false);
  assert.equal(isOk(bad), false);
  assert.equal(isErr(bad), true);
});

test('map transforms values and leaves errors alone', () => {
  assert.deepEqual(map(ok(2), (n: number) => n * 10), ok(20));
  const failed: Result<number, string> = err('no');
  assert.deepEqual(map(failed, (n: number) => n * 10), err('no'));
});

test('mapErr transforms errors and leaves values alone', () => {
  assert.deepEqual(mapErr(err('no'), (e: string) => e.toUpperCase()), err('NO'));
  assert.deepEqual(mapErr(ok(1), (e: string) => e.toUpperCase()), ok(1));
});

test('andThen chains steps and stops at the first error', () => {
  assert.deepEqual(andThen(ok('41'), parseIntResult), ok(41));
  assert.deepEqual(andThen(ok('abc'), parseIntResult), err('not a number: abc'));
  let called = false;
  const earlier: Result<string, string> = err('earlier failure');
  const chained = andThen(earlier, (text: string) => {
    called = true;
    return parseIntResult(text);
  });
  assert.deepEqual(chained, err('earlier failure'));
  assert.equal(called, false);
});

test('unwrapOr returns the value or the fallback', () => {
  assert.equal(unwrapOr(ok(5), 0), 5);
  assert.equal(unwrapOr(err('x'), 0), 0);
});

test('all collects values or returns the first error in order', () => {
  assert.deepEqual(all([ok(1), ok(2), ok(3)]), ok([1, 2, 3]));
  assert.deepEqual(all([ok(1), err('first'), err('second')]), err('first'));
  assert.deepEqual(all([]), ok([]));
});

test('fromPromise captures resolved values and thrown errors', async () => {
  assert.deepEqual(await fromPromise(async () => 7), ok(7));
  const boom = new Error('boom');
  const result = await fromPromise(async () => {
    throw boom;
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error, boom);
});
