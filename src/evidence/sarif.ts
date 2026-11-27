import { sortFindings, severityRank, type EvidenceSpan, type Finding, type Report, type ReportSubject, type Severity } from './model.ts';

/** The SARIF version this renderer writes. */
export const SARIF_VERSION = '2.1.0';

/** JSON schema URI for SARIF 2.1.0 (OASIS errata 01), written as `$schema`. */
export const SARIF_SCHEMA_URI =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

/** SARIF result levels this renderer produces (`none` is never used). */
export type SarifLevel = 'note' | 'warning' | 'error';

/** A SARIF message: plain text only. */
export interface SarifMessage {
  readonly text: string;
}

/** A SARIF `region`: a 1-based, inclusive line range with an optional snippet. */
export interface SarifRegion {
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet?: { readonly text: string };
}

/** A SARIF `location` with a physical location in one file. */
export interface SarifLocation {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string };
    readonly region: SarifRegion;
  };
}

/** A SARIF `reportingDescriptor` describing one rule. */
export interface SarifRule {
  readonly id: string;
  readonly shortDescription: SarifMessage;
  readonly helpUri?: string;
  readonly defaultConfiguration: { readonly level: SarifLevel };
}

/** A SARIF `result`: one finding. */
export interface SarifResult {
  readonly ruleId: string;
  readonly ruleIndex: number;
  readonly level: SarifLevel;
  readonly message: SarifMessage;
  readonly locations?: readonly SarifLocation[];
  readonly properties: {
    readonly findingId: string;
    readonly severity: Severity;
    readonly confidence: number;
  };
}

/** A SARIF `run`: one tool's results for one subject. */
export interface SarifRun {
  readonly tool: {
    readonly driver: {
      readonly name: string;
      readonly version: string;
      readonly rules: readonly SarifRule[];
    };
  };
  readonly results: readonly SarifResult[];
  readonly properties: {
    readonly subject: ReportSubject;
    readonly summary: string;
    readonly generatedAt: string;
  };
}

/** A SARIF 2.1.0 log with a single run. */
export interface SarifLog {
  readonly $schema: string;
  readonly version: typeof SARIF_VERSION;
  readonly runs: readonly [SarifRun];
}

/**
 * Maps a finding severity to a SARIF level: `info` and `low` become `note`,
 * `medium` becomes `warning`, `high` and `critical` become `error`.
 */
export function sarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case 'info':
    case 'low':
      return 'note';
    case 'medium':
      return 'warning';
    case 'high':
    case 'critical':
      return 'error';
  }
}

/**
 * Converts a report to a SARIF 2.1.0 log with one run.
 *
 * - The tool driver is the report's `tool` and `version`.
 * - Rules are deduplicated by `ruleId`, in the order they first appear in the sorted
 *   findings. A rule's description is the title of its first finding, its `helpUri` the
 *   first valid http(s) link, and its default level the level of its most severe finding.
 * - Results follow {@link sortFindings} order. Each evidence span becomes one location;
 *   a finding without evidence has no `locations` (GitHub code scanning needs at least
 *   one location to show a result, so give findings evidence when uploading there).
 * - The original severity, confidence and finding id are kept in `properties`.
 *
 * Text is copied as data (JSON escaping makes it safe). Curly braces in result messages
 * are doubled, because SARIF reads `{0}` in a message as an argument placeholder.
 *
 * The report is expected to be valid (see `validateReport`): a reversed line range is
 * clamped, but other invalid values, such as `startLine: 0`, are copied as they are.
 */
export function toSarif(report: Report): SarifLog {
  const findings = sortFindings(report.findings);
  const rules = buildRules(findings);
  const ruleIndex = new Map(rules.map((rule, i) => [rule.id, i]));
  const results = findings.map((finding) => toResult(finding, ruleIndex.get(finding.ruleId) ?? 0));
  return {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: { driver: { name: report.tool, version: report.version, rules } },
        results,
        properties: { subject: report.subject, summary: report.summary, generatedAt: report.generatedAt },
      },
    ],
  };
}

/** {@link toSarif} serialised as pretty-printed JSON with a trailing newline, ready to write to a `.sarif` file. */
export function renderSarif(report: Report): string {
  return `${JSON.stringify(toSarif(report), null, 2)}\n`;
}

function buildRules(sorted: readonly Finding[]): SarifRule[] {
  const byId = new Map<string, Finding[]>();
  for (const finding of sorted) {
    const group = byId.get(finding.ruleId);
    if (group === undefined) byId.set(finding.ruleId, [finding]);
    else group.push(finding);
  }
  return [...byId].map(([id, group]) => {
    const first = group[0] as Finding;
    const worst = group.reduce((a, b) => (severityRank(b.severity) > severityRank(a.severity) ? b : a));
    const helpUri = group.flatMap((f) => f.links).map((link) => httpUrl(link.url)).find((url) => url !== undefined);
    return {
      id,
      shortDescription: { text: first.title },
      ...(helpUri === undefined ? {} : { helpUri }),
      defaultConfiguration: { level: sarifLevel(worst.severity) },
    };
  });
}

function toResult(finding: Finding, ruleIndex: number): SarifResult {
  const text = finding.message.trim() === '' ? finding.title : finding.message;
  const locations = finding.evidence.map(toLocation);
  return {
    ruleId: finding.ruleId,
    ruleIndex,
    level: sarifLevel(finding.severity),
    message: { text: escapePlaceholders(text) },
    ...(locations.length === 0 ? {} : { locations }),
    properties: { findingId: finding.id, severity: finding.severity, confidence: finding.confidence },
  };
}

function toLocation(span: EvidenceSpan): SarifLocation {
  const hasSnippet = span.snippet !== undefined && span.snippet.trim() !== '';
  return {
    physicalLocation: {
      artifactLocation: { uri: artifactUri(span.file) },
      region: {
        startLine: span.startLine,
        endLine: Math.max(span.startLine, span.endLine),
        ...(hasSnippet ? { snippet: { text: span.snippet as string } } : {}),
      },
    },
  };
}

/**
 * Turns a repository path into a relative URI reference, as SARIF requires:
 * backslashes become `/`, empty and `.` segments are dropped (so a leading `/`,
 * `//` or `./` cannot make an absolute-path or network-path reference), and each
 * segment is percent-encoded so spaces, `#`, `?` and `%` cannot change the URI's meaning.
 */
export function artifactUri(file: string): string {
  return file
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** SARIF §3.11.5: literal `{` and `}` in a message are written as `{{` and `}}`. */
function escapePlaceholders(text: string): string {
  return text.replace(/[{}]/g, (brace) => brace + brace);
}

function httpUrl(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
}
