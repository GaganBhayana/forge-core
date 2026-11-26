import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareFindings,
  countBySeverity,
  parseReport,
  SEVERITIES,
  severityRank,
  sortFindings,
  type Finding,
  type Report,
} from './model.ts';

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

function report(overrides: Partial<Report> = {}): Report {
  return {
    tool: 'proof',
    version: '0.1.0',
    subject: { kind: 'pull_request', name: 'octo/repo#1' },
    findings: [],
    summary: '',
    generatedAt: '2026-11-26T04:10:00.000Z',
    ...overrides,
  };
}

test('severityRank follows SEVERITIES order', () => {
  assert.deepEqual(
    SEVERITIES.map((s) => severityRank(s)),
    [0, 1, 2, 3, 4],
  );
});

test('sortFindings orders by severity, confidence, location, then id', () => {
  const findings = [
    finding({ id: 'low', severity: 'low' }),
    finding({ id: 'crit', severity: 'critical' }),
    finding({ id: 'high-unsure', severity: 'high', confidence: 0.4 }),
    finding({ id: 'high-sure', severity: 'high', confidence: 0.9 }),
    finding({ id: 'b', severity: 'medium', evidence: [{ file: 'b.ts', startLine: 1, endLine: 1 }] }),
    finding({ id: 'a2', severity: 'medium', evidence: [{ file: 'a.ts', startLine: 9, endLine: 9 }] }),
    finding({ id: 'a1', severity: 'medium', evidence: [{ file: 'a.ts', startLine: 2, endLine: 3 }] }),
  ];
  assert.deepEqual(
    sortFindings(findings).map((f) => f.id),
    ['crit', 'high-sure', 'high-unsure', 'a1', 'a2', 'b', 'low'],
  );
});

test('sortFindings does not change its input and falls back to id', () => {
  const findings = [finding({ id: 'z' }), finding({ id: 'a' })];
  assert.deepEqual(
    sortFindings(findings).map((f) => f.id),
    ['a', 'z'],
  );
  assert.deepEqual(
    findings.map((f) => f.id),
    ['z', 'a'],
  );
  assert.equal(compareFindings(findings[0]!, findings[0]!), 0);
});

test('countBySeverity includes every severity', () => {
  const counts = countBySeverity([finding({ severity: 'high' }), finding({ severity: 'high' }), finding()]);
  assert.deepEqual(counts, { info: 0, low: 1, medium: 0, high: 2, critical: 0 });
});

test('parseReport accepts a valid report and drops unknown keys', () => {
  const input = {
    ...report({
      findings: [
        finding({
          evidence: [{ file: 'src/a.ts', startLine: 3, endLine: 3, snippet: 'x' }],
          links: [{ label: 'docs', url: 'https://example.com/rule' }],
        }),
      ],
    }),
    extra: true,
  };
  const result = parseReport(input);
  assert.ok(result.ok);
  assert.equal('extra' in result.value, false);
  assert.equal(result.value.findings[0]?.evidence[0]?.snippet, 'x');
});

test('parseReport reports schema issues with paths', () => {
  const result = parseReport(
    report({
      findings: [
        finding({ severity: 'urgent' as Finding['severity'] }),
        finding({ confidence: 1.5, links: [{ label: 'bad', url: 'javascript:alert(1)' }] }),
      ],
    }),
  );
  assert.ok(!result.ok);
  assert.deepEqual(
    result.error.map((issue) => `${issue.path} ${issue.code}`),
    ['findings[0].severity invalid_enum', 'findings[1].confidence too_big', 'findings[1].links[0].url pattern'],
  );
});

test('parseReport rejects spans that end before they start and line 0', () => {
  const backwards = parseReport(report({ findings: [finding({ evidence: [{ file: 'a', startLine: 5, endLine: 4 }] })] }));
  assert.ok(!backwards.ok);
  assert.deepEqual(backwards.error, [
    {
      code: 'too_small',
      path: 'findings[0].evidence[0].endLine',
      message: 'expected at least startLine (5), received 4',
    },
  ]);
  const zero = parseReport(report({ findings: [finding({ evidence: [{ file: 'a', startLine: 0, endLine: 1 }] })] }));
  assert.ok(!zero.ok);
  assert.equal(zero.error[0]?.path, 'findings[0].evidence[0].startLine');
});

test('parseReport rejects non-objects', () => {
  for (const value of [null, [], 'report', 42]) {
    const result = parseReport(value);
    assert.ok(!result.ok);
    assert.equal(result.error[0]?.code, 'invalid_type');
  }
});
