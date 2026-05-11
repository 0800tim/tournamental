# @vtorn/vstamp

Tamper-evident prediction receipts for Tournamental locked brackets. Phase 1 ships
the off-chain layer: a signed Merkle tree per (tournament, day). Phase 2
(see [docs/21-onchain-sweepstakes-oracle.md](../../docs/21-onchain-sweepstakes-oracle.md))
will anchor the daily root on-chain.

> Engine for the marketing claim: **"every locked prediction gets a tamper-proof
> verification stamp."** This service produces those stamps and lets anyone with
> a receipt + public Merkle root verify a bracket was committed at the claimed
> time without trusting Tournamental.

See also [docs/17-vstamp-and-prediction-iq.md](../../docs/17-vstamp-and-prediction-iq.md).

## Why this exists

Three properties shape the design:

1. **Off-chain by default.** Anchoring every receipt on-chain is wasteful at
   our cadence (a busy tournament locks thousands of brackets per minute). The
   service maintains an append-only Merkle tree per tournament-day, signs the
   day's root with an Ed25519 key, and exposes per-leaf inclusion proofs. The
   on-chain anchor is one daily transaction (Phase 2), not one per receipt.
2. **Independently verifiable.** The proof endpoint returns the leaf,
   inclusion proof, signed root, signing public key, and a verification
   recipe. Anyone can recompute the root from `(leaf, proof)` and check the
   signature. We provide a stateless `/v1/vstamp/verify` endpoint as a
   convenience; the `cross-implementation` test in `test/merkle.test.ts`
   re-implements the verifier in self-contained JS to prove it works without
   any of our code.
3. **Privacy-preserving.** The leaf hash binds a 256-bit per-receipt salt:
   `leaf = sha256(0x00 || canonical(bracket) || salt)`. Without the salt, an
   adversary cannot brute-force a guess of the bracket even if the bracket
   space is small. The salt is handed to the user; the bracket itself stays
   server-side until the user opts to publish it.

## Protocol

### Canonical JSON

To make a hash reproducible by anyone holding the raw bracket data, the
bracket is first canonicalised to a single deterministic byte string:

- Object keys sorted lexicographically (UTF-16 code-unit order, the JS default).
- No whitespace.
- Numbers must be finite integers. Floats, NaN, Infinity are rejected.
- `undefined` keys are dropped (JSON.stringify-compatible).
- Cycles raise an error.

This is a small, auditable subset of [RFC 8785](https://datatracker.ietf.org/doc/html/rfc8785)
(JSON Canonicalization Scheme). Full implementation in `src/lib/canonical.ts`;
canonical-determinism tests in `test/canonical.test.ts`.

### Leaf hashing

```
leaf = sha256( 0x00 || canonical(bracket) || salt )
```

The `0x00` prefix is RFC 6962-style **domain separation**. Internal Merkle
nodes are hashed with a `0x01` prefix:

```
node(L, R) = sha256( 0x01 || L || R )
```

Domain separation prevents second-preimage attacks: an attacker cannot submit
a fabricated leaf whose bytes happen to equal an existing internal node's
concatenation, because leaves and nodes hash under different prefixes. See
[Certificate Transparency RFC 6962, §2.1](https://datatracker.ietf.org/doc/html/rfc6962#section-2.1).

### Tree construction

Standard binary Merkle tree. When a level has an odd number of nodes, the
last node is duplicated to pair with itself (Bitcoin-style). Verifiers must
follow the same rule. Per-leaf duplicate-leaf attack
([CVE-2012-2459](https://nvd.nist.gov/vuln/detail/CVE-2012-2459)) does not
apply here: each leaf is a unique 32-byte digest carried alongside its
inclusion proof, so a duplicated-leaf forgery has no corresponding receipt.

### Inclusion proof

```ts
type ProofStep = {
  sibling: string;          // 64 hex chars
  position: 'left' | 'right'; // side the SIBLING sits on
};
```

Verifier algorithm:

```
acc = bytes(leaf_hash)
for each step in proof:
  if step.position === 'left':  acc = sha256(0x01 || bytes(step.sibling) || acc)
  if step.position === 'right': acc = sha256(0x01 || acc || bytes(step.sibling))
assert constant_time_equal(acc, bytes(claimed_root))
assert ed25519.verify(signature, bytes(claimed_root), pubkey)
```

### Signing

Each finalised root is signed with Ed25519. The private key is generated on
first boot, encrypted at rest with AES-256-GCM (key derived via scrypt from
`VSTAMP_KEY_PASSPHRASE`), and stored in the `keys` table. The signed message
is the raw 32-byte root, not its hex string, to avoid hex-case-canonicalisation
ambiguity across language implementations.

## Endpoints

All under `:3390` by default. See `.env.example` for the full config matrix.

| Method | Path                                          | Description |
| ------ | --------------------------------------------- | ----------- |
| POST   | `/v1/vstamp/issue`                            | Add a leaf to the active tournament-day tree. |
| POST   | `/v1/vstamp/finalise/:tournament_id`          | Admin-only. Close the day's tree and sign the root. |
| GET    | `/v1/vstamp/proof/:leaf_hash`                 | Inclusion proof + signed root for a finalised leaf. |
| GET    | `/v1/vstamp/root/:tournament_id/:date`        | Signed root for a (tournament, day). |
| POST   | `/v1/vstamp/verify`                           | Stateless verifier (Merkle + signature). |
| GET    | `/healthz`                                    | Liveness + tree count + latest-root age. |

### Cache policy

Per [docs/22-deployment-and-tunnels.md](../../docs/22-deployment-and-tunnels.md):

- `/healthz`, `/`, `/v1/vstamp/issue`, `/v1/vstamp/finalise/...`, `/v1/vstamp/verify`: `no-store`.
- `/v1/vstamp/proof/:leaf_hash` (after finalisation), `/v1/vstamp/root/...`:
  `public, max-age=60, s-maxage=86400, stale-while-revalidate=604800`. Once a
  tree is sealed the root and proofs are immutable, so aggressive edge caching
  is safe and removes the service from the verification hot path.

## Curl walkthrough (issue → finalise → proof → verify)

This is the exact set of calls used to produce a verifiable receipt
end-to-end. Run from the repo root.

```bash
# 0. Set up env (in a real deployment these are deployment-secret-store values)
export VSTAMP_KEY_PASSPHRASE=$(openssl rand -hex 32)
export VSTAMP_ADMIN_TOKEN=$(openssl rand -hex 32)
export VSTAMP_PORT=3390
export VSTAMP_DB_PATH=./apps/vstamp/data/vstamp.db

# 1. Boot
pnpm --filter @vtorn/vstamp dev
```

In another terminal:

```bash
# 2. Issue a receipt for a locked bracket
curl -s -X POST http://localhost:3390/v1/vstamp/issue \
  -H 'content-type: application/json' \
  -d '{
        "bracket_canonical_json": {
          "final": "ARG-FRA",
          "winner": "ARG",
          "score_arg": 3,
          "score_fra": 3,
          "pens": "4-2"
        },
        "user_id": "u_demo",
        "tournament_id": "wc-demo"
      }'
# → {
#     "leaf_hash": "cc9e...ff89",
#     "salt": "1058...2650",
#     "locked_at": 1778356212747,
#     "day_bucket": "2026-05-09",
#     "tournament_id": "wc-demo",
#     "proof_pending": true
#   }
```

Save the `leaf_hash`, `salt`, and `day_bucket`. The user keeps the salt; you
can throw away the bracket payload server-side because we never persisted it.

```bash
# 3. Admin finalises the day's tree
LEAF=cc9e...   DAY=2026-05-09
curl -s -X POST http://localhost:3390/v1/vstamp/finalise/wc-demo \
  -H "authorization: Bearer $VSTAMP_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"day_bucket\":\"$DAY\"}"
# → {
#     "root_hash": "cc9e...ff89",
#     "signature": "02e0...f407",
#     "pubkey":    "cec1...3e9b",
#     "leaf_count": 1,
#     "already_finalised": false,
#     ...
#   }

# 4. Anyone can fetch the inclusion proof for the leaf
curl -s http://localhost:3390/v1/vstamp/proof/$LEAF
# → { leaf_hash, proof, root_hash, signature, pubkey, verification, ... }

# 5. Anyone can submit the receipt to /verify (or implement the recipe themselves)
curl -s -X POST http://localhost:3390/v1/vstamp/verify \
  -H 'content-type: application/json' \
  -d '{ ...same fields as the proof response... }'
# → { "valid": true }
```

A live verification produced from this walkthrough on 2026-05-10:

```
issue    → leaf_hash 0xcc9e5c9a40447f7d3fbb80e0c7a8ff784ab104fa0fad30f0d3561f6b89e7ff89
issue    → salt      0x1058b4caa27d87f34bd5ca5f74d4a14e6fcde0c51eb8d5d1fee74ec6ffcb2650
finalise → root      0xcc9e5c9a40447f7d3fbb80e0c7a8ff784ab104fa0fad30f0d3561f6b89e7ff89
finalise → sig       0x02e0eab3...f407
finalise → pubkey    0xcec1e15b...3e9b
verify   → { valid: true }
```

(Single-leaf trees have `root === leaf` by construction; this is correct and
matches RFC 6962. As soon as a second leaf joins the tree the root diverges
and the proof contains a sibling.)

## Storage

SQLite via `better-sqlite3`. Three tables — `leaves`, `roots`, `keys` — see
`migrations/0001_init.sql`. The DB is local-only; for HA the operator should
periodically replicate the `roots` table to a separate medium (its rows are
the only externally-meaningful state — leaf payloads are not persisted).

## Configuration

| Env                       | Default                            | Required |
| ------------------------- | ---------------------------------- | -------- |
| `VSTAMP_PORT`             | `3390`                             | no       |
| `VSTAMP_BIND`             | `0.0.0.0`                          | no       |
| `VSTAMP_DB_PATH`          | `./apps/vstamp/data/vstamp.db`     | no       |
| `VSTAMP_ADMIN_TOKEN`      | (unset → finalise returns 503)     | yes (for finalise) |
| `VSTAMP_KEY_PASSPHRASE`   | (unset → service refuses to start) | **yes**  |
| `VSTAMP_CORS_ORIGINS`     | `https://play.tournamental.com,http://localhost:3300` | no |
| `LOG_LEVEL`               | `info`                             | no       |
| `LOG_PRETTY`              | `0`                                | no       |

## Scripts

```bash
pnpm dev         # tsx watch
pnpm build       # tsc → dist/
pnpm start       # prestart compiles, then runs node dist/server.js
pnpm test        # vitest run (86 tests at ship)
pnpm typecheck   # tsc --noEmit
```

## Phase 2 (out of scope for this PR)

- Anchor each finalised root on a testnet smart contract (see
  [docs/21](../../docs/21-onchain-sweepstakes-oracle.md)).
- Add `/v1/vstamp/keys` returning the active and retired pubkeys with their
  rotation timestamps, so verifier clients can pin a known-good set.
- OpenTimestamps integration: submit each root to OTS calendar servers and
  store the returned `.ots` proof per the doc 17 design.
- VStamp ID (`V-2026-W47-A92F-81C` style) issuance + `tournamental.com/v/<id>`
  static proof page.

## Test counts at ship

```
 Test Files  5 passed (5)
      Tests  86 passed (86)
```

Coverage map:

| File                       | Tests |
| -------------------------- | ----- |
| `test/canonical.test.ts`   | 14    |
| `test/keys.test.ts`        | 16    |
| `test/merkle.test.ts`      | 16    |
| `test/receipts.test.ts`    | 17    |
| `test/server.test.ts`      | 23    |

The `test/merkle.test.ts > cross-implementation verifier` block re-implements
the verifier in self-contained code to prove the protocol can be checked
without any of our code.

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/vstamp.openapi.json`](../../docs/api/vstamp.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/vstamp run dump-openapi
# or @tournamental/odds-ingest / @vtorn/wc2026-data-scripts
```
