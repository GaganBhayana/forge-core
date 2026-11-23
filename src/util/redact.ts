/** Placeholder written in place of a secret. */
export const REDACTED = '[REDACTED]';

/** Key endings (lowercase, without `-` or `_`) whose values are always masked. */
const SENSITIVE_KEY_ENDINGS = ['token', 'secret', 'password', 'apikey', 'privatekey'];
/** Whole keys (lowercase, without `-` or `_`) whose values are always masked. */
const SENSITIVE_KEYS = new Set(['authorization', 'proxyauthorization', 'cookie', 'setcookie']);

/** GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`) and `sk-` API keys. */
const SECRET_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|\bsk-[A-Za-z0-9_-]{16,}/g;

const MAX_DEPTH = 32;

/**
 * True for keys like `token`, `accessToken`, `client_secret`, `x-api-key` or `authorization`.
 * Counters such as `maxTokens` or `inputTokens` do not match.
 */
export function isSensitiveKey(key: string): boolean {
  const normal = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.has(normal) || SENSITIVE_KEY_ENDINGS.some((ending) => normal.endsWith(ending));
}

/** Replaces every token-shaped substring of `text` with {@link REDACTED}. */
export function redactString(text: string): string {
  return text.replace(SECRET_PATTERN, REDACTED);
}

/**
 * Returns a JSON-safe deep copy of `value` with secrets masked: values under sensitive keys
 * and token-shaped substrings anywhere. Handles arrays, errors, `toJSON`, bigint and cycles.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
    const plain = toPlain(value);
    if (plain !== value) return redactValue(plain, seen, depth + 1);
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) && inner !== undefined ? REDACTED : redactValue(inner, seen, depth + 1);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** Uses `toJSON` when present, and keeps name and message of plain errors (not the stack). */
function toPlain(value: object): unknown {
  const withToJson = value as { toJSON?: unknown };
  if (typeof withToJson.toJSON === 'function') return (withToJson.toJSON as () => unknown).call(value);
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}
