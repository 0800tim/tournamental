# Audit trail

Tournamental commits a SHA-256 hash of the predictions database to the Bitcoin blockchain at every match kickoff and once a day in between. This document explains exactly what that means, what's in a snapshot, and how disputes are resolved.

The live ledger lives at https://play.tournamental.com/verify.

## What's public vs what's private

- **Public:** the script that produces the snapshots (this repo), the hash chain (`ledger.json`), and the OpenTimestamps receipt (`.ots`) for each hash.
- **Private:** the raw snapshot SQLite files themselves. They contain everyone's in-flight predictions; releasing them publicly mid-tournament would let competitors mine the data and undercut the strategic value of being a player.

Snapshots are released only under the formal **dispute-resolution process** below.

## What it proves

For each anchor at time T:

1. The SQLite database, filtered to the prediction-bearing tables listed below, hashes to a specific SHA-256 digest at time T.
2. That digest is committed into a Bitcoin transaction via the OpenTimestamps protocol within roughly three hours of T.
3. Therefore picks present at T cannot be changed after T without invalidating the on-chain commitment. The hash and the script that produces it are public; the operator cannot quietly rewrite history.

You can verify points 1-3 without ever seeing a snapshot. You only need a snapshot if you want to inspect specific picks (which is what a dispute audit covers).

## What it doesn't prove

- It doesn't prove that the scoring code is correct. The open-source scoring code in `apps/game/` is the proof for that, runnable locally against any released snapshot.
- It doesn't prove that authentication wasn't bypassed at submission time. The auth-sms layer and its session cookies handle that, separately, with its own audit trail.

## What's in a snapshot

The pipeline runs `infra/audit/anchor.sh`. The script takes a `.backup` of `apps/game/data/game.db` (coherent online snapshot, no write lock), drops the tables below, then `VACUUM INTO` a deterministic single-file copy.

**Included** (everything a dispute could need):

- `brackets` — every player's saved pick payload, score, lock time, and share_guid.
- `tournaments` — fixture references the scorer uses.
- `match_results` — recorded outcomes once a match finishes.
- `syndicates` — pool metadata: name, slug, branding, prize text, kickoff lockout flags.
- `syndicate_owners_membership` — who's in which pool, role, opaque user_id, public handle.
- `users` — opaque `u_<hex>` user_id, public display handle. No phone, no email, no IP.

**Excluded** (PII or not relevant):

- `invite_recipients`, `invite_jobs` — contain invitees' phone numbers and email addresses.
- `user_api_keys` — secret material.
- `syndicates_pending_ghl` — CRM sync queue (contact details).
- `bracket_import_audit` — operator log.
- `verified_pundit_records` — reserved for future use.
- `syndicate_members` — legacy table, empty in production.
- `_migrations` — schema-only metadata.

After dropping the excluded tables and `VACUUM INTO`-ing, the same input always produces the same output bytes, so the SHA-256 is deterministic.

## How to verify the timestamping (no snapshot needed)

Anyone can confirm the hash for a given anchor is genuinely on Bitcoin. You only need the receipt, which is public.

```bash
# install the OpenTimestamps client
pip install opentimestamps-client

# download the receipt for any anchor on the ledger
curl -O https://play.tournamental.com/verify/<iso-ts>/snapshot.db.ots

# inspect the receipt structure
ots info snapshot.db.ots
```

`ots info` prints the path the hash takes through one or more OpenTimestamps calendars and ultimately into a Bitcoin transaction (block height + txid once confirmed). The receipt is small (~600 bytes) and self-contained; you can re-verify it offline against any Bitcoin full node.

## Dispute resolution

If you believe a pick of yours, a pool leaderboard position, or a match outcome we've reported is incorrect, we'll release the snapshot covering that match to you (or to a neutral auditor you nominate) so the full predictions table can be inspected against the public hash.

1. Email **info@tournamental.com** with subject line `Audit request`.
2. Include:
   - Your @handle.
   - The match or leaderboard in dispute.
   - The anchor timestamp from the ledger you want released.
   - What you expect the snapshot to show.
3. We'll respond within 48 hours with either:
   - A signed URL to the snapshot file, valid for 7 days, or
   - A written explanation of why we're declining (rare; only if the request would itself leak unrelated user data).
4. You verify offline:
   - `sha256sum snapshot.db` must equal the hash on the public ledger.
   - `ots verify snapshot.db.ots` must return the Bitcoin block height anchoring that hash.
   - Open the SQLite file in any tool: `sqlite3 snapshot.db`.
   - Inspect picks: `SELECT * FROM brackets WHERE share_guid = '<your-share-guid>';`.
   - Re-run the scoring algorithm against the snapshot locally: see `apps/game/src/scoring.ts`.

Disputes that involve a third party (a pool you're in, a match you predicted) may have the snapshot shared with that party too if needed to settle the dispute fairly. We'll always tell you before doing that.

## When anchors are taken

Three triggers:

- **At each match kickoff.** The fixture list has 104 kickoff times across the tournament; the cron is generated once and fires at T-0 for each match. Each anchor proves: the picks for THIS match, as they stood at kickoff, are exactly what's in this snapshot.
- **Daily, at 00:00 UTC.** Catches everything between matches; gives a continuous chain.
- **On demand.** A super-admin can trigger an additional anchor at any time.

Every anchor appears on the public ledger with its trigger reason, hash, file size, and the public OTS receipt.

## Why OpenTimestamps + Bitcoin

OpenTimestamps is the standard non-token Bitcoin timestamping protocol. It batches many digests into a Merkle tree, commits the tree root into a real Bitcoin transaction, and produces a per-digest receipt that proves your hash was in the tree at that block. The protocol is open, the calendar servers are public, the verification math is offline, and Bitcoin's proof-of-work makes after-the-fact rewriting infeasible at any practical cost.

We don't run a calendar server. We submit to the public ones (`a.pool.opentimestamps.org`, `b.pool.opentimestamps.org`, `a.pool.eternitywall.com`, `ots.btc.catallaxy.com`); each one independently batches into Bitcoin so any single calendar going down doesn't break the receipt.

## What changes for VStamp v2

The hash-and-anchor model above proves the database snapshot as a whole. A planned "VStamp v2" upgrade will additionally publish per-pick Merkle proofs so an individual player can prove their specific pick was in a snapshot without us releasing the whole snapshot. The current model is strictly a superset of what VStamp v2 will add — every guarantee here will still hold. VStamp v2 is post-2026.

## The script

Read `infra/audit/anchor.sh`. It's 80 lines of bash. There is no separate signed binary, no hidden step. Everything in the snapshot is determined by the SQL statements in that script, which are listed in plain text above.
