import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForgeError } from '../util/errors.ts';
import { err, ok, type Result } from '../util/result.ts';

/** Header GitHub uses for the HMAC SHA-256 signature of a webhook body. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';

/** Why a signature check failed. Carried in `ForgeError.details.reason`. */
export type SignatureFailureReason = 'missing' | 'malformed' | 'mismatch';

/** A header value as Node's `IncomingHttpHeaders` may present it. */
export type HeaderValue = string | readonly string[] | null | undefined;

const PREFIX = 'sha256=';
const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;
/**
 * Longer than any valid header. Checked before any other parsing, so
 * surrounding whitespace counts towards it.
 */
const MAX_HEADER_LENGTH = 256;

/**
 * Verifies a GitHub webhook signature (`x-hub-signature-256`).
 *
 * `rawBody` must be the exact bytes GitHub sent, before any JSON parsing:
 * re-serialised JSON will not match. Pass the raw request as a `Uint8Array`
 * where you can. A string body is encoded as UTF-8, so it only matches if it
 * is the exact UTF-8 decoding of those bytes; a body decoded as latin1, or
 * with invalid sequences replaced, will not. The digests are compared with
 * `timingSafeEqual`.
 *
 * Returns `ok(true)` for a valid signature, otherwise an `UNAUTHORIZED`
 * error whose `details.reason` is `missing`, `malformed` or `mismatch`.
 * Throws a `TypeError` for an empty secret, since that is a setup bug.
 */
export function verifySignature(
  secret: string | Uint8Array,
  rawBody: string | Uint8Array,
  signatureHeader: HeaderValue,
): Result<true, ForgeError> {
  assertSecret(secret);
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed.ok) return parsed;
  const expected = digest(secret, rawBody);
  if (!timingSafeEqual(parsed.value, expected)) {
    return failure('mismatch', 'Webhook signature does not match the body.');
  }
  return ok(true);
}

/**
 * Computes the `x-hub-signature-256` value (`sha256=<hex>`) for a body.
 * Useful for tests and for local tools that replay deliveries.
 */
export function signBody(secret: string | Uint8Array, rawBody: string | Uint8Array): string {
  assertSecret(secret);
  return PREFIX + digest(secret, rawBody).toString('hex');
}

/** Parses `sha256=<64 hex chars>` into the 32 digest bytes. */
function parseSignatureHeader(header: HeaderValue): Result<Buffer, ForgeError> {
  if (header === undefined || header === null) {
    return failure('missing', `Missing ${SIGNATURE_HEADER} header.`);
  }
  if (Array.isArray(header)) {
    if (header.length === 0) return failure('missing', `Missing ${SIGNATURE_HEADER} header.`);
    if (header.length > 1) return failure('malformed', `Repeated ${SIGNATURE_HEADER} header.`);
    return parseSignatureHeader(header[0]);
  }
  if (typeof header !== 'string') {
    return failure('malformed', `${SIGNATURE_HEADER} header must be a string.`);
  }
  if (header.length > MAX_HEADER_LENGTH) {
    return failure('malformed', `${SIGNATURE_HEADER} header is too long.`);
  }
  const value = header.trim();
  if (value === '') return failure('missing', `Empty ${SIGNATURE_HEADER} header.`);
  if (!value.startsWith(PREFIX)) {
    return failure('malformed', `${SIGNATURE_HEADER} must start with "${PREFIX}".`);
  }
  const hex = value.slice(PREFIX.length);
  if (!HEX_DIGEST.test(hex)) {
    return failure('malformed', `${SIGNATURE_HEADER} must hold a 64-character hex digest.`);
  }
  return ok(Buffer.from(hex, 'hex'));
}

function digest(secret: string | Uint8Array, rawBody: string | Uint8Array): Buffer {
  return createHmac('sha256', secret).update(rawBody).digest();
}

function assertSecret(secret: string | Uint8Array): void {
  if (typeof secret === 'string' ? secret === '' : secret.byteLength === 0) {
    throw new TypeError('Webhook secret must not be empty.');
  }
}

function failure(reason: SignatureFailureReason, message: string): Result<never, ForgeError> {
  return err(new ForgeError('UNAUTHORIZED', message, { details: { reason } }));
}
