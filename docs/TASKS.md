# forge-core tasks

Status values: `todo`, `review (PR #n)`, `done (PR #n)`, `blocked: <reason>`. Sizes: S (under 150 lines changed), M (150–400). The autopilot picks the first `todo` task whose dependencies are `done`. Keep one task per PR.

## M1 Foundations (target 21 Dec 2026)

### FC-001 Result type and typed errors
- Status: done (PR #1)
- Size: S
- Depends on: none
- Goal: `src/util/result.ts` with `Result<T, E>`, `ok()`, `err()`, `isOk()`, `map()`, `andThen()`, `unwrapOr()`; `src/util/errors.ts` with a `ForgeError` base (code, message, cause) and codes `INVALID_INPUT`, `NOT_FOUND`, `UNAUTHORIZED`, `RATE_LIMITED`, `TIMEOUT`, `UPSTREAM`, `BUDGET_EXCEEDED`.
- Acceptance: unit tests for every helper including chaining an error through `andThen`; exported from `src/index.ts`.

### FC-002 Structured logger with secret redaction
- Status: done (PR #2)
- Size: S
- Depends on: FC-001
- Goal: `src/util/log.ts`: JSON-lines logger with levels, child loggers with bound fields, and a redactor that masks values of keys like `token`, `secret`, `password`, `authorization`, `apiKey` and strings matching GitHub token prefixes (`ghp_`, `ghs_`, `github_pat_`) and `sk-` keys.
- Acceptance: tests show nested objects and arrays are redacted; logger writes to an injectable sink.

### FC-003 Retry with backoff and a clock abstraction
- Status: review
- Size: S
- Depends on: FC-001
- Goal: `src/util/clock.ts` (`Clock` interface, system clock, fake clock for tests); `src/util/retry.ts` with exponential backoff, full jitter, max attempts, `shouldRetry` predicate and respect for a `retryAfterMs` hint.
- Acceptance: tests with the fake clock prove the delay sequence and that non-retryable errors stop immediately.

### FC-004 Minimal runtime schema validator
- Status: todo
- Size: M
- Depends on: FC-001
- Goal: `src/schema/` with builders `object`, `string` (min, max, pattern), `number` (int, min, max), `boolean`, `enumOf`, `array`, `optional`, `nullable`, `literal`, and `parse(schema, value): Result<T, SchemaIssue[]>` with paths like `rules[2].severity`. Static type inference via `Infer<typeof schema>`.
- Acceptance: table-driven tests for every builder, nested paths in issues, and a type-level test file that type-checks inferred types.

### FC-005 Evidence model and Markdown renderer
- Status: todo
- Size: M
- Depends on: FC-004
- Goal: `src/evidence/model.ts`: `Finding` (id, ruleId, title, severity `info|low|medium|high|critical`, confidence 0–1, message, evidence spans `{file, startLine, endLine, snippet?}`, links), `Report` (tool, version, subject, findings, summary, generatedAt). `src/evidence/markdown.ts` renders a PR-comment-ready report: summary line, a table sorted by severity, collapsible details per finding, and a hidden HTML marker so a later run can update the same comment.
- Acceptance: snapshot-style tests on fixed input; Markdown escapes pipes and backticks in user content.

### FC-006 SARIF 2.1.0 renderer
- Status: todo
- Size: M
- Depends on: FC-005
- Goal: `src/evidence/sarif.ts` converts a `Report` to SARIF 2.1.0 (tool driver, rules from findings, results with locations and levels mapped from severity).
- Acceptance: output validates against the required SARIF fields (tests check structure), and severities map to `note|warning|error` correctly.

### FC-007 Webhook signature verification
- Status: todo
- Size: S
- Depends on: FC-001
- Goal: `src/github/webhook.ts`: `verifySignature(secret, rawBody, signatureHeader)` using HMAC SHA-256 and `timingSafeEqual`; rejects missing, malformed or wrong-length headers.
- Acceptance: tests with GitHub's documented example payload and signature, plus tampered body, wrong secret and malformed header cases.

### FC-008 Webhook event parsing and delivery dedup
- Status: todo
- Size: M
- Depends on: FC-004, FC-007
- Goal: parse `x-github-event`, `x-github-delivery` and the JSON body into typed events for `pull_request`, `issue_comment`, `check_suite`, `push`, `installation`; unknown events become a generic type. An in-memory LRU dedup store drops repeated delivery IDs.
- Acceptance: fixtures for each event in `test/fixtures/webhooks/`; tests for narrowing, dedup and invalid JSON.

### FC-009 HTTP client interface and GitHub REST basics
- Status: todo
- Size: M
- Depends on: FC-003
- Goal: `src/http/` with an `HttpClient` interface over `fetch` and a fake for tests. `src/github/rest.ts` with typed calls: get PR, list PR files (paginated), create issue comment, update comment, create review with inline comments, add labels. Handles `Link` pagination and maps 401/403/404/429 to typed errors, using `retry-after` and `x-ratelimit-reset`.
- Acceptance: tests against the fake client for each call, pagination across 3 pages, and rate-limit retry.

### FC-010 Upsert a sticky PR comment
- Status: todo
- Size: S
- Depends on: FC-005, FC-009
- Goal: `upsertStickyComment(pr, marker, body)` finds an existing comment with the hidden marker and updates it, otherwise creates one.
- Acceptance: tests for create, update and "marker appears in another user's comment" (ignored unless authored by the app).

### FC-011 LLM provider interface, budget ledger, injection guard
- Status: todo
- Size: M
- Depends on: FC-001, FC-004
- Goal: `src/llm/types.ts` (`LlmProvider.complete({ system, messages, maxTokens, json? })` returning text, usage and cost); `src/llm/budget.ts` ledger with per-run USD and token caps that refuses calls past the cap; `src/llm/guard.ts` `asUntrustedData(label, text)` that fences text, neutralises fence-breaking sequences and adds a do-not-follow instruction; a fake provider for tests.
- Acceptance: tests for budget refusal, cost accumulation and that guard output cannot be closed early by hostile input.

### FC-012 Local sandbox runner
- Status: todo
- Size: M
- Depends on: FC-001, FC-003
- Goal: `src/sandbox/local.ts` implementing `Runner.run(command, args, { cwd, env, timeoutMs, maxOutputBytes })` with `child_process.spawn` (no shell), an empty-by-default environment plus an allowlist, a hard timeout that kills the process group, and output truncation.
- Acceptance: tests for exit codes, timeout kill, output cap, and that parent environment variables do not leak.

### FC-013 Public API, docs and v0.1.0
- Status: todo
- Size: S
- Depends on: FC-002, FC-006, FC-008, FC-010, FC-011, FC-012
- Goal: curate `src/index.ts` exports, add subpath exports in `package.json` (`forge-core/github`, `/evidence`, `/llm`, `/sandbox`, `/schema`, `/util`), write README usage examples, add `tsconfig.build.json` with `rewriteRelativeImportExtensions`, a `prepare` build, and a CHANGELOG entry.
- Acceptance: `npm run build` emits `dist/` with types; README examples are covered by a test that imports them.

## M2 GitHub App kit (target 15 Jan 2027)

### FC-014 GitHub App JWT
- Status: todo
- Size: S
- Depends on: FC-013
- Goal: create RS256 JWTs for an App ID and PEM key with `node:crypto` (iat backdated 60 s, exp 9 min).
- Acceptance: tests verify the signature with the public key and the claims.

### FC-015 Installation token cache
- Status: todo
- Size: S
- Depends on: FC-014, FC-009
- Goal: fetch installation tokens, cache until 5 minutes before expiry, single-flight concurrent requests.
- Acceptance: tests with the fake clock and fake HTTP client.

### FC-016 Check runs API
- Status: todo
- Size: S
- Depends on: FC-009
- Goal: create and update check runs with summary, text, annotations (batched by 50) and conclusion.
- Acceptance: tests for annotation batching.

### FC-017 App server with event routing
- Status: todo
- Size: M
- Depends on: FC-008, FC-015
- Goal: `createApp({ secret, handlers })` returning a `node:http` request handler that verifies, dedups, routes events to handlers with an installation-scoped client, and responds 202 quickly while work continues on the queue.
- Acceptance: integration test that posts a signed fixture to a local server and asserts the handler ran once.

### FC-018 In-memory job queue
- Status: todo
- Size: M
- Depends on: FC-003
- Goal: `src/queue/memory.ts` with concurrency limit, retries with backoff, dead-letter list and idempotency keys.
- Acceptance: tests for retry, dead-letter and duplicate keys.

### FC-019 Minimal YAML subset parser for repo config
- Status: todo
- Size: M
- Depends on: FC-004
- Goal: parse the YAML subset used by config files (maps, lists, scalars, quoted strings, comments, block indentation) into JSON, then validate with a schema. Reject anchors, tags and multi-docs with clear errors.
- Acceptance: table-driven tests incl. hostile inputs (deep nesting limit, very long lines).

### FC-020 Example app and docs
- Status: todo
- Size: S
- Depends on: FC-017, FC-019
- Goal: `examples/hello-app/` that comments "hello" with a sticky comment on new PRs; docs page on running it locally with a smee-style proxy.
- Acceptance: example type-checks and its handler has a test.
