# Drips Network integration (apps/drips-bridge)

> **Status**: v0.1, service scaffolded with a mock Drips client. Real on-chain
> writes are deliberately disabled and gated by an external smart-contract
> audit (see [Mainnet gating](#mainnet-gating)).

## Why this exists

Tournamental is Apache-2.0 licensed. Per the pitch and README, contributors -
human or agent, share Tournamental Holdings' platform revenue through
[Drips Network](https://drips.network). Drips is an Ethereum protocol for
funding open-source projects: a "Drip List" maps recipient wallets to
weighted shares, and senders stream or push payouts proportionally.

`apps/drips-bridge` is the bridge between Tournamental's internal accounting (who
contributed, how much each share is worth this period, which receipts to
distribute) and the on-chain Drip List that actually pays people. Keeping
this in its own service means:

- The contributor registry has a single source of truth.
- Revenue accounting is auditable in a JSONL log, not buried inside the
  finance team's spreadsheet.
- The Ethereum client is isolated, when the audit lands and we flip from
  mock to mainnet, the change is to one service and one env var.

## Contributor onboarding flow

1. A contributor (human or agent) lands a merged PR.
2. The orchestrator (or a future automation hook) registers them via
   `POST /v1/contributors` with `githubLogin` + role.
3. The contributor adds an Ethereum payout address via `PATCH /v1/contributors/:id`
   (`{ ethAddress: "0x..." }`). Until they do, they're tracked but cannot
   receive payouts.
4. Shares are allocated by orchestrator decision (or a future automated
   policy based on PR weight, review hours, etc.) by patching `activeShares`.
5. At month end, a distribution is created and pushed.

## Splits maths

Splits are proportional to `activeShares` at the moment the distribution is
created (snapshotted into `splits[].sharesAtSnapshot` so the audit log holds
the *intent at the time*, even if shares change later).

```
sumShares  = Σ activeShares for contributors with activeShares > 0
share_i    = activeShares_i / sumShares
payout_i   = round2dp(share_i * totalReceiptsUsd)
remainder  = totalReceiptsUsd − Σ payout_i
```

Any rounding remainder (e.g. dividing $100 three ways → $33.33 each, $0.01
left over) is added onto the contributor with the largest `activeShares`.
This keeps `Σ payout = totalReceiptsUsd` exactly (within 1 cent, which the
maths always lands on).

When pushing to Drips, USD payouts are converted to Drips' canonical weight
basis-points-of-1,000,000:

```
weight_i  = floor(payout_i / Σ payout * 1_000_000)
```

with the same remainder-to-largest reconciliation so weights sum to exactly
`1_000_000`.

## Mock vs real backend

| Env var          | Mock (default)            | Real (stubbed)                       |
| ---------------- | ------------------------- | ------------------------------------ |
| `DRIPS_BACKEND`  | `mock`                    | `real`                               |
| Network          | none                      | Sepolia testnet first; mainnet after audit |
| Tx hash          | deterministic SHA-256     | real EVM hash                        |
| Sign attempt     | n/a                       | **throws** until audit lands         |
| Side-effects     | JSONL audit only          | EVM state + JSONL audit              |

The mock backend is sufficient for end-to-end testing of:

- Contributor registry semantics
- Distribution lifecycle (`pending` → `pushed` → `confirmed`)
- Split maths and payout audit log
- API contract for downstream consumers (admin dashboards, finance reports)

## Mainnet gating

The `RealDripsClient` constructor accepts the env that real signing would
need (`DRIPS_RPC_URL`, `DRIPS_ACCOUNT_ADDRESS`, `DRIPS_PRIVATE_KEY`,
`DRIPS_DRIP_LIST_ID`) but **both `setSplits` and `pushPayout` throw**. This
is intentional: the audit-gate is enforced in code, not just in docs.

Before we ship real mainnet writes:

1. External smart-contract audit of:
   - The Drip List contract version we target.
   - Any custom multisig / treasury wrapping we add (planned per docs/21).
   - The owner-key custody story (HSM? Safe multisig? both?).
2. Sepolia run-through with the real client wired (still gated by audit).
3. Per-PR review checklist updated to include "no mainnet writes added"
   until the audit is signed off.
4. Switch flipped via env (`DRIPS_NETWORK=mainnet`), never via code change
   that has to be re-reviewed.

## API reference

All write routes require the header `x-drips-admin: <DRIPS_ADMIN_SECRET>`.
GET `/v1/contributors` is also admin-gated (it reveals roles and shares).
GET `/healthz` and `/v1/version` are open.

### `POST /v1/contributors`

Idempotent on `githubLogin` (case-insensitive). With `upsert: true`, merges
patchable fields onto an existing record.

```bash
curl -s -X POST http://localhost:3399/v1/contributors \
  -H "x-drips-admin: $S" -H "content-type: application/json" \
  -d '{
    "githubLogin": "alice",
    "displayName": "Alice Example",
    "role": "core",
    "activeShares": 100,
    "ethAddress": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

Response: `201 Created` (new) or `200 OK` (existing, no patch unless `upsert`).

### `PATCH /v1/contributors/:id`

```bash
curl -s -X PATCH http://localhost:3399/v1/contributors/c_xxx \
  -H "x-drips-admin: $S" -H "content-type: application/json" \
  -d '{"activeShares": 150, "ethAddress": "0xbb...bb"}'
```

### `GET /v1/contributors`

Lists all contributors, sorted by `joinedAt` ascending.

```bash
curl -s http://localhost:3399/v1/contributors -H "x-drips-admin: $S"
```

### `POST /v1/distributions`

Snapshots current contributors and computes splits.

```bash
curl -s -X POST http://localhost:3399/v1/distributions \
  -H "x-drips-admin: $S" -H "content-type: application/json" \
  -d '{"period": "2026-05", "totalReceiptsUsd": 1500.00}'
```

Returns `409 no_eligible_contributors` if no contributor has `activeShares > 0`.

### `POST /v1/distributions/:id/push`

Pushes the snapshot to the Drips backend (mock or real). Refuses if any
contributor in the splits is missing `ethAddress`.

```bash
curl -s -X POST http://localhost:3399/v1/distributions/d_xxx/push \
  -H "x-drips-admin: $S"
```

Returns the updated distribution with `status: 'pushed'` and a `txHash`
stamped on each split.

### `GET /v1/distributions/:id`

```bash
curl -s http://localhost:3399/v1/distributions/d_xxx -H "x-drips-admin: $S"
```

## Storage

Both stores are append-only JSONL:

- `data/contributors.jsonl`, `{ op: 'insert' | 'patch' | 'delete', ... }`
- `data/distributions.jsonl`, `{ op: 'insert' | 'status', ... }`

Append-only means the file doubles as an audit log: every state change is a
new line, replaying the file rebuilds the in-memory state. Corrupt lines
(e.g. a torn write on power loss) are skipped on replay rather than
crashing the service.

For a higher-volume future, the same envelope shape ports cleanly to
Postgres (one table per record kind, primary key on `(id, op_seq)`).

## Open follow-ups

- **Idempotent push**: cache `dist.id → txHash` so `POST .../push` retries
  short-circuit instead of double-broadcasting on the real backend.
- **USD → ETH oracle**: real payouts need a price feed (Chainlink) so the
  on-chain transfer matches the off-chain USD amount.
- **Multi-period distributions**: support batching multiple periods in one
  push when receipts arrive late.
- **Eligibility policy**: soft-deprecate `activeShares=0` contributors,
  notify them by email/Telegram before zeroing.
- **Receipts ingestion**: a downstream service (or webhook from Stripe /
  affiliate router) creates the distribution automatically at month end.

Refs: README, Tournamental Pitch.md, docs/21, AGENT-PROMPTS.md.
