import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeBlock, escapeText, hasReportMarker, renderMarkdown, reportMarker } from './markdown.ts';
import type { Finding, Report } from './model.ts';

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

const sample: Report = {
  tool: 'proof',
  version: '0.1.0',
  subject: { kind: 'pull_request', name: 'octo/repo#12', url: 'https://github.com/octo/repo/pull/12' },
  summary: 'Checked 3 files.',
  generatedAt: '2026-11-26T04:10:00.000Z',
  findings: [
    finding({
      id: 'tests-1',
      ruleId: 'tests/missing',
      title: 'No tests for changed code',
      severity: 'medium',
      confidence: 0.8,
      message: 'src/a.ts changed but no test file did.',
      evidence: [{ file: 'src/a.ts', startLine: 10, endLine: 14 }],
    }),
    finding({
      id: 'secret-1',
      ruleId: 'secrets/token',
      title: 'Token committed',
      severity: 'critical',
      confidence: 0.95,
      message: 'Line 3 looks like a GitHub token.\nRotate it.',
      evidence: [
        { file: 'config/dev.env', startLine: 3, endLine: 3, snippet: 'TOKEN=ghp_xxx' },
        { file: 'config/prod.env', startLine: 7, endLine: 7 },
      ],
      links: [{ label: 'Rotating tokens', url: 'https://docs.github.com/en/authentication' }],
    }),
    finding({ id: 'style-1', ruleId: 'style/name', title: 'Unclear name', severity: 'info', confidence: 0.3 }),
  ],
};

test('renders a fixed report exactly (snapshot)', () => {
  assert.equal(renderMarkdown(sample), fixture('report.md'));
});

test('renders an empty report', () => {
  assert.equal(renderMarkdown({ ...sample, findings: [], summary: '' }), fixture('empty.md'));
});

test('the marker is the first line and is found by hasReportMarker', () => {
  const body = renderMarkdown(sample);
  assert.equal(body.split('\n')[0], '<!-- forge-core:report tool=proof -->');
  assert.ok(hasReportMarker(body, 'proof'));
  assert.ok(!hasReportMarker(body, 'tooltrust'));
});

test('a marker quoted later in the body does not count', () => {
  const quoted = `Someone pasted this:\n${reportMarker('proof')}`;
  assert.ok(!hasReportMarker(quoted, 'proof'));
});

test('reportMarker replaces characters that could end the comment', () => {
  assert.equal(reportMarker('a --> <b>'), '<!-- forge-core:report tool=a_--___b_ -->');
});

test('escapeText neutralises pipes, backticks, HTML, links and mentions', () => {
  assert.equal(escapeText('a|b'), 'a\\|b');
  assert.equal(escapeText('use `rm -rf`'), 'use \\`rm -rf\\`');
  assert.equal(escapeText('<!-- x --> <img src=x>'), '&lt;!-- x --&gt; &lt;img src=x&gt;');
  assert.equal(escapeText('[click](https://evil.example)'), '\\[click\\](https://evil.example)');
  assert.equal(escapeText('ping @octocat'), 'ping @&#8203;octocat');
  assert.equal(escapeText('two\nlines'), 'two lines');
  assert.equal(escapeText('**bold** ~~gone~~ _em_'), '\\*\\*bold\\*\\* \\~\\~gone\\~\\~ \\_em\\_');
  assert.equal(escapeText('a & b'), 'a &amp; b');
});

test('escapeBlock keeps lines but stops headings, lists and code blocks', () => {
  assert.equal(escapeBlock('# heading\n- item\n1. first\n2) second'), '\\# heading  \n\\- item  \n1\\. first  \n2\\) second');
  assert.equal(escapeBlock('    indented\r\n---\n==='), 'indented  \n\\---  \n\\===');
  assert.equal(escapeBlock('version 1.2 is <b>fine</b>'), 'version 1.2 is &lt;b&gt;fine&lt;/b&gt;');
});

test('hostile titles cannot add table cells or rows', () => {
  const body = renderMarkdown({
    ...sample,
    findings: [finding({ title: 'x | y\n| --- | fake |', ruleId: 'r`|`' })],
  });
  const row = body.split('\n').find((line) => line.startsWith('| low |'));
  assert.equal(row, '| low | r\\`\\|\\` | x \\| y \\| --- \\| fake \\| | - | 50% |');
  assert.equal(row.replace(/\\\|/g, '').split('|').length - 1, 6);
});

test('a hostile title cannot close the details summary', () => {
  const body = renderMarkdown({ ...sample, findings: [finding({ title: '</summary></details><b>@x</b>' })] });
  assert.match(
    body,
    /<summary><strong>LOW<\/strong> &lt;\/summary&gt;&lt;\/details&gt;&lt;b&gt;@&#8203;x&lt;\/b&gt; \(rule\)<\/summary>/,
  );
  assert.equal(body.match(/<\/details>/g)?.length, 1);
});

test('a snippet with backticks gets a longer fence', () => {
  const body = renderMarkdown({
    ...sample,
    findings: [finding({ evidence: [{ file: 'a.md', startLine: 1, endLine: 3, snippet: '```\ncode\n````' }] })],
  });
  assert.ok(body.includes('`````\n```\ncode\n````\n`````'));
});

test('long snippets are cut to maxSnippetLines', () => {
  const snippet = ['1', '2', '3', '4', '5'].join('\n');
  const body = renderMarkdown(
    { ...sample, findings: [finding({ evidence: [{ file: 'a', startLine: 1, endLine: 5, snippet }] })] },
    { maxSnippetLines: 2 },
  );
  assert.ok(body.includes('```\n1\n2\n... (3 more lines)\n```'));
});

test('maxFindings limits rows and details and counts the rest', () => {
  const findings = [1, 2, 3].map((n) => finding({ id: `f${n}`, title: `T${n}` }));
  const body = renderMarkdown({ ...sample, findings }, { maxFindings: 2 });
  assert.equal(body.match(/^\| low \|/gm)?.length, 2);
  assert.equal(body.match(/<details>/g)?.length, 2);
  assert.ok(body.includes('_1 more finding is not shown._'));
  assert.ok(body.includes('**3 findings** (3 low)'));
});

test('invalid options throw', () => {
  assert.throws(() => renderMarkdown(sample, { maxFindings: 0 }), RangeError);
  assert.throws(() => renderMarkdown(sample, { maxSnippetLines: 1.5 }), RangeError);
});

test('only http(s) links become Markdown links', () => {
  const body = renderMarkdown({
    ...sample,
    subject: { kind: 'package', name: 'left-pad', url: 'javascript:alert(1)' },
    findings: [
      finding({
        links: [
          { label: 'bad', url: 'javascript:alert(1)' },
          { label: 'odd', url: 'https://example.com/a b>c' },
        ],
      }),
    ],
  });
  assert.ok(body.includes('for package left-pad.'));
  assert.ok(body.includes('- bad\n'));
  assert.ok(body.includes('- [odd](<https://example.com/a%20b%3Ec>)'));
  assert.ok(!body.includes('javascript:'));
});
