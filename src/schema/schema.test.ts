import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  array,
  boolean,
  enumOf,
  formatPath,
  literal,
  nullable,
  number,
  object,
  optional,
  parse,
  string,
  type Schema,
  type SchemaIssueCode,
} from './schema.ts';

interface Case {
  readonly name: string;
  readonly schema: Schema<unknown>;
  readonly value: unknown;
  /** The parsed value for a pass, or the issue codes for a failure. */
  readonly expect: { readonly ok: unknown } | { readonly codes: readonly SchemaIssueCode[] };
}

const cases: readonly Case[] = [
  { name: 'string accepts a string', schema: string(), value: 'hi', expect: { ok: 'hi' } },
  { name: 'string rejects a number', schema: string(), value: 1, expect: { codes: ['invalid_type'] } },
  { name: 'string min', schema: string({ min: 2 }), value: 'a', expect: { codes: ['too_small'] } },
  { name: 'string min boundary', schema: string({ min: 2 }), value: 'ab', expect: { ok: 'ab' } },
  { name: 'string max', schema: string({ max: 2 }), value: 'abc', expect: { codes: ['too_big'] } },
  { name: 'string pattern pass', schema: string({ pattern: /^[a-z]+$/ }), value: 'abc', expect: { ok: 'abc' } },
  { name: 'string pattern fail', schema: string({ pattern: /^[a-z]+$/ }), value: 'aB', expect: { codes: ['pattern'] } },
  { name: 'number accepts a number', schema: number(), value: 1.5, expect: { ok: 1.5 } },
  { name: 'number rejects a numeric string', schema: number(), value: '1', expect: { codes: ['invalid_type'] } },
  { name: 'number rejects NaN', schema: number(), value: Number.NaN, expect: { codes: ['invalid_type'] } },
  { name: 'number rejects Infinity', schema: number(), value: Infinity, expect: { codes: ['invalid_type'] } },
  { name: 'number int', schema: number({ int: true }), value: 1.5, expect: { codes: ['not_integer'] } },
  { name: 'number min', schema: number({ min: 0 }), value: -1, expect: { codes: ['too_small'] } },
  { name: 'number max', schema: number({ max: 1 }), value: 1.01, expect: { codes: ['too_big'] } },
  { name: 'number bounds inclusive', schema: number({ min: 0, max: 1 }), value: 1, expect: { ok: 1 } },
  { name: 'boolean accepts false', schema: boolean(), value: false, expect: { ok: false } },
  { name: 'boolean rejects "true"', schema: boolean(), value: 'true', expect: { codes: ['invalid_type'] } },
  { name: 'enumOf accepts a member', schema: enumOf(['low', 'high']), value: 'high', expect: { ok: 'high' } },
  { name: 'enumOf rejects others', schema: enumOf(['low', 'high']), value: 'mid', expect: { codes: ['invalid_enum'] } },
  { name: 'enumOf rejects non-strings', schema: enumOf(['1']), value: 1, expect: { codes: ['invalid_enum'] } },
  { name: 'literal accepts its value', schema: literal(2), value: 2, expect: { ok: 2 } },
  { name: 'literal is strict', schema: literal(2), value: '2', expect: { codes: ['invalid_literal'] } },
  { name: 'literal null', schema: literal(null), value: null, expect: { ok: null } },
  { name: 'array of numbers', schema: array(number()), value: [1, 2], expect: { ok: [1, 2] } },
  { name: 'array rejects an object', schema: array(number()), value: { 0: 1 }, expect: { codes: ['invalid_type'] } },
  { name: 'array min', schema: array(number(), { min: 1 }), value: [], expect: { codes: ['too_small'] } },
  { name: 'array max', schema: array(number(), { max: 1 }), value: [1, 2], expect: { codes: ['too_big'] } },
  {
    name: 'array reports every bad item',
    schema: array(number()),
    value: [1, 'a', 'b'],
    expect: { codes: ['invalid_type', 'invalid_type'] },
  },
  { name: 'optional accepts undefined', schema: optional(string()), value: undefined, expect: { ok: undefined } },
  { name: 'optional checks a present value', schema: optional(string()), value: 3, expect: { codes: ['invalid_type'] } },
  { name: 'optional does not accept null', schema: optional(string()), value: null, expect: { codes: ['invalid_type'] } },
  { name: 'nullable accepts null', schema: nullable(string()), value: null, expect: { ok: null } },
  { name: 'nullable checks a value', schema: nullable(string()), value: 'x', expect: { ok: 'x' } },
  { name: 'nullable rejects undefined', schema: nullable(string()), value: undefined, expect: { codes: ['invalid_type'] } },
  { name: 'object rejects null', schema: object({}), value: null, expect: { codes: ['invalid_type'] } },
  { name: 'object rejects an array', schema: object({}), value: [], expect: { codes: ['invalid_type'] } },
  { name: 'object requires keys', schema: object({ a: string() }), value: {}, expect: { codes: ['invalid_type'] } },
  { name: 'object strips unknown keys', schema: object({ a: number() }), value: { a: 1, b: 2 }, expect: { ok: { a: 1 } } },
  {
    name: 'object rejects unknown keys when asked',
    schema: object({ a: number() }, { unknownKeys: 'reject' }),
    value: { a: 1, b: 2, c: 3 },
    expect: { codes: ['unknown_key', 'unknown_key'] },
  },
  {
    name: 'object leaves out missing and undefined optional keys',
    schema: object({ a: optional(number()), b: optional(number()) }),
    value: { b: undefined },
    expect: { ok: {} },
  },
];

for (const c of cases) {
  test(c.name, () => {
    const result = parse(c.schema, c.value);
    if ('ok' in c.expect) {
      assert.deepEqual(result, { ok: true, value: c.expect.ok });
    } else {
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual(result.error.map((issue) => issue.code), c.expect.codes);
    }
  });
}

const config = object({
  name: string({ min: 1 }),
  rules: array(
    object({
      id: string({ pattern: /^[a-z-]+$/ }),
      severity: enumOf(['info', 'low', 'medium', 'high', 'critical']),
      weight: optional(number({ min: 0, max: 1 })),
    }),
  ),
});

test('issues carry nested paths like rules[2].severity', () => {
  const result = parse(config, {
    name: '',
    rules: [
      { id: 'ok-rule', severity: 'low' },
      { id: 'BAD', severity: 'high', weight: 2 },
      { id: 'third', severity: 'urgent' },
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.error.map(({ path, code }) => ({ path, code })),
    [
      { path: 'name', code: 'too_small' },
      { path: 'rules[1].id', code: 'pattern' },
      { path: 'rules[1].weight', code: 'too_big' },
      { path: 'rules[2].severity', code: 'invalid_enum' },
    ],
  );
  assert.match(result.error[3]?.message ?? '', /expected one of "info", "low"/);
});

test('a valid nested value parses to a fresh copy', () => {
  const input = { name: 'cfg', rules: [{ id: 'a', severity: 'info', extra: true }] };
  const result = parse(config, input);
  assert.deepEqual(result, { ok: true, value: { name: 'cfg', rules: [{ id: 'a', severity: 'info' }] } });
  if (result.ok) {
    assert.notEqual(result.value, input);
    assert.notEqual(result.value.rules, input.rules);
  }
});

test('the root path is an empty string', () => {
  const result = parse(string(), 1);
  assert.deepEqual(result, {
    ok: false,
    error: [{ code: 'invalid_type', path: '', message: 'expected string, received number' }],
  });
});

test('formatPath quotes keys that are not identifiers', () => {
  assert.equal(formatPath([]), '');
  assert.equal(formatPath(['rules', 2, 'severity']), 'rules[2].severity');
  assert.equal(formatPath([0, 'a']), '[0].a');
  assert.equal(formatPath(['a.b', 'c d', '']), '["a.b"]["c d"][""]');
});

test('a global pattern gives the same answer on every call', () => {
  const schema = string({ pattern: /^a+$/g });
  assert.equal(parse(schema, 'aaa').ok, true);
  assert.equal(parse(schema, 'aaa').ok, true);
});

test('a "__proto__" key is copied as data and cannot change the prototype', () => {
  // A computed key: a plain `__proto__:` in a literal would set the prototype instead.
  const schema = object({ ['__proto__']: optional(object({ polluted: boolean() })) });
  const input: unknown = JSON.parse('{"__proto__": {"polluted": true}}');
  const result = parse(schema, input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result.value, '__proto__')?.value, { polluted: true });
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});

test('inherited properties do not satisfy required keys', () => {
  const input = Object.create({ a: 'inherited' }) as object;
  const result = parse(object({ a: string() }), input);
  assert.equal(result.ok, false);
});

test('maxIssues caps the issue list for hostile input', () => {
  const huge = Array.from({ length: 10_000 }, () => 'x');
  const result = parse(array(number()), huge, { maxIssues: 5 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.length, 5);
    assert.equal(result.error[4]?.path, '[4]');
  }
  const defaulted = parse(array(number()), huge);
  assert.equal(defaulted.ok ? 0 : defaulted.error.length, 100);
});

test('bad options are programmer errors and throw', () => {
  assert.throws(() => parse(string(), 'a', { maxIssues: 0 }), RangeError);
  assert.throws(() => number({ min: Number.NaN }), RangeError);
  assert.throws(() => array(string(), { max: Infinity }), RangeError);
});
