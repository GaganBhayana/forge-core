import { err, ok, type Result } from '../util/result.ts';

/** Why a value failed a schema check. */
export type SchemaIssueCode =
  | 'invalid_type'
  | 'too_small'
  | 'too_big'
  | 'not_integer'
  | 'pattern'
  | 'invalid_enum'
  | 'invalid_literal'
  | 'unknown_key';

/** One problem found by {@link parse}, located by a path like `rules[2].severity`. */
export interface SchemaIssue {
  readonly code: SchemaIssueCode;
  /** Dotted path to the bad value; an empty string means the root value. */
  readonly path: string;
  readonly message: string;
}

/** A path segment: an object key or an array index. */
export type PathSegment = string | number;

/** Collects issues during one {@link parse} call and stops at a limit. */
interface Issues {
  readonly list: SchemaIssue[];
  readonly max: number;
}

const INVALID: unique symbol = Symbol('invalid');
type Checked<T> = T | typeof INVALID;

/**
 * A runtime validator that also carries the static type `T` it produces.
 * Build one with the builders in this module; read its type with {@link Infer}.
 */
export interface Schema<T> {
  readonly kind: string;
  /** True only for schemas made by {@link optional}: the object key may be missing. */
  readonly isOptional: boolean;
  /** @internal Validates `value`, pushing issues; returns the parsed value or a sentinel. */
  readonly check: (value: unknown, path: readonly PathSegment[], issues: Issues) => Checked<T>;
  /** Type-only marker. Never set at runtime. */
  readonly _output?: T;
}

/** A schema whose object key may be absent. Made by {@link optional}. */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly isOptional: true;
  readonly inner: Schema<T>;
}

/** The static type a schema produces. */
export type Infer<S> = S extends Schema<infer T> ? T : never;

/** A map of object keys to their schemas, as passed to {@link object}. */
export type Shape = { readonly [key: string]: Schema<unknown> };

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never;
}[keyof S];
type InferShape<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: S[K] extends OptionalSchema<infer U> ? U : never;
  }
>;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Formats path segments as `rules[2].severity`; odd keys become `["a.b"]`. */
export function formatPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) out += out === '' ? segment : `.${segment}`;
    else out += `[${JSON.stringify(segment)}]`;
  }
  return out;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return typeof value;
}

function report(
  issues: Issues,
  code: SchemaIssueCode,
  path: readonly PathSegment[],
  message: string,
): typeof INVALID {
  if (issues.list.length < issues.max) issues.list.push({ code, path: formatPath(path), message });
  return INVALID;
}

function isFull(issues: Issues): boolean {
  return issues.list.length >= issues.max;
}

function make<T>(kind: string, check: Schema<T>['check']): Schema<T> {
  return { kind, isOptional: false, check };
}

function assertBound(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

/** Length limits for {@link string} and {@link array}. */
export interface LengthOptions {
  readonly min?: number;
  readonly max?: number;
}

/** Options for {@link string}. `min` and `max` count UTF-16 code units. */
export interface StringOptions extends LengthOptions {
  /** The whole value must match. Global and sticky flags are dropped. */
  readonly pattern?: RegExp;
}

function checkLength(
  length: number,
  options: LengthOptions,
  unit: string,
  path: readonly PathSegment[],
  issues: Issues,
): boolean {
  if (options.min !== undefined && length < options.min) {
    report(issues, 'too_small', path, `expected at least ${options.min} ${unit}, received ${length}`);
    return false;
  }
  if (options.max !== undefined && length > options.max) {
    report(issues, 'too_big', path, `expected at most ${options.max} ${unit}, received ${length}`);
    return false;
  }
  return true;
}

/** A string, optionally limited in length and matched against a pattern. */
export function string(options: StringOptions = {}): Schema<string> {
  assertBound('min', options.min);
  assertBound('max', options.max);
  // A stateless copy: `g` and `y` would make `test` depend on `lastIndex`.
  const pattern = options.pattern
    ? new RegExp(options.pattern.source, options.pattern.flags.replace(/[gy]/g, ''))
    : undefined;
  return make('string', (value, path, issues) => {
    if (typeof value !== 'string') {
      return report(issues, 'invalid_type', path, `expected string, received ${describe(value)}`);
    }
    if (!checkLength(value.length, options, 'characters', path, issues)) return INVALID;
    if (pattern && !pattern.test(value)) {
      return report(issues, 'pattern', path, `expected to match ${pattern}`);
    }
    return value;
  });
}

/** Options for {@link number}. */
export interface NumberOptions {
  readonly int?: boolean;
  readonly min?: number;
  readonly max?: number;
}

/** A finite number; `NaN` and infinities are rejected. */
export function number(options: NumberOptions = {}): Schema<number> {
  assertBound('min', options.min);
  assertBound('max', options.max);
  return make('number', (value, path, issues) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return report(issues, 'invalid_type', path, `expected finite number, received ${describe(value)}`);
    }
    if (options.int && !Number.isInteger(value)) {
      return report(issues, 'not_integer', path, `expected integer, received ${value}`);
    }
    if (options.min !== undefined && value < options.min) {
      return report(issues, 'too_small', path, `expected at least ${options.min}, received ${value}`);
    }
    if (options.max !== undefined && value > options.max) {
      return report(issues, 'too_big', path, `expected at most ${options.max}, received ${value}`);
    }
    return value;
  });
}

/** `true` or `false`. Strings like `"true"` are rejected. */
export function boolean(): Schema<boolean> {
  return make('boolean', (value, path, issues) =>
    typeof value === 'boolean'
      ? value
      : report(issues, 'invalid_type', path, `expected boolean, received ${describe(value)}`),
  );
}

/** One of a fixed list of strings, for example `enumOf(['low', 'high'])`. */
export function enumOf<const V extends readonly [string, ...string[]]>(values: V): Schema<V[number]> {
  const allowed = new Set<string>(values);
  const list = values.map((v) => JSON.stringify(v)).join(', ');
  return make('enum', (value, path, issues) =>
    typeof value === 'string' && allowed.has(value)
      ? (value as V[number])
      : report(issues, 'invalid_enum', path, `expected one of ${list}`),
  );
}

/** Exactly one value, compared with `===`. */
export function literal<const V extends string | number | boolean | null>(expected: V): Schema<V> {
  return make('literal', (value, path, issues) =>
    value === expected
      ? (value as V)
      : report(issues, 'invalid_literal', path, `expected ${JSON.stringify(expected)}`),
  );
}

/** An array whose items all match `item`. Every bad item is reported. */
export function array<T>(item: Schema<T>, options: LengthOptions = {}): Schema<T[]> {
  assertBound('min', options.min);
  assertBound('max', options.max);
  return make('array', (value, path, issues) => {
    if (!Array.isArray(value)) {
      return report(issues, 'invalid_type', path, `expected array, received ${describe(value)}`);
    }
    if (!checkLength(value.length, options, 'items', path, issues)) return INVALID;
    const out: T[] = [];
    let failed = false;
    for (let i = 0; i < value.length; i++) {
      const parsed = item.check(value[i], [...path, i], issues);
      if (parsed === INVALID) {
        failed = true;
        if (isFull(issues)) break;
      } else out.push(parsed);
    }
    return failed ? INVALID : out;
  });
}

/** Lets a value be `undefined`; inside {@link object} the key may be missing. */
export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    kind: 'optional',
    isOptional: true,
    inner,
    check: (value, path, issues) => (value === undefined ? undefined : inner.check(value, path, issues)),
  };
}

/** Lets a value be `null`. */
export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return make('nullable', (value, path, issues) => (value === null ? null : inner.check(value, path, issues)));
}

/** Options for {@link object}. */
export interface ObjectOptions {
  /**
   * What to do with keys not in the shape: `strip` drops them (the default),
   * `reject` reports each one as an `unknown_key` issue, which catches typos in config files.
   */
  readonly unknownKeys?: 'strip' | 'reject';
}

/**
 * A plain object with the given keys. The result is a new object holding only
 * known keys; optional keys that are missing or `undefined` are left out.
 */
export function object<S extends Shape>(shape: S, options: ObjectOptions = {}): Schema<InferShape<S>> {
  const keys = Object.keys(shape);
  return make('object', (value, path, issues) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return report(issues, 'invalid_type', path, `expected object, received ${describe(value)}`);
    }
    const input = value as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    let failed = false;
    for (const key of keys) {
      const schema = shape[key] as Schema<unknown>;
      const raw = Object.hasOwn(input, key) ? input[key] : undefined;
      const parsed = schema.check(raw, [...path, key], issues);
      if (parsed === INVALID) {
        failed = true;
        if (isFull(issues)) return INVALID;
      } else if (!(schema.isOptional && parsed === undefined)) entries.push([key, parsed]);
    }
    if (options.unknownKeys === 'reject') {
      for (const key of Object.keys(input)) {
        if (Object.hasOwn(shape, key)) continue;
        failed = true;
        report(issues, 'unknown_key', [...path, key], 'unknown key');
        if (isFull(issues)) break;
      }
    }
    // fromEntries defines own properties, so a "__proto__" key cannot change the prototype.
    return failed ? INVALID : (Object.fromEntries(entries) as InferShape<S>);
  });
}

/** Options for {@link parse}. */
export interface ParseOptions {
  /** Stop collecting after this many issues. Defaults to 100. */
  readonly maxIssues?: number;
}

/**
 * Validates `value` against `schema`. Returns the parsed value (a fresh copy for
 * objects and arrays), or every issue found up to `maxIssues`.
 */
export function parse<T>(schema: Schema<T>, value: unknown, options: ParseOptions = {}): Result<T, SchemaIssue[]> {
  const max = options.maxIssues ?? 100;
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`maxIssues must be a positive integer, got ${max}`);
  const issues: Issues = { list: [], max };
  const parsed = schema.check(value, [], issues);
  return parsed === INVALID ? err(issues.list) : ok(parsed);
}
