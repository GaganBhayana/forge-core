# forge-core plan

forge-core is the shared engine for five tools (proof, bumpfix, flakehound, tooltrust, harnessci). It does the hard, repeated parts once: receiving GitHub webhooks safely, calling the GitHub API, running untrusted code in a sandbox, calling language models within a budget, and turning findings into evidence reports.

## Goals

1. Every product adds only its own logic; webhooks, sandboxing, model calls and reporting are written once here.
2. Zero runtime dependencies. Only the Node 22 standard library (`node:crypto`, `node:http`, `node:child_process`, `fetch`). This keeps the supply chain clean, which matters for security tools.
3. Safe by default: verified webhooks, least-privilege tokens, no secrets in sandboxes, prompt-injection guard on untrusted text, hard budgets on model spend.
4. Easy to test offline: every network boundary sits behind an interface with an in-memory fake.

## Non-goals

- A general GitHub SDK. We implement only the endpoints the products need.
- A workflow engine. Queueing is a small interface with an in-memory and a Postgres-ready shape.

## Modules

| Module | Path | Responsibility |
| --- | --- | --- |
| util | `src/util/` | Result type, typed errors, structured logger, retry with backoff and jitter, clock abstraction, redaction of secrets in logs |
| github | `src/github/` | Webhook signature check (HMAC SHA-256, constant-time), event parsing and narrowing, delivery dedup, App JWT (RS256 via `node:crypto`), installation token cache, minimal REST client (PRs, reviews, comments, check runs, contents, labels), rate-limit handling, pagination |
| evidence | `src/evidence/` | Finding model (id, rule, severity, confidence, evidence spans, links), report builder, renderers: Markdown (PR comments), SARIF 2.1.0, JSON |
| llm | `src/llm/` | Provider interface; Anthropic and OpenAI-compatible adapters over `fetch`; budget ledger (tokens and USD per run); prompt-injection guard that wraps untrusted text as data; structured JSON output with schema validation and retry; response cache keyed by hash |
| sandbox | `src/sandbox/` | Runner interface (`run(cmd, { cwd, env, timeoutMs, network })`); local process runner with timeout, output caps and env scrubbing; Docker runner (no network, read-only root, memory and CPU caps); spec for a GitHub Actions dispatch runner |
| schema | `src/schema/` | Tiny runtime validator (object, string, number, enum, array, optional) used for config files and model outputs |
| config | `src/config/` | Load and validate YAML-like repo config (`.proof.yml` etc.) with a minimal YAML subset parser |
| queue | `src/queue/` | Job interface, in-memory queue with retries and dead-letter list, idempotency keys |

## Key design decisions

- **ESM, Node 22, TypeScript strict, erasable syntax only.** Tests run with `node --test` directly on `.ts` files (Node type stripping); no build step needed for development. A build (`tsc -p tsconfig.build.json`) emits `dist/` for publishing.
- **Results over exceptions for expected failures.** `Result<T, E>` for validation, parsing and remote calls; exceptions only for programmer errors.
- **Every external call behind an interface** (`HttpClient`, `Clock`, `Runner`, `LlmProvider`) with fakes in `src/testing/`.
- **Security defaults:** webhook verification is mandatory; tokens never logged (redactor); sandbox env starts empty; untrusted text is always passed to models inside a fenced data block with an instruction not to follow it.

## Milestones

| Milestone | Target | Scope |
| --- | --- | --- |
| M1 Foundations | 21 Dec 2026 | util, schema, evidence (Markdown + SARIF), github webhooks + REST basics, llm interface + budget + guard, sandbox local runner. Tag v0.1.0 |
| M2 GitHub App kit | 15 Jan 2027 | App JWT, installation tokens, check runs, review comments, pagination, rate limits, a `createApp()` server with routing per event |
| M3 Model layer | 31 Jan 2027 | Anthropic + OpenAI-compatible adapters, JSON schema outputs with repair, cache, cost tables |
| M4 Sandboxes | 28 Feb 2027 | Docker runner, Actions dispatch runner, resource accounting, artifacts |
| M5 Hardening | Mar 2027 onward | Fuzz tests for parsers, docs site, examples, npm publish, v1.0 |

## Quality bar

- Every module has unit tests; parsers have table-driven tests with hostile inputs.
- Public functions have TSDoc comments.
- `npm run check` (type-check + tests) passes on every commit to `main`.

## How products consume it

Until the first npm release, products depend on it through Git: `"forge-core": "github:GaganBhayana/forge-core#v0.1.0"`, and the `prepare` script builds `dist/`. In offline agent sessions, clone forge-core next to the product and symlink it into `node_modules/forge-core`.
