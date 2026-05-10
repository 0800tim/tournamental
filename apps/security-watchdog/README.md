# `@vtorn/security-watchdog`

Long-running security watchdog (port `:3416`) and CLI runner.

## What it does

- Tracks **findings** with a deterministic lifecycle: `open` → `acknowledged` → `resolved` (or `dismissed` / `false-positive`).
- Persists state as append-only JSONL (`data/findings.jsonl`, `data/audit.jsonl`) — survives restart, easy to mirror, easy to ship to long-term storage.
- Routes alerts by severity:
  - **info / low** — log only
  - **medium**     — channel sinks (Slack / Discord / Telegram)
  - **high**       — channel sinks + on-call SMS via Aiva
  - **critical**   — channel + on-call + email
- Pluggable alert sinks under `src/alerts/`. Failed deliveries land in `data/alert-failed.jsonl` (dead-letter pattern).
- Exposes a small REST API for the admin dashboard to list, ack, resolve, and dismiss findings.

## When findings appear

| Source                         | Trigger                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `.github/workflows/pr-security.yml` | Each PR: gitleaks, OSV, semgrep, license-audit, network |
| `.github/workflows/security-watchdog.yml` | Daily/weekly scheduled scans                       |
| `apps/pr-triage-bot`           | PR triage findings (when verdict ≥ yellow)                     |
| Manual ingest                  | `pnpm vtorn-watchdog ingest …`                                 |

Read [docs/security/05-security-watchdog.md](../../docs/security/05-security-watchdog.md) for the runbook.

## API

All write endpoints require a bearer token (env `WATCHDOG_API_TOKEN`, ≥ 16 chars).

```
GET  /healthz
GET  /v1/version
GET  /v1/findings?status=open&severityAtLeast=high&since=<ms>&limit=100
GET  /v1/findings/:id
POST /v1/findings              (auth) — ingest, observes-or-creates
POST /v1/findings/:id/ack      (auth) — acknowledge
POST /v1/findings/:id/resolve  (auth) — resolve
POST /v1/findings/:id/dismiss  (auth) — dismiss; { falsePositive: true } marks FP
GET  /v1/audit-log             (auth)
```

Ack/resolve/dismiss request bodies: `{ "by": "<actor>", "reason"?: "<text>" }`.

## CLI

```bash
pnpm --filter @vtorn/security-watchdog scan ingest \
  --source gitleaks --severity critical --title "AWS access key" \
  --location apps/x/src/y.ts:10 --id "gitleaks:abc:y.ts:10"

pnpm --filter @vtorn/security-watchdog scan list --severity high

pnpm --filter @vtorn/security-watchdog scan ack <id> --by tim --reason "fixed in PR #99"
```

## Env

```
WATCHDOG_PORT                     default 3416
WATCHDOG_BIND                     default 0.0.0.0
WATCHDOG_DATA_DIR                 default ./data (relative to cwd)
WATCHDOG_API_TOKEN                bearer token for write endpoints (>=16 chars)
WATCHDOG_CORS_ORIGINS             comma-separated origins; default vtorn-admin.aiva.nz + localhost:3340

# Alert sinks (all optional; missing env disables the sink)
SECURITY_SLACK_WEBHOOK_URL
SECURITY_DISCORD_WEBHOOK_URL
SECURITY_TELEGRAM_BOT_TOKEN
SECURITY_TELEGRAM_CHAT_ID
SECURITY_ONCALL_PHONES            E.164 comma-separated
AIVA_SMS_API_URL                  for the SMS sink (already in repo .env)
AIVA_SMS_API_KEY
AIVA_SMS_DEVICE_ID
SECURITY_EMAIL_TO
SECURITY_EMAIL_FROM
SECURITY_EMAIL_SMTP_HOST
SECURITY_EMAIL_SMTP_PORT          default 465
SECURITY_EMAIL_SMTP_USER
SECURITY_EMAIL_SMTP_PASS
```

## Tests

```bash
pnpm --filter @vtorn/security-watchdog test
```

Covers storage replay/idempotency, alert routing matrix, all sinks (with mocked transports), HTTP auth, full ack/resolve/dismiss lifecycle.
