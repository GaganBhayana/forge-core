import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock, systemClock } from './clock.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('systemClock reads real time and sleeps', async () => {
  const before = systemClock.now();
  await systemClock.sleep(5);
  assert.ok(systemClock.now() >= before);
  await systemClock.sleep(-10);
  await systemClock.sleep(Number.NaN);
});

test('FakeClock starts at the given time and only moves on advance', () => {
  const clock = new FakeClock({ start: 1_000 });
  assert.equal(clock.now(), 1_000);
  clock.advance(250);
  assert.equal(clock.now(), 1_250);
});

test('FakeClock sleepers wake only once their time has come', async () => {
  const clock = new FakeClock();
  const woke: string[] = [];
  void clock.sleep(100).then(() => woke.push('a'));
  void clock.sleep(50).then(() => woke.push('b'));
  assert.equal(clock.pending, 2);

  clock.advance(49);
  await flush();
  assert.deepEqual(woke, []);

  clock.advance(1);
  await flush();
  assert.deepEqual(woke, ['b']);

  clock.advance(1_000);
  await flush();
  assert.deepEqual(woke, ['b', 'a']);
  assert.equal(clock.pending, 0);
});

test('FakeClock wakes several due sleepers earliest first', async () => {
  const clock = new FakeClock();
  const woke: number[] = [];
  for (const ms of [30, 10, 20]) void clock.sleep(ms).then(() => woke.push(ms));
  clock.advance(30);
  await flush();
  assert.deepEqual(woke, [10, 20, 30]);
});

test('FakeClock autoAdvance resolves at once and moves time', async () => {
  const clock = new FakeClock({ start: 5, autoAdvance: true });
  await clock.sleep(100);
  await clock.sleep(-3);
  assert.equal(clock.now(), 105);
  assert.deepEqual(clock.sleeps, [100, 0]);
  assert.equal(clock.pending, 0);
});

test('FakeClock.advance rejects negative and non-finite values', () => {
  const clock = new FakeClock();
  assert.throws(() => clock.advance(-1), RangeError);
  assert.throws(() => clock.advance(Number.POSITIVE_INFINITY), RangeError);
});
