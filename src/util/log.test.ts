import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, parseLogLevel } from './log.ts';
import type { LogSink } from './log.ts';
import { REDACTED } from './redact.ts';

function memorySink(): { sink: LogSink; records: () => Record<string, unknown>[] } {
  const lines: string[] = [];
  return {
    sink: (line) => lines.push(line),
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const now = (): number => Date.UTC(2026, 10, 23, 4, 10, 0);

test('writes one JSON line per call with time, level, msg and fields', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (line) => lines.push(line), now });
  log.info('started', { repo: 'forge-core' });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]?.includes('\n'));
  assert.deepEqual(JSON.parse(lines[0] ?? ''), {
    time: '2026-11-23T04:10:00.000Z',
    level: 'info',
    msg: 'started',
    repo: 'forge-core',
  });
});

test('drops lines below the configured level', () => {
  const memory = memorySink();
  const log = createLogger({ level: 'warn', sink: memory.sink, now });
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepEqual(memory.records().map((r) => r['level']), ['warn', 'error']);
});

test('defaults to info level', () => {
  const memory = memorySink();
  const log = createLogger({ sink: memory.sink, now });
  log.debug('hidden');
  assert.equal(log.level, 'info');
  assert.equal(memory.records().length, 0);
});

test('child loggers add bound fields without changing the parent', () => {
  const memory = memorySink();
  const root = createLogger({ sink: memory.sink, now, fields: { app: 'proof' } });
  const child = root.child({ pr: 7 });
  const grandchild = child.child({ step: 'triage', pr: 8 });
  child.info('child');
  grandchild.info('grandchild', { step: 'override' });
  root.info('root');
  const [a, b, c] = memory.records();
  assert.equal(a?.['app'], 'proof');
  assert.equal(a?.['pr'], 7);
  assert.equal(b?.['pr'], 8);
  assert.equal(b?.['step'], 'override');
  assert.equal(c?.['pr'], undefined);
});

test('child loggers inherit the parent level and sink', () => {
  const memory = memorySink();
  const child = createLogger({ level: 'warn', sink: memory.sink, now }).child({ pr: 1 });
  child.info('dropped');
  child.warn('kept');
  assert.equal(child.level, 'warn');
  assert.deepEqual(memory.records().map((r) => r['msg']), ['kept']);
});

test('fields cannot overwrite time, level or msg', () => {
  const memory = memorySink();
  const log = createLogger({ sink: memory.sink, now, fields: { level: 'debug' } });
  log.warn('real', { msg: 'fake', time: 'never', toString: 'kept' });
  assert.deepEqual(memory.records()[0], {
    time: '2026-11-23T04:10:00.000Z',
    level: 'warn',
    msg: 'real',
    toString: 'kept',
  });
});

test('redacts secrets in bound fields, call fields and the message', () => {
  const memory = memorySink();
  const token = `ghs_${'k'.repeat(36)}`;
  const log = createLogger({ sink: memory.sink, now, fields: { auth: { token } } }).child({ apiKey: 'abc' });
  log.error(`push failed with ${token}`, { request: { headers: { authorization: `token ${token}` } }, items: [{ password: 'p' }] });
  assert.deepEqual(memory.records()[0], {
    time: '2026-11-23T04:10:00.000Z',
    level: 'error',
    msg: `push failed with ${REDACTED}`,
    auth: { token: REDACTED },
    apiKey: REDACTED,
    request: { headers: { authorization: REDACTED } },
    items: [{ password: REDACTED }],
  });
});

test('a field that cannot be serialized gives a fallback line instead of throwing', () => {
  const memory = memorySink();
  const log = createLogger({ sink: memory.sink, now });
  const token = `ghp_${'q'.repeat(36)}`;
  const bad = {
    toJSON(): never {
      throw new Error(`cannot serialize ${token}`);
    },
  };
  assert.doesNotThrow(() => log.error(`failed with ${token}`, { bad }));
  assert.deepEqual(memory.records()[0], {
    time: '2026-11-23T04:10:00.000Z',
    level: 'error',
    msg: `failed with ${REDACTED}`,
    logError: `fields not serializable: cannot serialize ${REDACTED}`,
  });
});

test('a throwing getter in the fields gives a fallback line', () => {
  const memory = memorySink();
  const log = createLogger({ sink: memory.sink, now });
  const fields = Object.defineProperty({}, 'lazy', {
    enumerable: true,
    get(): never {
      throw new Error('getter failed');
    },
  });
  assert.doesNotThrow(() => log.warn('w', fields));
  assert.equal(memory.records()[0]?.['logError'], 'fields not serializable: getter failed');
});

test('an invalid clock value falls back to the system time', () => {
  const memory = memorySink();
  const log = createLogger({ sink: memory.sink, now: () => Number.NaN });
  log.info('still written');
  const time = memory.records()[0]?.['time'];
  assert.equal(typeof time, 'string');
  assert.ok(!Number.isNaN(Date.parse(String(time))));
});

test('unknown levels are rejected as programmer errors', () => {
  assert.throws(() => createLogger({ level: 'verbose' as never }), TypeError);
});

test('parseLogLevel accepts known names only', () => {
  assert.equal(parseLogLevel(' DEBUG '), 'debug');
  assert.equal(parseLogLevel('warn'), 'warn');
  assert.equal(parseLogLevel('verbose'), undefined);
  assert.equal(parseLogLevel(undefined), undefined);
});
