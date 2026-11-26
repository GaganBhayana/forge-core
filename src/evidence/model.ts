import { array, enumOf, number, object, optional, parse, string, type Infer, type SchemaIssue } from '../schema/schema.ts';
import { err, ok, type Result } from '../util/result.ts';

/** Finding severities, lowest first. */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;

/** One of {@link SEVERITIES}. */
export type Severity = (typeof SEVERITIES)[number];

/** Position of a severity in {@link SEVERITIES}: `info` is 0, `critical` is 4. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

const lineNumber = number({ int: true, min: 1 });

/** Schema for {@link EvidenceSpan}: a 1-based, inclusive line range in one file. */
export const evidenceSpanSchema = object({
  file: string({ min: 1, max: 4096 }),
  startLine: lineNumber,
  endLine: lineNumber,
  snippet: optional(string()),
});

/** Schema for {@link FindingLink}. Only `http` and `https` URLs are accepted. */
export const findingLinkSchema = object({
  label: string({ min: 1, max: 200 }),
  url: string({ min: 1, max: 2048, pattern: /https?:\/\/\S+/i }),
});

/** Schema for {@link Finding}. */
export const findingSchema = object({
  id: string({ min: 1, max: 200 }),
  ruleId: string({ min: 1, max: 200 }),
  title: string({ min: 1, max: 500 }),
  severity: enumOf(SEVERITIES),
  confidence: number({ min: 0, max: 1 }),
  message: string(),
  evidence: array(evidenceSpanSchema),
  links: array(findingLinkSchema),
});

/** Schema for {@link ReportSubject}. */
export const reportSubjectSchema = object({
  /** What was checked, for example `pull_request`, `commit` or `package`. */
  kind: string({ min: 1, max: 100 }),
  /** A human name for it, for example `octo/repo#12`. */
  name: string({ min: 1, max: 500 }),
  url: optional(string({ min: 1, max: 2048, pattern: /https?:\/\/\S+/i })),
});

/** Schema for {@link Report}. */
export const reportSchema = object({
  tool: string({ min: 1, max: 100 }),
  version: string({ min: 1, max: 100 }),
  subject: reportSubjectSchema,
  findings: array(findingSchema),
  summary: string(),
  generatedAt: string({ min: 1, max: 100 }),
});

/** Where a finding was seen: a file and a 1-based, inclusive line range. */
export type EvidenceSpan = Infer<typeof evidenceSpanSchema>;
/** A reference for a finding, such as a rule's docs page. */
export type FindingLink = Infer<typeof findingLinkSchema>;
/** One problem a tool found, with its evidence. */
export type Finding = Infer<typeof findingSchema>;
/** What a report is about. */
export type ReportSubject = Infer<typeof reportSubjectSchema>;
/** Everything one tool run found about one subject. */
export type Report = Infer<typeof reportSchema>;

/**
 * Validates an untrusted value (for example JSON from another process) as a {@link Report}.
 * On top of the schema, every evidence span must have `endLine >= startLine`.
 */
export function parseReport(value: unknown): Result<Report, SchemaIssue[]> {
  const parsed = parse(reportSchema, value);
  if (!parsed.ok) return parsed;
  const issues: SchemaIssue[] = [];
  parsed.value.findings.forEach((finding, i) => {
    finding.evidence.forEach((span, j) => {
      if (span.endLine < span.startLine) {
        issues.push({
          code: 'too_small',
          path: `findings[${i}].evidence[${j}].endLine`,
          message: `expected at least startLine (${span.startLine}), received ${span.endLine}`,
        });
      }
    });
  });
  return issues.length > 0 ? err(issues) : ok(parsed.value);
}

/**
 * Orders findings for display: highest severity first, then higher confidence,
 * then by first evidence file and line, then by id, so the order is stable.
 */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    b.confidence - a.confidence ||
    compareText(a.evidence[0]?.file ?? '', b.evidence[0]?.file ?? '') ||
    (a.evidence[0]?.startLine ?? 0) - (b.evidence[0]?.startLine ?? 0) ||
    compareText(a.id, b.id)
  );
}

/** Returns a new array of findings in {@link compareFindings} order. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}

/** Counts findings per severity; every severity is present, with 0 when unused. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** Locale-independent string order, so output does not change between machines. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
