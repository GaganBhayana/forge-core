import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artifactUri, renderSarif, sarifLevel, SARIF_SCHEMA_URI, toSarif, type SarifLog } from './sarif.ts';
import { SEVERITIES, type Finding, type Report } from './model.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../test/fixtures/evidence/${name}`, import.meta.url), 'utf8');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    ruleId: 'rule',
    title: 'A finding',
    severity: 'low',
    confidence: 0.5,
    message: '',
    evidence: [],
    links: [],
    ...overrides,
  };
}

function report(findings: Finding[]): Report {
  return {
    tool: 'proof',
    version: '0.1.0',
    subject: { kind: 'pull_request', name: 'octo/repo#12', url: 'https://github.com/octo/repo/pull/12' },
    summary: 'Checked 3 files.',
    generatedAt: '2026-11-27T04:10:00.000Z',
    findings,
  };
}

const sample = report([
  finding({
    id: 'tests-1',
    ruleId: 'tests/missing',
    title: 'No tests for changed code',
    severity: 'medium',
    confidence: 0.8,
    message: 'src/a.ts changed but no test file did.',
    evidence: [{ file: 'src/a.ts', startLine: 10, endLine: 14 }],
    links: [{ label: 'Rule docs', url: 'https://example.com/rules/tests-missing' }],
  }),
  finding({
    id: 'secret-1',
    ruleId: 'secrets/token',
    title: 'Possible token in source',
    severity: 'critical',
    confidence: 0.95,
    message: 'A string looks like a GitHub token.',
    evidence: [
      { file: 'config/dev.ts', startLine: 3, endLine: 3, snippet: 'const token = "ghp_xxx";' },
      { file: 'config/prod.ts', startLine: 7, endLine: 8 },
    ],
  }),
  finding({ id: 'style-1', ruleId: 'style/naming', title: 'Unclear name', severity: 'info', confidence: 0.3 }),
]);

/** Checks the fields SARIF 2.1.0 requires (and the ones this renderer promises) on every object. */
function assertValidSarif(log: SarifLog): void {
  assert.equal(log.version, '2.1.0');
  assert.equal(log.$schema, SARIF_SCHEMA_URI);
  assert.equal(log.runs.length, 1);
  const [run] = log.runs;
  assert.equal(typeof run.tool.driver.name, 'string');
  assert.ok(run.tool.driver.name.length > 0);
  assert.ok(Array.isArray(run.results));
  const ruleIds = run.tool.driver.rules.map((rule) => rule.id);
  assert.equal(new Set(ruleIds).size, ruleIds.length, 'rule ids are unique');
  for (const rule of run.tool.driver.rules) {
    assert.ok(rule.id.length > 0);
    assert.ok(['note', 'warning', 'error'].includes(rule.defaultConfiguration.level));
  }
  for (const result of run.results) {
    assert.equal(typeof result.message.text, 'string', 'result.message.text is required');
    assert.ok(['note', 'warning', 'error'].includes(result.level));
    assert.equal(run.tool.driver.rules[result.ruleIndex]?.id, result.ruleId, 'ruleIndex points at ruleId');
    for (const location of result.locations ?? []) {
      const { artifactLocation, region } = location.physicalLocation;
      assert.equal(typeof artifactLocation.uri, 'string');
      assert.ok(Number.isInteger(region.startLine) && region.startLine >= 1);
      assert.ok(region.endLine >= region.startLine);
    }
  }
  // The log must survive a JSON round trip unchanged (no undefined fields, no functions).
  assert.deepEqual(JSON.parse(JSON.stringify(log)), log);
}

test('renderSarif matches the fixture for a fixed report', () => {
  assert.equal(renderSarif(sample), fixture('report.sarif'));
});

test('toSarif produces the required SARIF structure', () => {
  const log = toSarif(sample);
  assertValidSarif(log);
  const [run] = log.runs;
  assert.deepEqual(run.tool.driver.name, 'proof');
  assert.deepEqual(run.tool.driver.version, '0.1.0');
  assert.deepEqual(run.properties, {
    subject: sample.subject,
    summary: 'Checked 3 files.',
    generatedAt: '2026-11-27T04:10:00.000Z',
  });
});

test('severities map to note, warning and error', () => {
  const expected = { info: 'note', low: 'note', medium: 'warning', high: 'error', critical: 'error' } as const;
  for (const severity of SEVERITIES) {
    assert.equal(sarifLevel(severity), expected[severity], severity);
    const [result] = toSarif(report([finding({ severity })])).runs[0].results;
    assert.equal(result?.level, expected[severity]);
    assert.equal(result?.properties.severity, severity);
  }
});

test('results are sorted by severity and keep id and confidence', () => {
  const results = toSarif(sample).runs[0].results;
  assert.deepEqual(
    results.map((r) => [r.properties.findingId, r.level, r.properties.confidence]),
    [
      ['secret-1', 'error', 0.95],
      ['tests-1', 'warning', 0.8],
      ['style-1', 'note', 0.3],
    ],
  );
});

test('rules are deduplicated by ruleId and take the most severe level', () => {
  const log = toSarif(
    report([
      finding({ id: 'a', ruleId: 'dup', title: 'First title', severity: 'low', confidence: 0.9 }),
      finding({ id: 'b', ruleId: 'other', severity: 'medium' }),
      finding({ id: 'c', ruleId: 'dup', title: 'Second title', severity: 'high', confidence: 0.1 }),
    ]),
  );
  assertValidSarif(log);
  const { rules } = log.runs[0].tool.driver;
  assert.deepEqual(
    rules.map((r) => [r.id, r.defaultConfiguration.level, r.shortDescription.text]),
    [
      // Sorted findings: c (high), b (medium), a (low), so `dup` comes first with c's title.
      ['dup', 'error', 'Second title'],
      ['other', 'warning', 'A finding'],
    ],
  );
  assert.deepEqual(
    log.runs[0].results.map((r) => [r.properties.findingId, r.ruleIndex]),
    [
      ['c', 0],
      ['b', 1],
      ['a', 0],
    ],
  );
});

test('rule helpUri is the first valid http(s) link and is omitted otherwise', () => {
  const log = toSarif(
    report([
      finding({ id: 'a', ruleId: 'r1', links: [{ label: 'bad', url: 'javascript:alert(1)//http://x' }] }),
      finding({ id: 'b', ruleId: 'r1', links: [{ label: 'docs', url: 'https://example.com/r1' }] }),
      finding({ id: 'c', ruleId: 'r2' }),
    ]),
  );
  const [r1, r2] = log.runs[0].tool.driver.rules;
  assert.equal(r1?.helpUri, 'https://example.com/r1');
  assert.equal(r2 !== undefined && 'helpUri' in r2, false);
});

test('each evidence span becomes a location with a region', () => {
  const [secret] = toSarif(sample).runs[0].results;
  assert.deepEqual(secret?.locations, [
    {
      physicalLocation: {
        artifactLocation: { uri: 'config/dev.ts' },
        region: { startLine: 3, endLine: 3, snippet: { text: 'const token = "ghp_xxx";' } },
      },
    },
    {
      physicalLocation: {
        artifactLocation: { uri: 'config/prod.ts' },
        region: { startLine: 7, endLine: 8 },
      },
    },
  ]);
});

test('a finding without evidence has no locations', () => {
  const [result] = toSarif(report([finding()])).runs[0].results;
  assert.equal(result !== undefined && 'locations' in result, false);
});

test('blank snippets are left out and a reversed range is clamped', () => {
  const [result] = toSarif(
    report([finding({ evidence: [{ file: 'a.ts', startLine: 5, endLine: 2, snippet: '  \n ' }] })]),
  ).runs[0].results;
  assert.deepEqual(result?.locations?.[0]?.physicalLocation.region, { startLine: 5, endLine: 5 });
});

test('an empty report has no rules and no results but is still valid', () => {
  const log = toSarif(report([]));
  assertValidSarif(log);
  assert.deepEqual(log.runs[0].tool.driver.rules, []);
  assert.deepEqual(log.runs[0].results, []);
  assert.equal(renderSarif(report([])).endsWith('}\n'), true);
});

test('the message falls back to the title when it is blank', () => {
  const [result] = toSarif(report([finding({ title: 'Only a title', message: '   ' })])).runs[0].results;
  assert.equal(result?.message.text, 'Only a title');
});

test('braces in messages are doubled so they are not read as placeholders', () => {
  const [result] = toSarif(report([finding({ message: 'Use {0} or {{x}}' })])).runs[0].results;
  assert.equal(result?.message.text, 'Use {{0}} or {{{{x}}}}');
});

test('hostile text is kept as data and the JSON stays well formed', () => {
  const hostile = '"}]}\u0000 <script>alert(1)</script>\n@everyone';
  const hostileReport = report([
    finding({
      ruleId: hostile,
      title: hostile,
      message: hostile,
      evidence: [{ file: '../../etc/passwd', startLine: 1, endLine: 1, snippet: hostile }],
    }),
  ]);
  const log = toSarif(hostileReport);
  assertValidSarif(log);
  const parsed = JSON.parse(renderSarif(hostileReport)) as SarifLog;
  assert.deepEqual(parsed, log);
  const [run] = parsed.runs;
  assert.equal(run.tool.driver.rules[0]?.id, hostile);
  assert.equal(run.results[0]?.message.text, hostile.replace(/[{}]/g, (b) => b + b));
  assert.equal(run.results[0]?.locations?.[0]?.physicalLocation.artifactLocation.uri, '../../etc/passwd');
  assert.equal(run.results[0]?.locations?.[0]?.physicalLocation.region.snippet?.text, hostile);
});

test('artifactUri makes a relative URI reference from a path', () => {
  assert.equal(artifactUri('src/a.ts'), 'src/a.ts');
  assert.equal(artifactUri('./src/a.ts'), 'src/a.ts');
  assert.equal(artifactUri('././src/a.ts'), 'src/a.ts');
  assert.equal(artifactUri('src\\win\\file.ts'), 'src/win/file.ts');
  assert.equal(artifactUri('docs/my file#1?.md'), 'docs/my%20file%231%3F.md');
  assert.equal(artifactUri('100%/x.ts'), '100%25/x.ts');
  assert.equal(artifactUri('src/naïve.ts'), 'src/na%C3%AFve.ts');
  assert.equal(artifactUri('/etc/passwd'), 'etc/passwd');
  assert.equal(artifactUri('//evil.com/x'), 'evil.com/x');
  assert.equal(artifactUri('\\\\server\\share\\x'), 'server/share/x');
  assert.equal(artifactUri('a//b/./c/'), 'a/b/c');
  // Every output must parse as a URL relative to a base, staying a path under it.
  const cases: [string, string][] = [
    ['a b/c', 'a b/c'],
    ['x#y', 'x#y'],
    ['q?r', 'q?r'],
    ['%', '%'],
    [':colon/x', ':colon/x'],
    ['/etc/passwd', 'etc/passwd'],
    ['//evil.com/x', 'evil.com/x'],
    ['a//b', 'a/b'],
  ];
  for (const [path, expected] of cases) {
    const uri = artifactUri(path);
    assert.ok(URL.canParse(uri, 'file:///repo/'), uri);
    const resolved = new URL(uri, 'file:///repo/');
    assert.equal(resolved.host, '', `${uri} must not name a host`);
    assert.equal(decodeURIComponent(resolved.pathname), `/repo/${expected}`);
  }
});

test('toSarif does not modify the report', () => {
  const copy = structuredClone(sample);
  toSarif(sample);
  assert.deepEqual(sample, copy);
});
