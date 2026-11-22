import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, ForgeError, isForgeError } from './errors.ts';

test('ForgeError carries code, message, cause and details', () => {
  const cause = new Error('socket hang up');
  const error = new ForgeError('UPSTREAM', 'GitHub returned 502', { cause, details: { status: 502 } });
  assert.equal(error.name, 'ForgeError');
  assert.equal(error.code, 'UPSTREAM');
  assert.equal(error.message, 'GitHub returned 502');
  assert.equal(error.cause, cause);
  assert.deepEqual(error.details, { status: 502 });
  assert.ok(error instanceof Error);
});

test('defaults: no cause, empty details, no retry hint', () => {
  const error = new ForgeError('NOT_FOUND', 'missing');
  assert.equal(error.cause, undefined);
  assert.deepEqual(error.details, {});
  assert.equal(error.retryAfterMs, undefined);
});

test('retryable is true only for transient codes', () => {
  const retryable = ERROR_CODES.filter((code) => new ForgeError(code, 'x').retryable);
  assert.deepEqual(retryable, ['RATE_LIMITED', 'TIMEOUT', 'UPSTREAM']);
});

test('retryAfterMs is kept for rate limits', () => {
  const error = new ForgeError('RATE_LIMITED', 'slow down', { retryAfterMs: 30_000 });
  assert.equal(error.retryAfterMs, 30_000);
});

test('isForgeError checks type and optional code', () => {
  const error = new ForgeError('TIMEOUT', 'took too long');
  assert.equal(isForgeError(error), true);
  assert.equal(isForgeError(error, 'TIMEOUT'), true);
  assert.equal(isForgeError(error, 'NOT_FOUND'), false);
  assert.equal(isForgeError(new Error('plain')), false);
  assert.equal(isForgeError('TIMEOUT'), false);
});
