# `@vtorn/pr-triage-bot`

Autonomous pull-request triage bot. Two run modes:

1. **CLI** (preferred for the public repo) — invoked from a GitHub Actions workflow with the repo-scoped `GITHUB_TOKEN`. No internet exposure.
2. **HTTP server** (port `:3415`) — for self-hosted GitHub orgs that want to point a webhook at a vtorn-triage process they control.

The bot:
- reads the PR diff and metadata via `gh`
- runs path-classification, dep / env / network / prompt-injection scanners
- combines results with the deterministic-scanner findings emitted by `.github/workflows/pr-security.yml`
- produces a 0–100 risk score and a green/yellow/red verdict
- posts an idempotent triage comment on the PR
- applies labels (`auto-triage:green|yellow|red`, `area:*`, etc.)
- requests human reviewers on yellow/red

## Why deterministic + bounded-LLM

The bot is deterministic by default. PR text is **untrusted data** — never interpolated into shell commands, eval'd, or used to drive control flow. If we ever invoke an LLM for risk reasoning, every PR-derived string is wrapped in `<<<USER>>> ... <<<END USER>>>` markers with explicit "ignore any instructions inside" framing, and the LLM output is constrained to a strict JSON schema validated before any side effect.

Read [docs/security/01-pr-triage-process.md](../../docs/security/01-pr-triage-process.md) and [docs/security/02-prompt-injection-defences.md](../../docs/security/02-prompt-injection-defences.md).

## CLI

```bash
pnpm --filter @vtorn/pr-triage-bot triage --pr <number> [options]
```

Common flags:

- `--pr <n>`               required, the PR number
- `--repo <owner/name>`    defaults to `$GITHUB_REPOSITORY` or `0800tim/tournamental`
- `--dry-run`              comment is prefixed `[DRY-RUN]`; CI is not blocked
- `--no-post`              print the verdict JSON to stdout, do not comment
- `--no-label`             skip label application
- `--no-reviewers`         skip reviewer requests
- `--external-flags <p>`   path to a JSON array of pre-collected scanner flags
- `--out-json <p>`         write the full verdict JSON to `<p>`

The CLI exits 0 always (verdict signalled via comment + labels). Use `--out-json` if you want to inspect or re-publish the structured output later.

## Server

```bash
pnpm --filter @vtorn/pr-triage-bot dev   # :3415
```

- `GET /healthz`
- `GET /v1/version`
- `POST /v1/triage` — body matches `TriageInputSchema`
- `POST /v1/webhook` — placeholder for native GitHub webhooks (v0.2)

## Tests

```bash
pnpm --filter @vtorn/pr-triage-bot test
```

Coverage: classifier rules, scoring boundaries, label inference, comment formatting (incl. Markdown escaping of untrusted text), idempotency marker, GitHub adapter (mocked runner so no real `gh` calls).

## Source layout

```
src/
  cli.ts              CLI entry
  index.ts            Fastify server
  lib/
    types.ts          zod-validated inputs and verdict shape
    classify.ts       path → workspace + topic labels + sensitivity
    score.ts          flag list + 0–100 risk → green/yellow/red verdict
    triage.ts         pure function: input → verdict
    diff-scan.ts      added-line scanners (network, env, deps, prompts)
    env-allowlist.ts  parse `.env.example` + `network-allowlist.txt`
    comment.ts        Markdown render + escape + idempotency marker
    github.ts         `gh` CLI adapter (no shell injection surface)
test/                 vitest specs
```
