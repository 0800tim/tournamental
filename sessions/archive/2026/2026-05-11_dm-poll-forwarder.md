# 2026-05-11 — dm-poll-forwarder builder agent

- **Status**: complete
- **Branch**: `feat/dm-poll-forwarder`
- **Worktree**: `/home/clawdbot/clawdia/projects/vtorn-poll-forwarder`
- **Refs**: docs/41-dm-poll-forwarder.md, apps/dm-otp/src/routes/webhooks/{reddit,mastodon,signal}.ts

## Plan

Build `apps/dm-poll-forwarder` on `:3404` to fill the webhook gap for the three DM-OTP channels (Reddit, Mastodon, Signal) that don't push to us. The worker:

1. Polls each platform's API on a per-channel interval.
2. Normalises into a `PollMessage` shape.
3. POSTs to the matching `apps/dm-otp` ingest endpoint with the bearer auth that endpoint already expects.
4. Persists per-channel cursors (JSONL append-only) so a restart doesn't replay the inbox.
5. Dead-letters and exposes admin pause/resume/replay so the operator can react to outages without redeploying.

## Decisions

- **Cursor format**: per channel, a single string. Reddit uses thing `name`, Mastodon uses a JSON-encoded `{host: lastConvId}` map (multi-instance), Signal uses `<paddedTimestamp>:<sourceUuid>`.
- **Idempotency contract with dm-otp**: scheduler stops advancing the cursor as soon as a forward fails. Combined with dm-otp's per-(channel, externalId) code semantics, this bounds duplicate codes to one per failed cycle.
- **Mock-first default**: `POLL_BACKEND=mock` is the default so local boots and CI never touch the network. Real backend is opt-in via env.
- **Admin auth**: `x-poll-admin` shared secret with constant-time compare. ≥ 32 chars in prod; dev default for smoke tests.
- **No SQLite/Redis**: cursors are tiny and per-process; JSONL with periodic compaction is enough and trivially inspectable. Will revisit if/when this is horizontally scaled.

## Outcome

- 14 source files in `apps/dm-poll-forwarder/src/` plus `package.json`/`tsconfig.json`/`vitest.config.ts`.
- 6 test files, **44 tests, all passing**.
- `pnpm --filter @vtorn/dm-poll-forwarder typecheck` ✅
- `pnpm --filter @vtorn/dm-poll-forwarder test` ✅ (44/44)
- `pnpm typecheck` workspace-wide ✅
- Docs: `docs/41-dm-poll-forwarder.md` covers rationale, per-platform API notes, env vars, admin runbook, mock vs real backend, deployment.

## Files added

```
apps/dm-poll-forwarder/
  package.json, tsconfig.json, vitest.config.ts
  data/.gitkeep
  src/
    index.ts                       # entrypoint + buildServer + SIGTERM handling
    types.ts                       # Channel, PollMessage, PollerStatus, ForwardResult
    lib/
      cursors.ts                   # JSONL append-only cursor store with compaction
      dead-letter.ts               # JSONL append-only DLQ + drain/rewrite
      forwarder.ts                 # POST + retry with exponential backoff
      log.ts                       # tiny Logger interface
      scheduler.ts                 # per-channel polling with concurrency 1
    pollers/
      types.ts, mock.ts
      reddit-poller.ts             # /message/inbox + OAuth password grant
      mastodon-poller.ts           # /api/v1/conversations multi-instance
      signal-poller.ts             # signal-cli /v1/receive
    routes/
      control.ts                   # /healthz, /v1/version, /v1/status, /v1/admin/*
  test/
    cursors.test.ts (5)
    forwarder.test.ts (8)
    scheduler.test.ts (8)
    control.test.ts (8)
    pollers.test.ts (13)
    round-trip.test.ts (2)
docs/41-dm-poll-forwarder.md
```

## Next steps

- PR review by reviewer agent.
- Once merged, operator wires `POLL_FORWARDER_BEARER` to the corresponding `*_POLLER_BEARER` / `MASTODON_INBOUND_BEARER` env values on the dm-otp side.
- Tunnel ingress entry for `poll.tournamental.com` (admin path remains bearer-protected; consider IP allow-list in addition).
