# @vtorn/drips-bridge

VTourn's bridge to **Drips Network** — the contributor revenue-split scaffold.
VTourn is Apache-2.0; contributors share platform revenue via Drips per the
pitch and README. This service holds the contributor registry, computes
proportional revenue distributions per period, and pushes payouts to Drips
(mock by default; real backend audit-gated).

Port `:3399`. See [`docs/40-drips-network-integration.md`](../../docs/40-drips-network-integration.md)
for the full design + curl examples.

## Run

```bash
pnpm --filter @vtorn/drips-bridge dev      # tsx watch
pnpm --filter @vtorn/drips-bridge test
pnpm --filter @vtorn/drips-bridge typecheck
pnpm --filter @vtorn/drips-bridge build
```

## Env

| Var                    | Required          | Default      | Notes |
| ---------------------- | ----------------- | ------------ | ----- |
| `DRIPS_PORT`           | no                | `3399`       |       |
| `DRIPS_BIND`           | no                | `0.0.0.0`    |       |
| `DRIPS_DATA_DIR`       | no                | `./data/`    | JSONL files live here |
| `DRIPS_ADMIN_SECRET`   | yes (in prod)     | dev-only fallback | `>= 32 chars`. Sent in `x-drips-admin` header. |
| `DRIPS_BACKEND`        | no                | `mock`       | `mock` (default) or `real` |
| `DRIPS_RPC_URL`        | when `real`       | —            |       |
| `DRIPS_ACCOUNT_ADDRESS`| when `real`       | —            |       |
| `DRIPS_PRIVATE_KEY`    | when `real`       | —            | Never commit. Mainnet writes audit-gated. |
| `DRIPS_DRIP_LIST_ID`   | when `real`       | —            |       |

The `real` backend is **stubbed** — it throws on any sign attempt. Mainnet
integration requires an external smart-contract audit per docs/21 + docs/40.

## Quick smoke

```bash
curl -s http://localhost:3399/healthz | jq
curl -s http://localhost:3399/v1/version | jq

# Register a contributor (admin-gated)
curl -s -X POST http://localhost:3399/v1/contributors \
  -H "x-drips-admin: $DRIPS_ADMIN_SECRET" \
  -H "content-type: application/json" \
  -d '{"githubLogin":"alice","activeShares":100,"ethAddress":"0xaaaa...","role":"core"}' | jq

# Create a distribution for $1,500 of receipts
curl -s -X POST http://localhost:3399/v1/distributions \
  -H "x-drips-admin: $DRIPS_ADMIN_SECRET" \
  -H "content-type: application/json" \
  -d '{"period":"2026-05","totalReceiptsUsd":1500}' | jq

# Push to Drips (mock by default)
curl -s -X POST http://localhost:3399/v1/distributions/<id>/push \
  -H "x-drips-admin: $DRIPS_ADMIN_SECRET" | jq
```
