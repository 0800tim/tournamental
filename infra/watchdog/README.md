# Tournamental + Aiva watchdog

Runs every minute via clawdbot's user crontab. Probes the full WhatsApp-login
pipe and the surrounding services. After **three consecutive failures** it
WhatsApps + emails Tim at `+6421535832` / `info@growthspurt.agency`. Goes silent
once alerted until the system recovers, then sends an "all clear" follow-up.

## What it checks (7 probes)

1. pm2 reports `aiva-api` as `online`.
2. Port 7002 is held by pm2's tracked `aiva-api` PID, **or any descendant** of
   it (the .NET `dotnet run` wrapper spawns `AivaMiddleware` as a child, so a
   strict PID-equality check would false-fail).
3. No orphan `AivaMiddleware` processes from non-canonical paths (e.g. an old
   dev worktree at `/home/clawdbot/clawd/...` — the 2026-05-29 outage).
4. `auth.tournamental.com/health` returns 200.
5. `play.tournamental.com/api/healthz` returns 200.
6. `game.tournamental.com/healthz` returns 200.
7. Aiva-SMS gateway on `localhost:9252` answers (any non-error response).

## Files

- `check.sh` — the probe script. Idempotent, no external deps beyond
  curl/jq/ss/pm2.
- `/home/clawdbot/.vtorn-watchdog/log.jsonl` — JSONL log, one event per check.
  `tail -f` to live-watch.
- `/home/clawdbot/.vtorn-watchdog/fail_count` — current consecutive-failure
  counter. Cleared on recovery.
- `/home/clawdbot/.vtorn-watchdog/alerted` — flag file. Present while an
  alert is "open" so we don't carpet-bomb. Removed on recovery.
- `/home/clawdbot/.vtorn-watchdog/cron.log` — stdout/stderr from cron runs
  (the script itself logs to log.jsonl; this catches anything outside it).

## Crontab entry

```
* * * * * /home/clawdbot/clawdia/projects/vtorn/infra/watchdog/check.sh >> /home/clawdbot/.vtorn-watchdog/cron.log 2>&1
```

## Alert delivery

Uses the Tournamental `auth-sms /v1/internal/send-message` endpoint with the
`INTERNAL_BROADCAST_SECRET` Bearer (same secret used by the bulk-invite
runner). WhatsApp goes via Aiva-SMS; email goes via SendGrid. Both fire in
one request.

**Failure mode**: if Aiva-SMS is the thing that's down, the WhatsApp side of
the alert will silently fail but the email side will still arrive. That's
why we always send both channels.

## Manual test

```bash
# Run the watchdog once, check the log, no alert if green.
infra/watchdog/check.sh
tail -3 /home/clawdbot/.vtorn-watchdog/log.jsonl
```

## Disabling

```bash
crontab -e   # delete the line
```

## Adjusting the alert threshold

Edit `ALERT_AFTER_FAILURES` at the top of `check.sh`. The default of 3 means
~3 minutes from incident → first alert. Lower for noisier services, higher
for flakier networks.
