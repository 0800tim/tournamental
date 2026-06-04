# Audit trail

Tournamental commits the predictions database to the Bitcoin blockchain at every match kickoff and once a day. This document explains exactly what that means, what's in the snapshots, and how anyone can verify offline that picks weren't changed after a match started.

The live ledger lives at https://play.tournamental.com/verify.

## What it proves

For each anchor at time T:

1. The SQLite database, filtered to the prediction-bearing tables listed below, hashes to a specific SHA-256 digest at time T.
2. That digest is committed into a Bitcoin transaction via the OpenTimestamps protocol within roughly three hours of T.
3. Therefore picks present at T cannot be changed after T without invalidating the on-chain commitment.

**What it doesn't prove:**

- It doesn't prove that the scoring code is correct (the open-source scoring code in `apps/game/` is the proof for that).
- It doesn't prove that authentication wasn't bypassed at submission time (the auth-sms layer and its session cookies handle that, separately).

For the practical question "can the operator quietly change someone's pick after a match kicks off" the answer under this system is no, not without leaving a public unmissable trail.

## What's in a snapshot

The pipeline runs `infra/audit/anchor.sh`. The script takes a `.backup` of `apps/game/data/game.db` (coherent online snapshot, no write lock), drops the tables below, then `VACUUM INTO` a deterministic single-file copy.

**Included** (everything the bet depends on):

- `brackets` — every player's saved pick payload, score, lock time, and share_guid.
- `tournaments` — fixture references the scorer uses.
- `match_results` — recorded outcomes once a match finishes.
- `syndicates` — pool metadata: name, slug, branding, prize text, kickoff lockout flags.
- `syndicate_owners_membership` — who's in which pool, role, opaque user_id, public handle.
- `users` — opaque `u_<hex>` user_id, public display handle. No phone, no email, no IP.

**Excluded** (PII or not relevant to the bet):

- `invite_recipients`, `invite_jobs` — contain invitees' phone numbers and email addresses.
- `user_api_keys` — secret material.
- `syndicates_pending_ghl` — CRM sync queue (contact details).
- `bracket_import_audit` — operator log.
- `verified_pundit_records` — reserved for future use.
- `syndicate_members` — legacy table, empty in production.
- `_migrations` — schema-only metadata.

After dropping the excluded tables and `VACUUM INTO`-ing, the same input always produces the same output bytes, so the SHA-256 is deterministic.

## How to verify

You need three things: the snapshot file, its `.ots` receipt, and the `ots` client (Python, free).

```bash
# 1. install the OpenTimestamps client
pip install opentimestamps-client

# 2. pick an anchor from https://play.tournamental.com/verify
#    and download both files
curl -O https://play.tournamental.com/verify/<iso-ts>/snapshot.db
curl -O https://play.tournamental.com/verify/<iso-ts>/snapshot.db.ots

# 3. confirm the hash matches what's printed on the verify page
sha256sum snapshot.db

# 4. verify the OpenTimestamps receipt
ots verify snapshot.db.ots
```

The `ots verify` step walks the receipt up to a Bitcoin block header and tells you the block height and timestamp of the on-chain commitment. If the receipt is still "pending" (no Bitcoin block yet — recent anchors take 1-3 hours to upgrade), run `ots upgrade snapshot.db.ots` first.

## What you can do with the snapshot

Once you've verified the hash and the receipt:

- Open the snapshot in any SQLite tool: `sqlite3 snapshot.db`.
- Inspect anyone's picks: `SELECT * FROM brackets WHERE share_guid = '<the-shared-guid>';`.
- Re-run the scoring code locally to confirm leaderboard positions: see `apps/game/src/scoring.ts` for the algorithm.
- Compare two snapshots over time: every pick that's present in an earlier snapshot must be byte-identical in every later snapshot, modulo the official kickoff lockout rules.

## When anchors are taken

Three triggers:

- **At each match kickoff.** The fixture list has 104 kickoff times across the tournament; the cron is generated once and fires at T-0 for each match. Each anchor proves: the picks for THIS match, as they stood at kickoff, are exactly what's in this snapshot.
- **Daily, at 00:00 UTC.** Catches everything between matches; gives a continuous chain.
- **On demand.** A super-admin can trigger an additional anchor at any time, e.g. immediately before a public claim ("here's the leaderboard at this exact moment").

Every anchor appears on the public ledger with its trigger reason, hash, file size, and download links.

## Why OpenTimestamps + Bitcoin

OpenTimestamps is the standard non-token Bitcoin timestamping protocol. It batches many digests into a Merkle tree, commits the tree root into a real Bitcoin transaction, and produces a per-digest receipt that proves your hash was in the tree at that block. The protocol is open, the calendar servers are public, the verification math is offline, and Bitcoin's proof-of-work makes after-the-fact rewriting infeasible at any practical cost.

We don't run a calendar server. We submit to the public ones (`a.pool.opentimestamps.org`, `b.pool.opentimestamps.org`, `a.pool.eternitywall.com`, `ots.btc.catallaxy.com`); each one independently batches into Bitcoin so any single calendar going down doesn't break the receipt.

## What changes for VStamp v2

The hash-and-anchor model above proves the database snapshot as a whole. A planned "VStamp v2" upgrade will additionally publish per-pick Merkle proofs so an individual player can prove their specific pick was in a snapshot without downloading the entire snapshot. The current model is strictly a superset of what VStamp v2 will add — every guarantee here will still hold. VStamp v2 is post-2026; the bet-the-house claim for this tournament rests on what's in this document.

## The script

Read `infra/audit/anchor.sh`. It's 60 lines of bash. There is no separate signed binary, no hidden step. Everything that the snapshot contains is determined by the SQL statements in that script, which are listed in plain text above.
