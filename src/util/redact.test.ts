import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForgeError } from './errors.ts';
import { REDACTED, isSensitiveKey, redact, redactString } from './redact.ts';

const GHP = `ghp_${'a1B2'.repeat(9)}`;
const GHS = `ghs_${'Z9y8'.repeat(9)}`;
const PAT = `github_pat_${'11AAAA_bbbb'.repeat(4)}`;
const SK = `sk-ant-${'x7Y'.repeat(10)}`;

test('sensitive keys match by ending or exact name, ignoring case, - and _', () => {
  for (const key of ['token', 'accessToken', 'client_secret', 'PASSWORD', 'apiKey', 'x-api-key', 'Authorization', 'cookie', 'private_key']) {
    assert.equal(isSensitiveKey(key), true, key);
  }
  for (const key of ['maxTokens', 'inputTokens', 'tokenCount', 'author', 'user', 'keyId']) {
    assert.equal(isSensitiveKey(key), false, key);
  }
});

test('redactString masks GitHub tokens and sk- keys inside surrounding text', () => {
  assert.equal(redactString(`using ${GHP} now`), `using ${REDACTED} now`);
  assert.equal(redactString(`${GHS},${PAT}`), `${REDACTED},${REDACTED}`);
  assert.equal(redactString(`key=${SK}`), `key=${REDACTED}`);
});

test('redactString leaves short or look-alike text alone', () => {
  for (const text of ['ghp_short', 'risk-free', 'sk-1', 'task-management-tool', 'the ghp_ prefix']) {
    assert.equal(redactString(text), text);
  }
});

test('redact masks sensitive keys in nested objects and arrays', () => {
  const input = {
    user: 'octocat',
    headers: { Authorization: 'Bearer abc', accept: 'application/json' },
    installs: [{ id: 1, token: 'plain-value' }, { id: 2, nested: { clientSecret: 's3' } }],
    note: `leaked ${GHP}`,
    list: ['ok', SK],
    usage: { inputTokens: 120, maxTokens: 4000 },
  };
  assert.deepEqual(redact(input), {
    user: 'octocat',
    headers: { Authorization: REDACTED, accept: 'application/json' },
    installs: [{ id: 1, token: REDACTED }, { id: 2, nested: { clientSecret: REDACTED } }],
    note: `leaked ${REDACTED}`,
    list: ['ok', REDACTED],
    usage: { inputTokens: 120, maxTokens: 4000 },
  });
});

test('redact masks a whole object or array under a sensitive key', () => {
  assert.deepEqual(redact({ secret: { a: 1 }, tokens: undefined, password: ['x'] }), {
    secret: REDACTED,
    tokens: undefined,
    password: REDACTED,
  });
});

test('redact does not mutate its input', () => {
  const input = { token: 't', inner: { password: 'p' } };
  redact(input);
  assert.deepEqual(input, { token: 't', inner: { password: 'p' } });
});

test('redact handles cycles, shared references, errors, dates and bigint', () => {
  const shared = { n: 1 };
  const loop: Record<string, unknown> = { shared, again: shared };
  loop['self'] = loop;
  assert.deepEqual(redact(loop), { shared: { n: 1 }, again: { n: 1 }, self: '[Circular]' });

  assert.deepEqual(redact(new Error(`bad ${GHP}`)), { name: 'Error', message: `bad ${REDACTED}` });
  const forge = new ForgeError('UNAUTHORIZED', 'denied', { cause: { token: GHP }, details: { apiKey: 'k' } });
  assert.deepEqual(redact(forge), { name: 'ForgeError', code: 'UNAUTHORIZED', message: 'denied', details: { apiKey: REDACTED } });

  assert.equal(redact(new Date(0)), '1970-01-01T00:00:00.000Z');
  assert.equal(redact(12n), '12');
  assert.equal(redact(null), null);
});

test('redact stops at a depth limit instead of overflowing the stack', () => {
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 100; i += 1) deep = { next: deep };
  const text = JSON.stringify(redact(deep));
  assert.match(text, /\[MaxDepth\]/);
});
