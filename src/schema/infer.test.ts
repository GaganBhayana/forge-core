// Type-level tests: `tsc` fails if an inferred type is wrong. The runtime test only
// keeps `node --test` from reporting an empty file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  array,
  boolean,
  enumOf,
  literal,
  nullable,
  number,
  object,
  optional,
  parse,
  string,
  type Infer,
} from './schema.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>(): T | undefined {
  return undefined;
}

const rule = object({
  id: string(),
  severity: enumOf(['info', 'low', 'high']),
  weight: optional(number()),
  note: nullable(string()),
  enabled: boolean(),
  version: literal(1),
  tags: array(string()),
});

expectType<Equal<Infer<typeof string>, never>>(); // a builder, not a schema
expectType<Equal<Infer<ReturnType<typeof string>>, string>>();
expectType<Equal<Infer<ReturnType<typeof number>>, number>>();
expectType<Equal<Infer<typeof rule>['severity'], 'info' | 'low' | 'high'>>();
expectType<Equal<Infer<typeof rule>['version'], 1>>();
expectType<
  Equal<
    Infer<typeof rule>,
    {
      id: string;
      severity: 'info' | 'low' | 'high';
      weight?: number;
      note: string | null;
      enabled: boolean;
      version: 1;
      tags: string[];
    }
  >
>();
expectType<Equal<Infer<ReturnType<typeof optional<string>>>, string | undefined>>();
expectType<Equal<Infer<ReturnType<typeof array<{ a: number }>>>, { a: number }[]>>();

const nested = object({ rules: array(rule), meta: optional(object({ owner: string() })) });
expectType<Equal<Infer<typeof nested>['rules'][number], Infer<typeof rule>>>();
expectType<Equal<Infer<typeof nested>['meta'], { owner: string } | undefined>>();

// @ts-expect-error a required key cannot be omitted
const missing: Infer<typeof rule> = { id: 'x' };
// @ts-expect-error enum values are checked statically too
expectType<Equal<Infer<typeof rule>['severity'], string>>();

test('parse narrows to the inferred type', () => {
  const result = parse(rule, {
    id: 'r',
    severity: 'low',
    note: null,
    enabled: true,
    version: 1,
    tags: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    const severity: 'info' | 'low' | 'high' = result.value.severity;
    assert.equal(severity, 'low');
  }
  assert.equal(missing, missing);
});
