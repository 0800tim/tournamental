# 2026-10-17, DSAR access and erasure runbook

**Task**: burn round 6, `docs/runbooks/dsar-access-and-erasure.md`.
**Branch**: `docs/dsar-runbook` (worktree, docs only). Read-only against production: schemas from `apps/auth-sms/src/storage.ts`, `apps/game/migrations/*.sql`, `apps/web/lib/syndicate/persistence.ts`, `apps/tournament-bot/src/storage.ts`, and the file layout on the box (no production rows were read).

## What the runbook covers

Identity checks and the private DSAR log location; a data map across auth.db, the OTP audit log, game.db (register_interest, picks, pools, join requests held as membership `status`, invites, Bot Arena owners), the bot store, `.admin-audit.jsonl`, HighLevel, journald and the game.db snapshot folder; the access export as `sqlite3 -json` commands; the erasure as transactions with `PRAGMA foreign_keys = ON` (the CLI does not enable cascades by itself), the default anonymise path that keeps brackets under the share GUID, the full-cascade path, the `deleteRegisterInterest` helper from PR #336, HighLevel as Tim's manual step, verification counts and the reply.

## Open items surfaced

No store for the 12-month fraud hashes the policy promises; no self-service deletion endpoint; OTP audit log never rotated; journald retention not pinned; Customer 360 view unaudited; snapshot retention undefined; register-interest retention undefined (RI-10).

## Outcome

Draft PR opened. Needs Tim: read the runbook once against a test account before the first real request, and the open items.
