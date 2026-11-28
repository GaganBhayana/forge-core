import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForgeError } from '../util/errors.ts';
import type { Result } from '../util/result.ts';
import type { ForgeError } from '../util/errors.ts';
import { SIGNATURE_HEADER, signBody, verifySignature, type HeaderValue } from './webhook.ts';

// The example from GitHub's "Validating webhook deliveries" docs.
const SECRET = "It's a Secret to Everybody";
const BODY = 'Hello, World!';
const SIGNATURE = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

function reasonOf(result: Result<true, ForgeError>): unknown {
  assert.equal(result.ok, false);
  if (result.ok) return undefined;
  assert.ok(isForgeError(result.error, 'UNAUTHORIZED'));
  return result.error.details['reason'];
}

test('accepts the documented GitHub example', () => {
  assert.deepEqual(verifySignature(SECRET, BODY, SIGNATURE), { ok: true, value: true });
});

test('accepts the same body as bytes, a byte secret and an uppercase digest', () => {
  const bytes = new TextEncoder().encode(BODY);
  const secretBytes = new TextEncoder().encode(SECRET);
  assert.equal(verifySignature(secretBytes, bytes, SIGNATURE).ok, true);
  assert.equal(verifySignature(SECRET, BODY, 'sha256=' + SIGNATURE.slice(7).toUpperCase()).ok, true);
});

test('accepts a single-element header array and surrounding whitespace', () => {
  assert.equal(verifySignature(SECRET, BODY, [SIGNATURE]).ok, true);
  assert.equal(verifySignature(SECRET, BODY, `  ${SIGNATURE}\t`).ok, true);
});

test('signBody produces the documented signature', () => {
  assert.equal(signBody(SECRET, BODY), SIGNATURE);
});

test('rejects a tampered body', () => {
  assert.equal(reasonOf(verifySignature(SECRET, 'Hello, World?', SIGNATURE)), 'mismatch');
  assert.equal(reasonOf(verifySignature(SECRET, BODY + '\n', SIGNATURE)), 'mismatch');
});

test('rejects a wrong secret', () => {
  assert.equal(reasonOf(verifySignature('not the secret', BODY, SIGNATURE)), 'mismatch');
});

test('rejects a body that was re-serialised after parsing', () => {
  const raw = '{"action": "opened", "number": 1}';
  const header = signBody(SECRET, raw);
  assert.equal(verifySignature(SECRET, raw, header).ok, true);
  assert.equal(reasonOf(verifySignature(SECRET, JSON.stringify(JSON.parse(raw)), header)), 'mismatch');
});

test('reports a missing header', () => {
  const missing: HeaderValue[] = [undefined, null, '', '   ', []];
  for (const header of missing) {
    assert.equal(reasonOf(verifySignature(SECRET, BODY, header)), 'missing', String(header));
  }
});

test('reports malformed headers', () => {
  const hex = SIGNATURE.slice('sha256='.length);
  const malformed: HeaderValue[] = [
    hex, // no prefix
    'sha1=' + hex.slice(0, 40), // legacy x-hub-signature value
    'SHA256=' + hex, // prefix is case-sensitive
    'sha256=', // empty digest
    'sha256=' + hex.slice(0, 63), // one char short
    'sha256=' + hex + '0', // one char long
    'sha256=' + hex.slice(0, 62) + 'zz', // not hex
    'sha256= ' + hex, // space inside
    'sha256=' + hex + ',sha256=' + hex, // two values joined
    [SIGNATURE, SIGNATURE], // repeated header
    'sha256=' + 'a'.repeat(10_000), // very long
  ];
  for (const header of malformed) {
    assert.equal(reasonOf(verifySignature(SECRET, BODY, header)), 'malformed', String(header).slice(0, 80));
  }
});

test('error messages name the header and never echo the secret', () => {
  const result = verifySignature(SECRET, BODY, 'sha256=nope');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, new RegExp(SIGNATURE_HEADER));
  assert.doesNotMatch(JSON.stringify(result.error.toJSON()), /Secret to Everybody/);
});

test('an empty secret is a programmer error', () => {
  assert.throws(() => verifySignature('', BODY, SIGNATURE), TypeError);
  assert.throws(() => verifySignature(new Uint8Array(0), BODY, SIGNATURE), TypeError);
  assert.throws(() => signBody('', BODY), TypeError);
});

test('verifies an empty body', () => {
  assert.equal(verifySignature(SECRET, '', signBody(SECRET, '')).ok, true);
  assert.equal(reasonOf(verifySignature(SECRET, '', SIGNATURE)), 'mismatch');
});
