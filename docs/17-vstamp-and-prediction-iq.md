# 17, VStamp and Prediction IQ

> Two related things that together turn Tournamental from "another tipping comp" into a credible reputation network. **VStamp** is the cryptographic verification of *what* you predicted *when*. **Prediction IQ** is the long-term reputation score derived from a verified history of your calls. Engine in `apps/vstamp-service`; shared with `apps/game-service` (agent J, [doc 09](09-agent-task-breakdown.md)).

## Why this matters

The single feature that makes Tournamental stronger than every other tipping comp is the *verifiability* of historical predictions. A leaderboard alone is bragging rights; a verifiable on-chain history is a reputation asset.

Three concrete benefits:

1. **Trust.** Users (and the platform) cannot retroactively edit a prediction to look smarter than they were. The leaderboard is therefore *trustworthy*, not just an internal score.
2. **Portability.** A user's Prediction IQ is a public, auditable identity component. They can show it to anyone (a sportsbook, a media employer, a fantasy podcast) without Tournamental needing to vouch.
3. **Marketing.** "Every locked prediction gets a tamper-proof verification stamp." The story sells itself; the implementation is cheap.

The user does not need to understand blockchain. The platform's user-facing message is just:

> Every locked prediction gets a verification stamp. Nobody can edit it after the fact, not you, not Tournamental, not the leaderboard.

## VStamp architecture

### What gets stamped

For every locked prediction, the canonical fields are hashed:

```
hash_input = sha256(
    user_id
  + match_id
  + tournament_id
  + prediction_type
  + predicted_outcome
  + market_implied_probability_at_lock     (6 decimal places, fixed)
  + confidence_chips_committed
  + locked_at_unix_ms
  + nonce                                  (random 16 bytes, prevents collisions)
)
```

This hash is the prediction's *fingerprint*. Anyone with the original prediction record can recompute it; nobody can reverse-engineer the prediction from the hash alone.

### Merkle batching (don't anchor per prediction)

Anchoring every individual prediction on a blockchain would be slow and expensive at our scale (a busy match can produce thousands of predictions in seconds). Instead, batch.

Every minute (configurable):

1. Take all prediction hashes locked in the past minute.
2. Build a Merkle tree from them.
3. The Merkle root is a single 32-byte value that commits to *all* predictions in that batch.
4. Anchor the Merkle root on-chain.
5. Store the per-prediction Merkle proof (the sibling hashes path from leaf to root) so any individual prediction can later be proven to have been in the batch.

This compresses 10,000 predictions into one on-chain transaction while preserving full per-prediction verifiability.

```
                        Merkle Root  (anchored on-chain)
                           /     \
                       /             \
                   /                     \
          Hash(A,B)                  Hash(C,D)        ← internal nodes
            /    \                     /    \         (sibling hashes
           /      \                   /      \         form the proof)
        H(A)    H(B)                H(C)    H(D)
         |       |                   |       |
       pred A  pred B              pred C  pred D
```

To verify prediction B was in the batch, a verifier checks:
`Hash( Hash( H(A), H(B) ), Hash(C,D) ) == on-chain Merkle root`

Standard Merkle proof, ~32 bytes per tree level (so ~448 bytes for a 16,000-prediction batch, log₂(16k) × 32B). Stored alongside each prediction in Redis and the off-chain prediction record.

### Two anchoring options (we ship both)

**Option A, OpenTimestamps (free, Bitcoin-anchored, the default).**

[OpenTimestamps](https://opentimestamps.org/) is a free, decentralised timestamping protocol that bundles thousands of submitted hashes into a single Bitcoin transaction. We submit our Merkle root to OTS calendar servers; ~10–60 minutes later, when the next batch's parent Bitcoin block confirms, we get back a `.ots` proof file that proves our root was committed at-or-before that block's time. Verification is offline, anyone with the OTS Python or JS client can check the proof against a Bitcoin full node.

Cost: **zero** to us. The OTS servers cover the Bitcoin transaction fees because they aggregate millions of stamps per transaction. Latency: ~10–60 minutes to "Bitcoin-confirmed". Strongest immutability story possible (Bitcoin-anchored). This is the right default for the product.

**Option B, Polygon (or Base) on-chain anchor (fast, near-free, programmatic).**

For high-profile tournaments and the user-facing "VStamp confirmed" badge that should appear within a minute, also write the Merkle root to a smart contract on a cheap L2. Polygon mainnet transactions cost ~$0.001–0.005 each at typical gas. Base (Coinbase L2) is similar. With a 1-minute batch cadence, that's roughly $1.50–7.50/day during a tournament, trivial.

The smart contract is a one-line storage:

```solidity
contract VStampRegistry {
    event RootAnchored(bytes32 indexed merkleRoot, uint256 batchId, uint256 timestamp);
    mapping(uint256 => bytes32) public batches;

    function anchor(uint256 batchId, bytes32 merkleRoot) external {
        require(msg.sender == anchorBot, "unauthorized");
        require(batches[batchId] == 0, "already anchored");
        batches[batchId] = merkleRoot;
        emit RootAnchored(merkleRoot, batchId, block.timestamp);
    }
}
```

A single signing key (cold-stored, rotated quarterly) is the only writer. Anyone can read.

**Recommended deployment**: ship Polygon as the primary user-facing anchor (instant) *and* OpenTimestamps as the redundancy + Bitcoin-grade story (catches up within an hour). The combination is cheap, fast, and strongest-possible, and if Polygon ever has an outage, the OTS layer keeps the chain unbroken.

### VStamp ID

Every prediction gets a human-friendly identifier:

```
VStamp:  V-2026-W47-#A92F-81C
         │   │     │     │
         │   │     │     └─ random 3-char checksum
         │   │     └─────── 4-char hex prefix of the prediction hash
         │   └───────────── batch id within the season ("week 47")
         └───────────────── tournament season tag
```

Compact, copyable, human-readable. Each VStamp resolves to a public proof page at `https://tournamental.com/v/V-2026-W47-A92F-81C` showing:

- The prediction's canonical fields.
- The full hash.
- The Merkle proof.
- The on-chain transaction hash (Polygon) and OpenTimestamps proof (linkable).
- A "verify yourself" button that runs the Merkle check in the user's browser.

The proof page is a static prerendered HTML, pure CDN read, zero backend on the verification path.

### What a VStamp verifies, and what it does NOT

Read this section carefully; it shapes how the platform talks about Verified Pundits, Prediction IQ, and any branded content that uses the verification badge.

A VStamp **verifies**:

- That a specific prediction's canonical fields, hashed, were committed to a Merkle batch at a specific moment in time (Polygon block timestamp + OpenTimestamps Bitcoin block timestamp).
- That the prediction record cannot be retroactively edited without breaking the proof.
- That the prediction was locked *before* the result of the underlying match was known.

A VStamp does **not** verify:

- **That the prediction was correct.** The user's Prediction IQ separately captures correctness over time, but a single VStamp by itself says nothing about whether the prediction won.
- **That any opinion, recommendation, or piece of content the user posts alongside the stamp is endorsed by Tournamental.** A high-IQ user who shares a sponsored post recommending a sportsbook does not inherit Tournamental's authority. The VStamp on their profile attests to their *track record of locked predictions*, it does not attest to anything they say or recommend in marketing copy.
- **That the user is acting in any official capacity** for Tournamental, Tournamental Holdings, or Tournamental Foundation.

This distinction matters for the Verified Pundit programme described later in this doc. A "verified" badge means *the prediction record is auditable*, not *Tournamental vouches for this person's opinions*. Marketing copy must always reflect this distinction. The standard disclosure in any Verified Pundit context:

> Verified Pundit status is awarded based on a public, auditable prediction history. It is not an endorsement by Tournamental or Tournamental Holdings of any opinion, recommendation, or third-party offer the holder may share.

The distinction also matters for any sponsored-pundit endorsement of a sportsbook or prediction market: the endorsement is the pundit's, not Tournamental's, and the geo-routed affiliate router still applies the standard third-party-link disclosure on top.

### Verification flow (technical)

```
   Prediction lock arrives at game-service
            │
            ▼
   Compute prediction hash; write to Redis with VStamp pending
            │
            ▼  (every minute)
   Snapshotter pulls all pending hashes  →  builds Merkle tree
            │
            ▼
   Writes per-prediction Merkle proofs back to Redis
            │
            ▼
   Submits Merkle root to OpenTimestamps queue   ──┐
            │                                       │
            ▼                                       │  (~10–60 min)
   Calls VStampRegistry.anchor(batchId, root)       │
            │                                       │
            ▼  (~10s on Polygon)                    │
   On-chain tx confirms; tx_hash returned           │
            │                                       │
            ▼                                       │
   Updates Redis: VStamp = anchored, Polygon ✓     │
            │                                       │
            ▼                                       │
   User receives notification: "VStamp confirmed"   │
            │                                       │
            └──────────────────────────────────────►│
            ◄────────────────────── OTS proof returns ────
            │
            ▼
   Updates Redis: Bitcoin ✓, strongest-tier verification
   Public proof page now shows both confirmations
```

### Verification flow (user-facing)

The user sees three states on a prediction card, in order:

```
🔘  Pending verification    (0–60 seconds, between lock and Polygon tx)
✅  VStamp confirmed         (Polygon-anchored)
⛓️ Bitcoin-verified         (OTS proof complete, ~10–60 min later)
```

Most users will only ever notice the green tick. The Bitcoin-verified badge is for the long-term reputation story and surfaces on profile pages.

### What this is *not*, and what it is

- **Not a blockchain wallet for users.** Users never see a private key, never sign a transaction, never pay gas. The chain is an internal implementation detail; the product surface is "verified".
- **Not a token, NFT, or financial instrument.** A VStamp is a verification receipt. It has no transfer, no marketplace, no value beyond the reputation it contributes to its owner's profile.
- **Not on Ethereum mainnet.** Mainnet is too expensive at our cadence. We use L2s + Bitcoin via OTS.
- **Not "blockchain for blockchain's sake".** It's the cheapest credible immutability mechanism available, and the marketing benefit is real.

## Prediction IQ

The reputation score that makes Tournamental a long-term identity asset.

### Definition

A user's Prediction IQ is a single integer (centred near 1000, like an Elo rating) that captures their *demonstrated skill* across all locked predictions. Designed to be:

- **Comparable** across sports and tournaments.
- **Stable** in the short run (one lucky weekend doesn't blow it up).
- **Sensitive** in the long run (sustained skill moves it).
- **Comprehensible** at a glance ("Prediction IQ 842, top 5%").
- **Verifiable** because it's derived only from VStamped predictions.

### Calculation

Treat every prediction as a single round of an Elo-like update against the *market*. The market is the implicit opponent.

For each resolved prediction:

```
expected_outcome   = market_implied_probability_at_lock
actual_outcome     = 1 if prediction was correct else 0
delta              = actual_outcome - expected_outcome

iq_change          = K × delta × stage_weight × time_weight
```

Where:

- `K` = 32 by default (standard Elo K-factor; tuneable per cohort).
- `stage_weight` ∈ [1.0, 3.0] mirrors the stage multiplier from [doc 16](16-game-modes-and-scoring.md).
- `time_weight` ∈ [0.1, 1.5] mirrors the time multiplier.

Apply on every settled prediction. Cap per-day movement at ±50 points so a single chaotic Saturday can't dominate the score.

Initial Prediction IQ for a new user: **1000**. The dataset moves the population around it; we publish the percentile breakdown publicly so "Prediction IQ 1240" has stable meaning across users.

### Distribution and scale

Modeled on chess Elo distributions, broad expectations:

```
~50%   500–1100        Casual players, small predicted volumes.
~25%   1100–1300       Engaged players with consistent stretches.
~15%   1300–1500       Skilled players who beat the market often.
~7%    1500–1700       Demonstrably reading the tournament well.
~2%    1700–1900       Elite, sustained market-beating across multiple tournaments.
~1%    1900+           Legendary; rare; usually domain experts.
```

All thresholds are recomputed nightly so percentiles stay accurate as the population grows.

### Domain-specific Prediction IQ

A user's profile shows the headline Prediction IQ *plus* per-sport sub-scores:

```
Tim Thomas
Overall Prediction IQ:  1342    (Top 6%)
  Soccer:               1418    (Top 3%)
  Cricket:              1287    (Top 12%)
  Tennis:               1102    (Top 38%)
  Esports:             ,       (no sample)
```

This rewards specialists. A user who is a deep reader of cricket but unfamiliar with esports should see their cricket IQ stand out, not be diluted.

For tournaments specifically, also track tournament-stage IQ (group-stage IQ vs knockout-stage IQ). Some users are great early; others come alive in the final.

### Profile page

The user's public profile (at `tournamental.com/u/<handle>`) is structured around their reputation:

```
┌──────────────────────────────────────────────────────────────────┐
│  Tim "The Oracle" Thomas                                  🇳🇿     │
│                                                                  │
│  Prediction IQ:  1342                          Top 6% globally   │
│  Current streak: 7  →  Hot Hand                                  │
│                                                                  │
│  Sport Breakdown      Soccer 1418 · Cricket 1287 · Tennis 1102   │
│                                                                  │
│  Best Calls                                                      │
│    Japan @ 12% vs Germany, 91 points (verified VStamp)          │
│    Croatia @ 23% v Brazil, 84 points                            │
│    Argentina @ 18% v favourites, 79 points                      │
│                                                                  │
│  Verified history                                                │
│    Total predictions:        1,847                               │
│    Underdog wins (<30%):     23                                  │
│    Beat-the-market score:    14 of last 20 matches               │
│    Perfect runs:             2 (longest 18)                      │
│    Tournaments played:       7                                   │
│                                                                  │
│  Personality leaderboards                                        │
│    🏆 The Oracle, #14 globally                                  │
│    🦈 The Shark , #47 globally                                  │
│    🎯 The Contrarian, #3 in NZ                                  │
│                                                                  │
│  Badges (24)                                                     │
│    [Before the Crowd] [Bracket Genius] [Ice Veins] [+21 more]    │
└──────────────────────────────────────────────────────────────────┘
```

Public by default for active users; users can opt their handle out of the global leaderboard but VStamps remain verifiable on direct URL.

### Anti-gaming considerations

Without protections, sophisticated users could pump their IQ by predicting only obvious favourites or only on slow days. Mitigations:

- **Minimum sample**, IQ percentiles only display once a user has ≥30 resolved predictions.
- **Concentration penalty**, IQ percentile is per-sport-weighted, so a user who only predicted one team's matches doesn't get an inflated overall IQ.
- **Variance check**, large inactivity gaps reduce displayed-IQ confidence; the score doesn't actually decay, but the percentile UI shows a lower-confidence interval.
- **Streak protection caps**, Streak Protection (from [doc 16](16-game-modes-and-scoring.md)) cannot artificially extend perfect-run states for IQ purposes; protected predictions count as wins for streak tier but as draws for IQ delta.
- **Sybil resistance**, multi-account abuse is mitigated by the auth layer ([doc 13](13-telegram-bot-and-auth.md)) and a passive heuristic that flags suspiciously correlated prediction patterns across accounts.

### The reputation network, long-term

The Prediction IQ + verified prediction history together form a portable reputation primitive. Over time:

- **Tournamental handles become the X / Twitter of sports prediction.** A user's `@handle` is their public reputation in any sports-prediction conversation.
- **Cross-platform plug**, third parties can verify a VStamp themselves (the proof page works without Tournamental) so a user could embed their Tournamental IQ on a Substack or use it as proof on a sports podcast.
- **Cross-domain expansion**, the same architecture works for elections, awards, entertainment outcomes. A user who builds a sports IQ on Tournamental can later predict on a politics tournament and get a separate domain-IQ that compounds.

The *long-term product* is the network of verified predictors. Every other surface, the renderer, the bot, the clip pipeline, the affiliate links, the sweepstakes pools, exists to feed predictions into the reputation graph.

## Data shapes

### Per-prediction VStamp record (Redis + on-disk archive)

```json
{
  "vstamp_id": "V-2026-W47-A92F-81C",
  "prediction_id": "p_01HX...",
  "user_id": "u_01HX...",
  "match_id": "wc26-arg-fra-final",
  "tournament_id": "fifa-wc-2026",
  "hash": "f3a7c2d1e9...",
  "merkle_root": "9b21d4...",
  "merkle_proof": ["a1b2...", "c3d4...", "..."],
  "batch_id": 4827,
  "polygon_tx_hash": "0xabc123...",
  "polygon_block_number": 53291045,
  "ots_proof_uri": "https://cdn.tournamental.com/ots/V-2026-W47-A92F-81C.ots",
  "ots_status": "bitcoin_confirmed",
  "ots_bitcoin_block_height": 877245,
  "locked_at_ms": 1734729600123,
  "anchored_at_ms": 1734729680456
}
```

### User Prediction IQ record

```json
{
  "user_id": "u_01HX...",
  "iq_overall": 1342,
  "iq_overall_percentile": 0.94,
  "iq_by_sport": {
    "soccer": { "iq": 1418, "n": 412, "percentile": 0.97 },
    "cricket": { "iq": 1287, "n": 88,  "percentile": 0.88 },
    "tennis":  { "iq": 1102, "n": 32,  "percentile": 0.62 }
  },
  "iq_by_tournament_stage": {
    "group":    { "iq": 1290, "n": 220 },
    "knockout": { "iq": 1402, "n": 88 }
  },
  "headline_calls": [
    { "vstamp_id": "V-2022-W51-C92A-3F1", "summary": "Japan @ 12% vs Germany", "points": 91 }
  ],
  "updated_at_ms": 1734729600000
}
```

Snapshotter writes these to `/v1/static/profiles/<user_id>/iq.json` per the flat-file CDN pattern in [doc 12](12-odds-and-predictions.md).

## Acceptance criteria

- [ ] Every locked prediction is hashed and assigned a VStamp ID within 100ms.
- [ ] Within 60 seconds of lock, the prediction's Merkle root is anchored on Polygon.
- [ ] Within 60 minutes, the OpenTimestamps proof completes for the same root and the prediction shows the Bitcoin-verified badge.
- [ ] The public proof page at `tournamental.com/v/<vstamp_id>` shows the canonical fields, hash, Merkle proof, both anchor links, and a working in-browser verifier.
- [ ] The in-browser verifier successfully verifies a real prediction without contacting any Tournamental server (CDN-only proof page + a public Polygon RPC).
- [ ] Prediction IQ algorithm is deterministic given the same input history.
- [ ] IQ percentile displays only after ≥30 resolved predictions.
- [ ] Per-sport IQ is independently maintained and displayed.
- [ ] No prediction is included in a leaderboard or IQ calculation without a confirmed VStamp.

## Sources

- [OpenTimestamps protocol](https://opentimestamps.org/)
- [OpenTimestamps client (TypeScript)](https://github.com/opentimestamps/javascript-opentimestamps)
- [Polygon mainnet, gas + transaction costs](https://polygon.technology/)
- [Base, Coinbase L2](https://base.org/)
- [Merkle Tree primer (Wikipedia)](https://en.wikipedia.org/wiki/Merkle_tree)
