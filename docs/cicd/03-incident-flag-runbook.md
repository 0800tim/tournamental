# 03 — Incident flag runbook

> How to halt promotes during an incident.

## What it is

The presence of the file `.deploy/incident.flag` (relative to the repo
root, on the deploy host) blocks `promote-to-prod.ts` at the pre-checks
stage. The pre-check is `no-incident-flag`, and a non-empty flag file
fails it.

This is **not a kill switch for staging deploys** — staging stays open so
you can continue iterating on a fix. It's specifically the production
promote that's gated.

## Setting the flag

```bash
ssh deploy@<prod-host>
cd /opt/vtorn
mkdir -p .deploy
cat > .deploy/incident.flag <<EOF
INC-2026-05-11-01: prod 5xx spike on /v1/leaderboards
opened: 2026-05-11T03:42:00Z
opened-by: tim@example.com
notes: investigating cache-warm regression after marketing deploy
EOF
```

Any text content is fine — the file's existence is what matters. We
recommend including the incident ID, opener, and a one-line summary so
later operators see context when they hit the block.

## Clearing the flag

```bash
ssh deploy@<prod-host>
cd /opt/vtorn
rm .deploy/incident.flag
```

Ensure:
- The incident is fully resolved (not just mitigated).
- The fix has shipped through staging at least once.
- Someone has updated the related session note or post-mortem.

## Override (use sparingly)

If a *fix* needs to ship while the flag is set, the workflow input
`force_prechecks_skip: true` skips the pre-check. Audit log:

- Who triggered: see GH workflow run page.
- Why: GH workflow run input form has a `notes` field (TODO add this to
  promote-to-prod.yml).

The `force_prechecks_skip` path appears in `data/deploy-timings.jsonl`
with a `notes: "prechecks-skipped"` annotation (TODO wire this through).

## Future: per-app incident flags

Today the flag is global. If we want to halt promotes for *one* app
while the rest deploy normally, we'd add `apps/<name>/.deploy/incident.flag`
checks in the per-app pre-check loop. Out of scope for the first PR.
