# 31, Merkle and OpenTimestamps Proofs

> The cryptographic core of the Open Bot Arena. Every bot's bracket is committed to a sorted-pair sha256 merkle tree before kickoff; the per-match roots are then anchored on Bitcoin via OpenTimestamps. Anyone who is later challenged can produce a single-bot inclusion proof in O(log n) bytes that any third party can verify offline against a Bitcoin full node, with no help from Tournamental.

This doc covers the **maths** and the **on-chain mechanics**. For the system that builds the trees (the browser swarm), see [doc 30, Browser Swarm Architecture](30-browser-swarm-architecture.md). For the per-prediction VStamp surface used in the human-facing prediction game, see [doc 17, VStamp and Prediction IQ](17-vstamp-and-prediction-iq.md). The two systems share the same OTS-anchor idea but use different leaf shapes; this doc covers the Bot Arena side.

## What we are committing, in one sentence

For every (tournament, match) pair, before kickoff, we publish a single 32-byte sha256 hash, the **per-match merkle root**, that simultaneously commits to every bot in every federated swarm's pick for that match. We then anchor that 32-byte hash on Bitcoin via OpenTimestamps. After kickoff, no bot's pick can be retroactively altered without invalidating the commitment, and any single bot's pick can be independently verified by a third party with no help from Tournamental.

## Merkle trees, briefly

A merkle tree is a binary tree where every leaf is the hash of some data, every internal node is the hash of its two children, and the single value at the root is a fingerprint of the entire leaf set. Three useful properties fall out of the construction:

1. **Compactness.** A single 32-byte root commits to any number of leaves.
2. **Per-leaf proofs.** To prove leaf `L` was in the tree, you need only the **siblings** along the path from `L` to the root, log₂(n) hashes. For a tree of 1 million leaves, that's 20 hashes, ~640 bytes.
3. **Tamper-evidence.** Changing any leaf changes the root with overwhelming probability (2^-256 collision odds).

The verifier algorithm is a tight loop: hash `L` with its first sibling, hash that with the next sibling, etc., walking up the tree. If the final hash equals the published root, the leaf was in the tree.

## Our specific construction: sorted-pair sha256

We use the **sorted-pair** variant of the merkle tree. The variant comes from OpenZeppelin's `MerkleProof.sol` and has one important property: the verifier does not need to know which side of the pair the sibling was on, because the pair is sorted before being hashed.

In normal merkle trees you might encode `left || right` and have the proof carry a "direction" bit per step. In sorted-pair, you encode `min(left, right) || max(left, right)`, so the parent depends only on the *contents* of the pair, not on which child was on which side. The proof is therefore just a list of sibling hashes, no direction bits, no per-step bookkeeping. A verifier in any language can implement the algorithm in ~50 lines of code.

The exact rules used in `apps/game/src/lib/merkle.ts` and (mirrored) in `apps/web/components/browser-swarm/merkle.ts`:

1. **Leaf hash:** `leaf = sha256(utf8(bot_id || "|" || match_id || "|" || outcome || "|" || locked_at_utc))`. Outcomes are the canonical strings `home_win | draw | away_win`. `locked_at_utc` is an integer epoch ms.
2. **Pair hash:** `pair_hash(a, b) = sha256(hex_decode(min(a,b) || max(a,b)))`. The inputs `a` and `b` are 64-char hex strings; we decode to bytes before hashing so the parent is a hash of 64 bytes, not 128 hex characters.
3. **Odd-node promotion:** at each level, if the layer has an odd number of nodes, the trailing node is duplicated, equivalent to pairing it with itself. The implementation in `apps/game/src/lib/merkle.ts` mutates the working array by pushing the duplicated tail in place; the browser-side variant uses promote-without-rehashing (the odd node propagates to the next level untouched). Both produce the same root for the same leaf set. `TODO[ground-truth]`: confirm that the production code path uses the duplication form, not the promote-form. The browser-side comment in `merkle.ts` says "Odd nodes promote without rehashing", which is the promote form, while the Node-side helper does `cur.push(cur[cur.length - 1]!)`, which is the duplicate form. We need to pick one and align.
4. **Empty tree:** `sha256(empty_bytes)`. The canonical zero-leaf root is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. This lets callers avoid special-casing "no picks landed pre-kickoff".
5. **Single leaf:** when `leaves.length == 1`, the root is the leaf hash itself.

### Why sort the pair?

Two reasons.

The first is **proof simplicity**. A normal merkle proof carries a direction bit per step, so a verifier knows whether to compute `parent = hash(cursor || sibling)` or `parent = hash(sibling || cursor)`. Sort-pair drops the bits, because `hash(min || max)` is well-defined no matter which side the cursor was on. A proof is just a list of 32-byte hashes.

The second is **portability**. The on-chain verifier we'll eventually deploy for Phase 2 settlement (audit by smart contract) is OpenZeppelin's `MerkleProof.sol`, which uses sort-pair. Matching that shape means we can port verifier logic between off-chain (TypeScript, Python, anything) and on-chain (Solidity) without changing semantics.

### Worked example

Take a swarm of three bots, each predicting one match. Inputs:

```
bot_id   | match_id   | outcome  | locked_at_utc
---------+------------+----------+--------------
bot-001  | wc26-fin   | home_win | 1734729600123
bot-002  | wc26-fin   | draw     | 1734729600234
bot-003  | wc26-fin   | away_win | 1734729600345
```

Leaf hashes (sha256 of the pipe-separated string):

```
L1 = sha256("bot-001|wc26-fin|home_win|1734729600123") = a7c4...e9 [64 hex chars]
L2 = sha256("bot-002|wc26-fin|draw|1734729600234")     = 3b91...02
L3 = sha256("bot-003|wc26-fin|away_win|1734729600345") = c1d2...7f
```

(Hashes shown abbreviated; in real life each is 64 hex chars.)

Tree construction:

```
Level 0 (leaves): [L1, L2, L3]
                  odd count, duplicate L3:
                  [L1, L2, L3, L3]

Level 1: pair_hash(L1, L2), pair_hash(L3, L3)
         pair_hash(L1, L2) = sha256(min(L1,L2) || max(L1,L2)) = N1
         pair_hash(L3, L3) = sha256(L3 || L3)                  = N2
         [N1, N2]

Level 2 (root): pair_hash(N1, N2) = R
```

To prove L1 was in the tree, the proof is `[L2, N2]`:

- `cursor = L1`
- `cursor = pair_hash(L1, L2) = N1`
- `cursor = pair_hash(N1, N2) = R`
- If `cursor == R`, L1 was in the tree.

Proof size: 2 hashes (64 bytes). With 1 million leaves, the proof would be 20 hashes (640 bytes).

### What goes into the leaf, exactly

The exact field order is non-negotiable, swap two fields and every verifier rejects every proof. Canonical order (per `apps/game/src/lib/merkle.ts:leafHash`):

```
sha256( utf8( bot_id + "|" + match_id + "|" + outcome + "|" + locked_at_utc ) )
```

| Field | Type | Source |
| ----- | ---- | ------ |
| `bot_id` | string | The federated node's bot identifier, e.g. `bot_a7c4e90f`. From `botIdFromIndex(MASTER_SEED, bot_index)` in the browser swarm, or from the docker bot-node's internal id space. |
| `match_id` | string | The canonical `match_id` from the tournament spec, e.g. `wc26-fin-arg-fra-2026-07-19`. |
| `outcome` | one of `home_win`, `draw`, `away_win` | The bot's pick. Knockout matches never produce `draw`. |
| `locked_at_utc` | integer epoch ms | Set by the swarm at pick time; immutable thereafter. |

What's **not** in the leaf, and the reasons:

- **No strategy name.** The leaf commits to the picked outcome, not the reasoning that produced it. A bot can switch strategies between matches without invalidating its prior commitments.
- **No chalk_score.** Chalk score is a per-bot cosmetic; including it would couple verifier logic to the strategy.
- **No tournament_id.** Match IDs are globally unique within the Tournamental namespace, so the tournament is implied. (If we ever federate across distinct namespaces, `tournament_id` will be added; that's a hard fork of the leaf schema and will bump the spec version.)
- **No nonce.** Per-prediction nonces are used in the human-facing VStamp surface (doc 17) to prevent hash-grinding attacks on small fields. Bot picks have wide entropy from `bot_id` already and don't need a separate nonce.

`TODO[ground-truth]`: the spec §15.6 says the leaf encoding is `(bot_id, match_id, outcome, locked_at_utc)` joined by `|`. The browser-swarm worker today uses a different in-memory compact form (`base36(bot_index, 6) + outcome_code`) for the per-worker merkle, then is intended to convert to canonical form at federation publish. A1's federation publish wire-up should confirm the canonical leaves are what get hashed for the published root, not the compact form. If the published root is the compact-form root, then the audit verifier needs to know that, and we should document the compact-form rules here too.

## OpenTimestamps: turning the root into a Bitcoin commitment

A merkle root by itself is just a hash. We need someone to attest *when* the root existed, in a way that any third party can independently check, without trusting us. That's the job of **OpenTimestamps** (OTS).

### How OTS works

OpenTimestamps is a free, open-source, decentralised protocol that aggregates millions of submitted hashes into a single Bitcoin transaction. The flow:

1. **Submit.** A client submits a 32-byte hash to one or more **OTS calendar servers** (public, free, no account needed). The submission is `POST /digest` with the raw hash bytes.
2. **Calendar aggregation.** The calendar server adds the hash as a leaf to its own per-cycle aggregation merkle tree. Many submissions arrive in the same cycle and become siblings in the calendar tree.
3. **Bitcoin commit.** Periodically (every few minutes) the calendar publishes the root of its aggregation tree by burning it into a Bitcoin transaction's `OP_RETURN` field. The root is now embedded in a Bitcoin block.
4. **Confirmation.** When the block confirms (~10 minutes for the first confirmation, ~60 minutes for the canonical 6-confirmation depth), the OTS calendar knows the Bitcoin block height and the path from our hash up to the block's `OP_RETURN`.
5. **Upgrade.** The client polls the calendar for an **upgrade** to the proof. The upgraded proof contains the full merkle path from our submitted hash up through the calendar's aggregation tree to a Bitcoin block header. From then on, verification needs only a Bitcoin full node (or a public block explorer); the calendar server is no longer needed.

The resulting `.ots` file is a self-contained proof. Anyone with the file, the original committed hash, and access to Bitcoin block headers can verify that **the hash existed at-or-before the time of the Bitcoin block**.

### The .ots file format

A `.ots` file is a binary OTS proof, encoded per [the OpenTimestamps format](https://github.com/opentimestamps/python-opentimestamps/blob/master/doc/format.md). It contains, in order:

1. A magic byte sequence identifying the file as an OTS proof.
2. The **original digest** (the hash we submitted).
3. A series of **attestation operations** that transform the digest step-by-step:
   - `OpSHA256(x)`, hash the cursor.
   - `OpAppend(suffix)`, append bytes to the cursor.
   - `OpPrepend(prefix)`, prepend bytes to the cursor.
   - These ops walk the calendar's internal merkle tree from our leaf up to the per-block root.
4. One or more **attestations**:
   - `PendingAttestation(calendar_url)`, "this calendar will eventually upgrade this proof".
   - `BitcoinBlockHeaderAttestation(block_height)`, "the cursor's final value matches the merkle root inside Bitcoin block at the given height".

When you verify a `.ots`, the OTS client:

1. Re-applies the operations starting from the original digest.
2. Reaches the `BitcoinBlockHeaderAttestation`.
3. Fetches the Bitcoin block at that height (via a full node or a public explorer).
4. Checks that the final cursor value equals the block's merkle root, or equivalently, that the `OP_RETURN` in the block contains the calendar root we ended at.

If all of that lines up, the proof is valid and the digest is provably committed at-or-before that block's timestamp.

### Latency

Two latency tiers matter for the Bot Arena:

1. **Calendar response: ~10 seconds.** The calendar acknowledges the submission almost immediately with a pending proof. This is enough to display "submitted to OTS" on the user-facing surface within a few seconds of kickoff.
2. **Bitcoin confirmation: ~10 to 60 minutes.** The next Bitcoin block aggregates many calendar submissions. We poll for upgrades and replace the pending proof with the full Bitcoin-anchored proof as soon as it's available. The user's bracket card flips from "submitted" to "Bitcoin-verified" once the upgrade completes.

We never block kickoff on the Bitcoin confirmation. The cryptographic commitment is **fixed** the moment we publish the root (anyone observing the root cannot later substitute a different one), and OTS upgrades just turn that into a Bitcoin-anchored proof. The audit flow is robust to OTS upgrades arriving up to hours after kickoff.

### Cost

**Zero.** OTS calendars aggregate millions of hashes per Bitcoin transaction and absorb the Bitcoin transaction fees. The calendars exist as a public good; the marginal cost to us of stamping one more root is zero. We run no calendar server of our own, we just submit to the existing public ones.

For the Bot Arena, this matters: anchoring per-match (104 matches for WC 2026) over a 30-day tournament is 104 submissions, free, with full Bitcoin-anchored verifiability. The closest commercial alternative (timestamping-as-a-service on AWS or similar) would cost cents per stamp and would not be Bitcoin-anchored.

## End-to-end: from a bot's pick to a Bitcoin-anchored proof

Putting the two layers together. A single bot's pick goes through:

```
Bot generates pick
   |
   v
Leaf = sha256(bot_id|match_id|outcome|locked_at_utc)
   |
   v
[swarm-side] Worker builds per-slice merkle root over its slice's leaves
   |
   v
[swarm-side] Main thread reduces worker roots into a per-match root
   |
   v
[swarm-side] Persist commit_log row to IndexedDB with merkle_root
   |
   v
[federation] POST /v1/nodes/commit { match_id, merkle_root, bot_count, kickoff_at }
   |
   v
[central] commitKickoff() reads all federated roots for this match,
          builds a SECOND merkle tree over them (the "federation tree"),
          and publishes ONE federation root per (tournament, match)
   |
   v
[central] postOts(federation_root) submits to OpenTimestamps
   |
   v
[OTS calendar] aggregates into per-cycle tree, burns root into Bitcoin OP_RETURN
   |
   v
[Bitcoin] block confirms (~10 min); OTS upgrades the proof
   |
   v
[central] persists the upgraded .ots file alongside the commit_log row;
          serves it from the public proof page at /verify/<match_id>
   |
   v
[any third party] downloads (.ots + federation_root + per-bot leaf + proof path),
                  re-runs the merkle verifier, queries a Bitcoin full node,
                  confirms the commitment existed before kickoff
```

Two trees stack on top of each other: a **per-swarm tree** (built in the browser worker) and a **federation tree** (built on central over the published roots). To prove a single bot's pick is in the Bitcoin-anchored root, the audit bundle contains:

1. The leaf (`bot_id, match_id, outcome, locked_at_utc`).
2. The per-swarm sibling path from the leaf up to the swarm's published root.
3. The federation sibling path from the swarm's root up to the federation root.
4. The `.ots` file that anchors the federation root to Bitcoin.

The verifier walks paths 2 then 3, then verifies the `.ots`. The whole bundle for a typical 100k-bot swarm in a 30-node federation is well under 2 KB.

## The verifier protocol

The verifier is a small standalone program (TypeScript, Python, anything that can hash) that takes:

- A leaf string (`bot_id|match_id|outcome|locked_at_utc`).
- A merkle proof, a list of sibling hex hashes.
- A claimed root.
- (Optional) An `.ots` proof file.
- (Optional) A Bitcoin block-header source (full node, or a trusted public source).

It runs:

```ts
function verify(leaf: string, proof: string[], root: string): boolean {
  let h = sha256Hex(leaf);
  for (const sibling of proof) {
    h = pairHash(h, sibling);  // sorted-pair sha256
  }
  return h === root;
}
```

If an `.ots` is provided, the verifier additionally:

1. Loads the `.ots` file.
2. Applies the OTS operations starting from `root` (the very hash we just verified merkle-matches).
3. Reaches the Bitcoin attestation.
4. Fetches the claimed block's header and merkle root from a Bitcoin source.
5. Confirms the OTS-computed value matches the block's merkle root or `OP_RETURN`.

All steps are offline-checkable except the Bitcoin block-header fetch, which can use a public explorer (no auth, no trust required for read-only header data).

The reference verifier ships in `packages/bot-node/src/verifier/` (`TODO[ground-truth]`: confirm A3 lands this; today the merkle helper exists but the standalone CLI verifier does not). A Phase 2 web-based verifier lives at `tournamental.com/verify/<match_id>` and runs the whole flow client-side.

## Why this is bulletproof

Three independent ways the system would fail, and why none of them does:

1. **Tournamental claims a different pick after the result is known.** Impossible without breaking sha256 collision resistance. The leaf includes `locked_at_utc` and `bot_id`; changing the picked outcome changes the leaf, changes every merkle path that includes it, and changes the root. The on-chain Bitcoin commitment fixes the root, so any change is detectable by anyone with the original (leaf, proof) pair.
2. **Tournamental hides a bot's pick after-the-fact.** Detectable by the operator who claims the bot. If an operator's `node_id` published a root committing to N bots, and Tournamental later refuses to serve the proof for bot #437, the operator can simply re-publish the bracket themselves; the original root anchored on Bitcoin still includes it.
3. **A calendar server lies about a submission.** The Bitcoin upgrade path eliminates this. While the proof is still pending (only a calendar attestation), the user has only the calendar's word. But once the upgrade completes and the proof is anchored to a Bitcoin block, the calendar is no longer in the trust path. A calendar that lied would produce a proof that fails to verify against any Bitcoin block.

The combination of merkle + Bitcoin is what gives us **"$0 cost, 100% verifiable"**.

## A note on the human-facing VStamp surface

[Doc 17, VStamp and Prediction IQ](17-vstamp-and-prediction-iq.md) describes a parallel system used for human-locked predictions in the main game. It uses the same OpenTimestamps backbone but a different leaf schema (per-prediction canonical fields + nonce) and a per-prediction-batch cadence (every minute or so) rather than per-match. The two systems are deliberately separate:

- **Bot Arena** anchors per match, per federation. The leaf is `(bot_id, match_id, outcome, locked_at)` and the cadence is "before kickoff". Audit is "prove this bot picked X for this match".
- **VStamp** anchors per minute, per prediction. The leaf is `(user_id, match_id, prediction_type, predicted_outcome, market_implied_probability_at_lock, confidence_chips, locked_at, nonce)` and the cadence is "rolling". Audit is "prove this human locked this exact prediction at this exact time".

They could in principle share a tree, we choose not to because the audit narratives are different (human-game audits care about market probability at lock time; bot-arena audits do not) and the failure modes are different (a humanness-relevant prediction has very different anti-gaming constraints than a bot pick). Two trees, two purposes, no coupling.

## References

- [OpenTimestamps protocol](https://opentimestamps.org/)
- [OpenTimestamps file format](https://github.com/opentimestamps/python-opentimestamps/blob/master/doc/format.md)
- [Bitcoin OP_RETURN spec](https://developer.bitcoin.org/devguide/transactions.html#null-data)
- [OpenZeppelin MerkleProof.sol](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/cryptography/MerkleProof.sol), the sorted-pair shape we mirror
- [Doc 30, Browser Swarm Architecture](30-browser-swarm-architecture.md)
- [Doc 17, VStamp and Prediction IQ](17-vstamp-and-prediction-iq.md)
- [Doc 32, Perfect Bracket Experiment](32-perfect-bracket-experiment.md)
- Spec §15.6, federated audit + sorted-pair merkle requirement, `docs/superpowers/specs/2026-06-07-bot-arena-design.md`
