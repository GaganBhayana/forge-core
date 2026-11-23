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

test('parseLogLevel accepts known names only', () => {
  assert.equal(parseLogLevel(' DEBUG '), 'debug');
  assert.equal(parseLogLevel('warn'), 'warn');
  assert.equal(parseLogLevel('verbose'), undefined);
  assert.equal(parseLogLevel(undefined), undefined);
});
