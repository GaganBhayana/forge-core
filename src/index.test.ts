import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from './index.ts';

test('exports a semver version string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('exposes the github namespace', async () => {
  const forge = await import('./index.ts');
  assert.equal(typeof forge.github.verifySignature, 'function');
  assert.equal(forge.github.SIGNATURE_HEADER, 'x-hub-signature-256');
});
