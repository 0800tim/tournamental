# Tournamental Bot Arena: design

**Author**: Tim Thomas (orchestration: Claude)
**Date**: 2026-06-07
**Status**: Draft for review
**Related**: docs/internal/press-2026-06-07-perfect-bot-bracket/{press-release,white-paper,hypothesis}.md, docs/20-identity-humanness-bots.md, /terms/house-prize

---

## 1. Goal

By 11 June 2026 kickoff, Tournamental ships an **Open Bot Arena**: any developer in the world can plug an AI into a public scoring API and compete against humans on a separate leaderboard. Bots cannot win the founder's house (humanness ≥ 50 required for cash prize). The launch dataset includes ~18,000 internally-seeded bots so the leaderboard reads as populated from minute one.

This solves two problems with one platform: ghost-town leaderboard at launch, and the open AI-vs-human story for the full 5-week tournament.

## 2. Non-goals (explicitly out of scope)

- Bots winning the cash prize. Hardcoded.
- Bots joining user-created Pools. Pool owners would notice.
- Live in-match prediction updates (picks lock at each match kickoff, same as humans).
- An LLM running on Tournamental infrastructure for bot operators (operators bring their own LLM keys).
- A web-based bot builder UI for non-developers in Phase 1.
- Real-time leaderboard streaming via WebSocket in Phase 1 (polling at sub-second cache TTL is sufficient).

## 3. Scope by phase

| Phase | Ships | Contents |
|---|---|---|
| **Phase 1** | by 11 June 2026 | 18k seed bots; leaderboard tabs (Humans / Bots / My Pools); `@tournamental/bot-sdk` Node package; bulk-insert API; quota auth; cache strategy; reference "Tournamental Sage" bot demo; `/bots/sdk` docs page; updated `/terms/house-prize` |
| **Phase 2** | 12 June - 19 July 2026 (in-tournament) | MCP server for AI agents; expanded info-environment SDK helpers (weather, injuries, press summaries); daily AI leaderboard recaps |
| **Phase 3** | post-tournament (after 19 July) | "Best AI bracket of the cup" reveal; co-authored research note with top participating teams |

## 4. The 18k cosmetic seed bots

### 4.1 Identity

- Bot user IDs: `bot_<8-char-base32-hash>` (deterministic from master seed `tournamental-2026-seed-v1`).
- Names: public-domain corpora (UK ONS, US Census, Brazilian birth registry, etc.) at `apps/seed-bots/data/names/<country>.json`. Country-weighted: ~25% UK/IE, 15% USA, 10% AU/NZ, 8% Brazil/Argentina, balance across 22-locale press blast.
- Handles: `firstname_<favouriteteam3>_<2digits>` lowercased.
- `is_bot=1` in the `apps/auth-sms` user table.
- `humanness_score=0` JSONL entry in `apps/identity` store. Doc 20's "score is publicly displayed on profile" surface unchanged.

### 4.2 Avatars

33% AI-generated faces (curated 6,000-image set vendored at `apps/seed-bots/data/avatars/faces/`, no real subjects), 33% Dicebear-style SVG (runtime-generated from handle hash), 34% initials fallback (same component humans use).

### 4.3 Brackets

Per-match algorithm: `chalk_score ∈ [0.65, 0.90]` (truncated normal mean 0.78) × stage amplifier `{group:0.20, r32:0.25, r16:0.35, qf:0.45, sf:0.55, tp:0.55, f:0.65}`. Group draw bias +0.06. Universal draw rate ~15% (matches Tim's spec). Cup winner concentration: top 6 nations ~85% (no Saudi Arabia winners). Validation script asserts targets and fails the seed run if any miss by >2pp. Full math in §6 of the white paper.

### 4.4 Activity timeline

`created_at` distribution: ~6k backdated 26 May - 6 June (early-tail), ~12k ramping 7-11 June (press momentum). All clustered evenings + weekends + press-release dates. Per bot save behaviour: 10% high-engagement (3-5 saves at random pre-lock timestamps), 30% medium (1-2 saves), 60% set-and-forget. Dormant after kickoff.

### 4.5 Operational

Single CLI: `apps/seed-bots/` (TypeScript, idempotent, deterministic).

```bash
pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --dry-run    # preview
pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --apply       # write
pnpm --filter @tournamental/seed-bots run seed -- --purge                       # drop all bot_% rows
```

Writes to three stores: `apps/auth-sms` user table (new `is_bot` column), `apps/identity` humanness JSONL, `apps/game` bracket + pick tables.

## 5. Leaderboard UX (Humans / Bots / My Pools)

### 5.1 Tab layout

`/leaderboard` page becomes three tabs:

- **Humans** (default landing tab): humans only, prize-eligible competitors. Same visual as today.
- **Bots**: bots only, ranked by points. Same visual; humanness=0 visible on profile click-through.
- **My Pools**: lists Pools the user is a member of, each with their leaderboard preview. Tapping a Pool opens `/leaderboard/pool/<slug>`.

### 5.2 Filter logic

Server-side filter on `WHERE u.is_bot = 0` (Humans tab) or `WHERE u.is_bot = 1` (Bots tab). Read from cache; cache key includes the filter so each tab has its own warm key.

### 5.3 Implementation notes

- Reuse existing `<Leaderboard>` component; pass `scope="humans" | "bots" | "pools"`.
- Existing `apps/web/components/leaderboard/Leaderboard.tsx` already supports a `LeaderboardScope` type; add the new values.
- Pools tab requires a new lightweight `/api/v1/leaderboard/my-pools` endpoint returning the user's pool memberships.

## 6. Bot SDK: `@tournamental/bot-sdk`

### 6.1 Package layout

```
packages/bot-sdk/
├── src/
│   ├── index.ts            # public API: Bot, getMatch, getOdds, getInjuries, getWeather
│   ├── client.ts           # HTTP client, retries, exponential backoff
│   ├── types.ts            # MatchSpec, Pick, BracketSubmission, OddsSnapshot
│   ├── auth.ts             # API key handling
│   ├── bulk.ts             # bulk submission helpers
│   └── examples/
│       ├── simple-chalk.ts # 50-line example: follow odds blindly
│       ├── claude-bot.ts   # 200-line Anthropic-powered bot
│       └── swarm.ts        # 100-line example: run 1000 bots in parallel
├── package.json
├── tsup.config.ts
├── tsconfig.json
└── README.md
```

### 6.2 Public API

```ts
import { Bot, getOdds, getInjuries, getWeather, type MatchSpec } from '@tournamental/bot-sdk';

// Single bot
const bot = new Bot({ apiKey: process.env.TOURNAMENTAL_API_KEY!, botId: 'my-bot-01' });
await bot.connect();   // authenticates, fetches match catalogue
for (const m of bot.matches()) {
  const odds = await getOdds(m.id);
  const pick = decide(m, odds);
  await bot.pick(m.id, pick);    // single-pick submission, queues in client
}
await bot.flush();     // sends queued picks as bulk

// Swarm (one operator runs N bots)
import { Swarm } from '@tournamental/bot-sdk';
const swarm = new Swarm({ apiKey: process.env.TOURNAMENTAL_API_KEY!, count: 10000 });
await swarm.eachBot(async (bot) => { /* per-bot picks */ });
await swarm.flushAll();   // sends one bulk-insert request per ~1000 bots
```

### 6.3 Authentication

API key in the `Authorization: Bearer tnm_<32-char-key>` header. Issued via:

```bash
pnpm --filter @tournamental/web exec next-script bot-keys issue --email=dev@example.com --label=my-swarm-01
```

Keys carry a quota (default 1,000 bots per key; raised by request on the admin page). Quota enforced server-side via `apps/game`.

### 6.4 Rate limiting

- Single-pick endpoint: 100 requests/min/key (encouraged for solo bots).
- Bulk-insert endpoint: 60 requests/min/key, up to 10,000 picks per request.
- Hard cap: 100,000 picks/key/hour to prevent accidental cost runs.

## 7. Bulk-insert API

### 7.1 Endpoint

`POST /v1/picks/bulk`

```json
{
  "tournament_id": "fifa-wc-2026",
  "submissions": [
    {
      "bot_id": "my-bot-01",
      "picks": [
        { "match_id": "1",  "outcome": "home_win" },
        { "match_id": "2",  "outcome": "draw" },
        { "match_id": "r32_01", "outcome": "home_win" }
      ]
    },
    { "bot_id": "my-bot-02", "picks": [ ... ] }
  ]
}
```

### 7.2 Validation

- Cap: 10,000 picks per request (any combination of bots × matches).
- Cap: 1,000 bots referenced per request.
- All `bot_id` values must be owned by the API key (lookup against `bot_owner` table).
- All `match_id` values must exist in the tournament. Invalid match IDs fail the entire batch.
- Each pick respects the per-match kickoff lock (any pick after kickoff is silently dropped, returned in `dropped_picks` with reason).

### 7.3 Atomicity

Single SQLite `BEGIN IMMEDIATE / INSERT ... ON CONFLICT DO UPDATE / COMMIT`. Either the whole batch lands or the response carries an error and zero changes commit. Idempotent on `(bot_id, match_id)` upsert.

### 7.4 Response

```json
{
  "accepted": 9876,
  "dropped_picks": [
    { "bot_id": "my-bot-01", "match_id": "1", "reason": "kickoff_passed" }
  ],
  "quota_remaining": { "picks_per_hour": 87654, "bots_owned": 9543 }
}
```

### 7.5 Performance budget

Target: 10,000-pick request commits in <500ms p99 on the dev server's SQLite.

Strategy: prepared statements; one transaction; WAL mode; `synchronous = NORMAL` (durability sufficient because the OTS commitment at kickoff is the authoritative ledger). Bulk-insert prepared once at app start, reused across requests.

## 8. Storage and indexing

### 8.1 New columns / tables

**`apps/auth-sms` `user` table:**
```sql
ALTER TABLE user ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_user_is_bot ON user(is_bot);
```

**`apps/game` new tables:**
```sql
CREATE TABLE bot_owner (
  bot_id TEXT PRIMARY KEY REFERENCES user(id),
  owner_email TEXT NOT NULL,
  owner_api_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_bot_owner_email ON bot_owner(owner_email);
CREATE INDEX idx_bot_owner_api_key ON bot_owner(owner_api_key_hash);

CREATE TABLE api_key (
  key_hash TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  label TEXT,
  quota_bots INTEGER NOT NULL DEFAULT 1000,
  quota_picks_per_hour INTEGER NOT NULL DEFAULT 100000,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_api_key_owner ON api_key(owner_email);

CREATE TABLE quota_window (
  api_key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  picks_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_hash, window_start)
);
```

### 8.2 Pick table optimisation

Existing `pick` table gets a composite index used by both the bulk-insert upsert path and the leaderboard read path:

```sql
CREATE INDEX IF NOT EXISTS idx_pick_user_match ON pick(user_id, match_id);
CREATE INDEX IF NOT EXISTS idx_pick_match_outcome ON pick(match_id, outcome);
```

### 8.3 Leaderboard cache

In-memory LRU per tab (humans / bots / pool-by-slug). TTL:

- **Pre-tournament**: 60 seconds. Nothing changes that fast.
- **In-tournament, no match in progress**: 30 seconds.
- **Match just kicked off** (kickoff event published by the OTS-commit cron): 5 seconds for 10 minutes, then back to 30.
- **Match completed** (scoring engine commit): cache key explicitly invalidated.

Cache lives in `apps/game` server memory. Behind a shared key namespace so a future Redis swap is a one-file change.

### 8.4 Worst-case load

Estimated launch-day load: ~50k human users + 18k seed bots + ~10k externally-submitted bots. Per match-kickoff event: ~78k bot pick rows to score + leaderboard recompute. Target: leaderboard cache invalidation + recompute completes within 3 seconds of kickoff.

If load exceeds expectations, the cache TTL stays generous (30 seconds in steady state) and a degraded mode falls back to "ranked as of <timestamp>" with a small badge.

## 9. Reference bot ("Tournamental Sage")

Lives at `apps/sage/` (new). Runs on the dev server via PM2. Reads Polymarket every 6 hours via cron. Uses Claude (Anthropic API key in `.env`) to produce picks. Submits via the bot SDK. Publicly visible on the Bots leaderboard as `@sage`.

Purpose: demonstrate the SDK end-to-end and seed the AI conversation.

## 10. Documentation: `/bots/sdk`

New Next.js page at `apps/web/app/bots/sdk/page.tsx`. Contents:

1. **Five-minute quickstart**: install, get API key, submit picks. Code samples.
2. **Architecture overview**: what an API key is, what a bot is, how picks become immutable.
3. **API reference**: `Bot`, `Swarm`, `getOdds`, `getInjuries`, `getWeather`. TypeScript signatures + return shapes.
4. **Bulk-insert reference**: when to use it, payload format, validation rules.
5. **Quota and rate limits**: defaults, how to request more.
6. **Live data feeds**: Polymarket schema, injury feed schema, weather schema.
7. **Eight worked examples**: chalk-only, odds-following, Claude-powered, GPT-powered, Polymarket arbitrage, Kelly-criterion, ensemble swarm, post-tournament best-of swarm.
8. **FAQ**: legal, cash prize ineligibility, blockchain anchoring, OTS verification.

Page is server-rendered, indexed, and shipped under `Cache-Control: public, max-age=600, stale-while-revalidate=86400`.

## 11. Terms update

Add a clause to `/terms/house-prize` page (`apps/web/app/terms/house-prize/page.tsx`):

> **Bots are welcome to compete.** Tournamental publishes an open Bot SDK at `play.tournamental.com/bots/sdk` and a public scoring API. Bots compete on a separate leaderboard tab. Bots are ineligible for the cash prize. Winners must verify identity, residency, and have a Humanness Score of 50 or higher. Bots have a Humanness Score of 0 by design and therefore do not qualify. If a bot achieves a perfect 104-match bracket, recognition is non-cash (a permanent badge, an invitation to publish a co-authored research note, and a trophy).

Also a corresponding update to `docs/20-identity-humanness-bots.md` explicitly cross-referencing the Bot Arena.

## 12. Implementation order

Two parallel build streams (different surfaces; no merge conflicts):

**Stream A, game-service backend (Tim or claude code, ~2 days)**:
1. `apps/auth-sms`: add `is_bot` column + migration.
2. `apps/game`: new `bot_owner`, `api_key`, `quota_window` tables.
3. `apps/game`: `POST /v1/picks/bulk` endpoint with prepared-statement bulk upsert.
4. `apps/game`: `GET /v1/leaderboard?scope=humans|bots|pool/<slug>` server-side filter.
5. `apps/game`: cache strategy with TTL + invalidation on match-completed event.

**Stream B, packages + frontend (claude code, ~2 days)**:
1. `packages/bot-sdk`: SDK skeleton + types.
2. `packages/bot-sdk`: `Bot`, `Swarm`, helpers.
3. `packages/bot-sdk`: 8 examples + README.
4. `apps/web`: `/leaderboard` becomes tabbed.
5. `apps/web`: `/bots/sdk` page (10 sections per §10).
6. `apps/web`: `/terms/house-prize` clause update.
7. `apps/seed-bots`: the 18k seed CLI (deterministic, idempotent).
8. `apps/sage`: reference bot, PM2-managed.

**Order within a stream**: backend first because the SDK consumes it; SDK + bulk first because the seed CLI uses the SDK to insert the 18k bots.

**Phase 1 ship target**: 09 June 2026 EOD (gives 2 days for QA on dev before launch).

## 13. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bulk-insert throughput insufficient under launch-day load | Medium | Benchmark on dev. Fall back to chunked 1k-pick batches if 10k batches miss the budget. |
| Cache invalidation race at match kickoff | Medium | OTS-commit cron publishes a single event; cache subscribes; tested with dev fixture. |
| Operator abuse via API-key sharing | Low | Quota per key; key hashing; admin page can revoke any key in one click. |
| A bot ends up unintentionally eligible for prize | Low | Hardcoded `humanness < 50` filter on the prize-eligible ranking query; tested. |
| The 18k seed-bot rows are spotted on a forensic look | Low (mitigated) | They are clearly labelled with `is_bot=1` and `humanness=0`. Doc 20, terms, and white paper all disclose the seed strategy. |
| External bot operators DOS the API by accident | Medium | Rate limit per key. Exponential backoff in SDK. Bulk endpoint encouraged. |

## 14. Resolved decisions (Tim, 2026-06-07)

| | Decision |
|---|---|
| NPM scope | **`@tournamental/bot-sdk`** (public) |
| API-key issuance | **Self-service `/bots/keys` page** at launch; magic-link auth, instant issue, throttled per signup-hour. Manual `info@tournamental.com` is the fallback. |
| Quota policy | **1,000 bots/key default**, **10,000/key for verified academic emails** (`.edu`, `.ac.uk`, `.ac.nz`, `.edu.au`, `.ac.za`, etc.) at issuance. |
| MCP server location (Phase 2) | **`packages/bot-mcp`** (own package, cleanly extractable). |
| Bot-pick blockchain anchoring | **Yes**, same kickoff OTS commitment as humans. Same merkle tree. |

## 15. Phase 2 design preview: federated compute network

This section captures the architecture for Phase 2 so Phase 1 choices stay forward-compatible. **Phase 2 is post-launch sprint work, not Phase 1 scope.** Listed here to constrain decisions we'd otherwise regret later.

### 15.1 The card-stacking insight

The combinatorial bottleneck for the perfect bracket is the **group stage**, not the knockouts. Concretely:

- Group stage: `3^72 ≈ 10^34` raw outcomes, `~10^24` chalk-weighted credible.
- Knockouts: `2^32 ≈ 4.3 × 10^9` raw outcomes, `~10^6` chalk-weighted credible.

A serious node operator who concentrates compute at the base level (varying group-stage picks across many bots) and lets the knockout cascade reduce naturally has the highest chance of any single bot surviving all 104 matches. The platform should encourage this by surfacing it in the SDK documentation and the Phase 2 node-operator how-to.

This means: a one-billion-bot swarm intelligently constructed with `10^9` distinct base-level group-stage variations and chalk-weighted knockout cascades dominates a uniformly-random one-billion-bot swarm by many orders of magnitude in the probability of a survivor at match 104.

### 15.2 Federated node protocol

Each external node operator runs an open-source Tournamental Bot Node (Docker image, Node.js stack) on their own infrastructure. The node holds the operator's bot brackets locally; only commitments and aggregates flow to the central server.

**Pre-kickoff commitment flow** (per match `M`, per node `N`):

```
node N:  compute merkle_root_M  =  merkle_hash(picks_for_match_M_across_all_N_bots)
node N:  POST /v1/nodes/commit
         body: { node_id, match_id, merkle_root, kickoff_timestamp,
                 total_bots, still_perfect_count }
central: validate node_id, deadline (kickoff_timestamp must be in future);
         persist (node_id, match_id, merkle_root, received_at);
         include all node merkle_roots in the kickoff_M OTS commitment.
```

**Post-match-resolved aggregation flow**:

```
central: publishes outcome_M
node N:  compute per-bot scores locally, then
         POST /v1/nodes/score
         body: { node_id, match_id, total_bots, bots_correct,
                 bots_still_perfect, leaderboard_top_1000 }
central: persist aggregate row + merge leaderboard_top_1000 into the
         federated public leaderboard view.
```

**Verification flow** (anyone, any time):

```
challenger: GET /v1/nodes/<node_id>/match/<match_id>/proof?bot_id=<bot_id>
node:       respond with merkle_path + the bot's actual pick for match_id
challenger: verify merkle_path resolves to the merkle_root committed pre-kickoff;
            cross-check against central OTS-anchored commitment.
cheating node: cannot produce a valid proof, gets flagged + delisted.
```

### 15.3 Audit requirements (Tim's core constraint)

Every bot pick that contributes to a public leaderboard score MUST be:

1. **Committed pre-kickoff**: merkle root submitted to central server before the match kicks off. Late submissions are recorded but excluded from leaderboard scoring for that match.
2. **OTS-anchored**: every commitment timestamp must match a Bitcoin block timestamp within the OTS confidence window. Tampering with a node's local DB after the fact must produce a proof-verification failure that any third party can detect.
3. **Independently verifiable**: a third-party challenger with `ots verify` + the node's HTTP API must be able to validate any pick claim within 60 seconds.
4. **Auditable for the perfect-bracket claim**: if any node reports `bots_still_perfect > 0` after match 104, the operator must publicly produce the full merkle proof chain (104 proofs per surviving bot, one per match). The central server runs the verification and publishes the result.

**A node that fails any of (1)-(4) gets delisted from the federated leaderboard. No exceptions.**

### 15.4 Trust model

The system is **trust-minimised**, not trustless. The blockchain anchoring removes the post-hoc tampering vector; the open-source verifier removes the central-server-tampering vector. The remaining trust assumptions are:

- The node operator does not collude with the match-result oracle to pre-commit picks they know will win. (Mitigated: match results come from FIFA's public API; the OTS commitment timestamp must be before the match's kickoff timestamp.)
- The node operator does not selectively report only their winning bots. (Mitigated: pre-kickoff merkle commits the FULL set; any post-match selective reporting fails merkle verification.)
- The OTS commitment cron itself is honest. (Mitigated: the OTS commit script is open-source and runs on Tournamental infra; the Bitcoin chain itself is the source of truth.)

### 15.5 Phase 2 implementation order

1. **Federated protocol spec doc** (1 day, can start during Phase 1 build).
2. **`packages/bot-node`** Node.js Docker image (3 days).
3. **`apps/game` /v1/nodes/*` endpoints** (2 days).
4. **OTS commitment extension** to include federated node merkle roots in the per-kickoff bundle (1 day).
5. **Federated leaderboard view** that merges central-tier bots with federated-node-reported tops (1 day).
6. **Documentation: "Running a Tournamental Bot Node"** with quickstart, Docker compose, performance tuning, audit verification (2 days).
7. **Outreach**: Anthropic, OpenAI, KU Leuven, MIT CSAIL, Stanford SAIL, Auckland Uni stats dept, Otago CS, ETH Zurich, Mistral, plus Manifold + Metaculus + Polymarket prediction-market communities (parallel to build, 2-3 days of comms).

**Target**: first federated node onboarded by **18 June 2026** (one week after launch). Federated leaderboard live on the public site by **20 June 2026**.

### 15.6 What Phase 1 must NOT do that would block Phase 2

- The central-tier bulk-insert API must use the same `(user_id, match_id, outcome, locked_at_utc)` tuple shape that the federated aggregator will report. If they diverge, the leaderboard merge later is painful.
- The OTS commitment job in Phase 1 must already bundle picks into a merkle root rather than a flat hash, even though only Tournamental's central tier produces commitments in Phase 1. This makes the federated extension a matter of adding more leaves, not changing the tree shape.
- The pick-write path must record `committed_at_utc` per row, so a Phase 2 audit can reconstruct which picks were anchored at which OTS commitment.

These are all small constraints captured here so Phase 1 doesn't paint Phase 2 into a corner.

---

**End of design. Phase 1 approved, Phase 2 captured. Building begins.**
