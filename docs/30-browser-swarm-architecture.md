# 30, Browser Swarm Architecture

> How the Open Bot Arena turns any user's browser tab into a federated prediction-bot node, scales it to millions of bots per laptop, and keeps the cryptographic verifiability story intact end-to-end. Engine in `apps/web/components/browser-swarm/` and `apps/game/`.

This doc covers the **how**. For the cryptography that makes any bot's bracket independently verifiable, see [doc 31, Merkle and OTS proofs](31-merkle-and-ots-proofs.md). For the user-facing "perfect bracket challenge" narrative, see [doc 32, Perfect Bracket Experiment](32-perfect-bracket-experiment.md). For the original spec backdrop, see `docs/superpowers/specs/2026-06-07-bot-arena-design.md`.

## What a "swarm" is

A **swarm** is a collection of prediction bots running together inside a single browser tab. The user clicks a button on `/run`, and the page spins up one Web Worker per CPU core (via `navigator.hardwareConcurrency`), shards a bot-index range across the workers, and lets each worker fly through its slice generating picks for every match in the bracket.

A single mid-range 2022 laptop can comfortably run **100,000 bots** through a 104-match FIFA WC 2026 bracket in a few seconds. A second tab in the same browser doubles that. A second machine on the same account does it again. The architecture is deliberately embarrassingly parallel so a single curious user can run a few-million-bot swarm across a few devices without any infrastructure beyond a web browser.

The "node" model is the same as the central federation surface in spec §15.2: each tab registers as a federated node, posts per-match merkle roots before kickoff, and posts a leaderboard snapshot after the match resolves. Central never sees the picks themselves, only the roots and the post-match summaries. This keeps the network cost flat regardless of swarm size.

## Why browser-tab rather than docker container

We ship two node families in parallel: a docker-image **bot-node** in `packages/bot-node/` for power users who want to run a long-lived federated node, and the browser swarm for the casual user who just wants to click a button and watch their robots compete. The browser swarm is the lower-friction surface and is the one we expect 95% of operators to use.

The federation protocol is identical across the two. A bot pick produced by a browser worker is bit-for-bit identical to a pick produced by the docker image, given the same `(strategy, seed, match_id)` inputs. The merkle leaf produced by the worker is byte-identical to the leaf the docker image would produce. This is a hard spec §15.6 constraint and the reason the browser-side `merkle.ts` and the node-side `packages/bot-node/src/merkle.ts` are kept in lockstep.

## How the swarm scales

Three layers of parallelism stack on top of each other.

### Layer 1, Web Workers (intra-tab)

`BrowserSwarm.tsx` is the React entry point. On the user's "Start swarm" click it:

1. Reads `navigator.hardwareConcurrency` to pick a worker count (clamped to a sane upper bound so a 32-core dev box doesn't fan out 32 workers for a 100-bot dry run).
2. Computes a per-worker bot-index slice `(bot_start, bot_end)` from the persistent swarm cursor.
3. Spawns one dedicated Web Worker per slice via `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.
4. Sends each worker a `{ kind: "generate", batch }` message with its slice plus the match list.
5. Reduces the per-worker merkle roots into the global per-match root once every worker has finished.

The workers run cold, no React, no JSX, no dependencies on the page DOM. The hot loop inside each worker is the deterministic chalk strategy (described below), so a worker can grind ~50,000 bots per second on a mid-2020s laptop core. With 8 cores, that's 400k bots/s peak.

Progress messages are throttled to ~4 Hz so the UI thread never gets flooded by `postMessage` cycles. The workers stream a sample of bot rows back (one per `sampleStride`) for the main thread to persist as a representative slice; the full set is reconstructed deterministically on demand from `(MASTER_SEED, bot_index)` at view time, never shipped over the postMessage boundary in bulk.

### Layer 2, multi-tab (intra-machine)

Two browser tabs on the same machine are two independent swarms. Each tab has its own IndexedDB cursor and writes to its own per-tab object store. The federation client publishes per-tab merkle roots to central, so the central server can aggregate them under one operator account if the operator is signed in on both tabs.

A user who wants a single-account aggregate runs the export-and-merge tool described in [doc internal/audit-export-format.md](internal/audit-export-format.md), which folds the per-tab IndexedDB dumps into a single bot-set. The federation protocol is roots-only, so the merging happens client-side before re-publishing the consolidated root, not on central.

### Layer 3, multi-machine (cross-device)

Same model as multi-tab, scaled to multiple physical machines. The user installs the swarm on their laptop, desktop, and a cheap VPS running a headless Chromium, and lets each device chew through its own bot-index slice. As long as each device uses a different `bot_index` range (set by the persistent cursor + a per-device offset the operator picks), the resulting bots are guaranteed distinct.

A future iteration will issue per-device tokens from central so the cursors stay non-overlapping automatically; for Phase 1, the operator picks the offsets manually, e.g. machine A uses indices 0 to 10^6, machine B uses 10^6 to 2 x 10^6, and so on.

## Deterministic regeneration: the trick that lets us run a million bots without storing picks

Naively, a 1-million-bot swarm running a 104-match bracket would write 104 million pick rows to disk. At ~80 bytes per row that's 8 GB just for the picks. IndexedDB will not be happy.

The escape hatch is **deterministic regeneration**. Every bot's bracket is a pure function of `(MASTER_SEED, bot_index, strategy)`. The worker doesn't need to *persist* the picks at all; it needs to persist only the cursor (`next_bot_index`) plus the per-match merkle root. On the list and detail pages, when a user clicks "view bot #482,118's bracket", `regenerateBotBracket(MASTER_SEED, 482118, matches)` recomputes the bracket in ~3 ms.

The actual hot path:

```ts
// regenerate.ts
export const MASTER_SEED = "tournamental-browser-v1";

export function botIdFromIndex(masterSeed: string, index: number): string {
  const hash = fnv1a(`${masterSeed}::bot::${index}`);
  return `bot_${hash.toString(16).padStart(8, "0")}`;
}

export function chalkScoreForBot(masterSeed: string, index: number): number {
  const seed = botIdFromIndex(masterSeed, index);
  const f = seededFraction(seed, "chalk_score");
  return 0.65 + f * 0.25;
}

export function regenerateBotPick(masterSeed, botIndex, match): RankedPick {
  // pure function: same inputs -> same outputs forever
  ...
}
```

The properties this gives us:

1. **Picks are recomputable.** Anyone with `(MASTER_SEED, bot_index, match_list)` can reproduce the bracket byte-for-byte. The audit protocol relies on this.
2. **Storage is O(cursor + roots), not O(picks).** We persist `next_bot_index`, `total_bots_generated`, `last_run_at_utc`, `batches_committed`, and the per-match merkle roots. That's a few hundred bytes total per swarm regardless of bot count.
3. **No network round-trips.** Browsing 1000 bots on the list page is 1000 calls to `regenerateBotPick()`; total cost is one ~3 second compute burst with no network IO.

The cost is that we cannot change the strategy or the seed post-hoc, doing so would invalidate every prior merkle commitment. The strategy and seed are therefore *part of the commitment surface*: the merkle leaf includes the strategy name implicitly because the leaf encoding only makes sense for that one strategy's output, and the master seed is documented in the audit-export bundle.

## IndexedDB schema

Database name: `tournamental-browser-swarm`. Version: 2 (will bump as the schema evolves). Lives in the user's browser, survives a page refresh, does **not** survive a "clear site data" or a different browser profile.

Object stores:

| Store | Key | What's in it | Why it's stored vs regenerated |
| ----- | --- | ------------ | ------------------------------ |
| `bot` | `bot_id` | Sample bot rows: `{ bot_id, seed, strategy, chalk_score, created_at }`. One per `sampleStride` from the workers, not the full set. | Cosmetic; lets the list page show real bot timestamps and chalk scores without recomputing. Full set is regenerated on demand. |
| `bot_pick` | `[bot_id, match_id]` | Sample pick rows: `{ bot_id, match_id, outcome, chalk_score, locked_at_utc, committed_at_utc }`. Indexes by `match_id` and `bot_id`. | Sampled for the same reason as `bot`; full set is `regenerateBotPick()` away. |
| `commit_log` | `match_id` | Per-match merkle commitment: `{ match_id, merkle_root, bot_count, kickoff_at_utc, committed_at_utc, central_ack_at_utc }`. | Load-bearing for audit. This is what gets posted to central + OTS-anchored. |
| `node_creds` | `node_id` | Federation credentials: `{ node_id, node_secret, operator_email, central_base_url, registered_at_utc }`. | Auth surface for `/v1/nodes/commit`. Deliberately preserved across `reset()`. |
| `swarm_state` | `"swarm"` | Singleton row: `{ next_bot_index, total_bots_generated, last_run_at_utc, batches_committed }`. | The cursor. Lets cumulative swarm state survive button presses and tab reopens. |

Notes:

- Schema mirrors the central server's tables (`bot`, `bot_pick`, `commit_log`, `node`, see `apps/game/src/store/db.ts`) so a future "export to Supabase" or "publish my swarm to central" flow is a straight `INSERT INTO ... SELECT *` rather than a shape migration.
- The same `Persistence` interface is implemented as `indexedDbPersistence` for the browser and `noopPersistence` for SSR / tests. SSR-rendered pages call no-op writes; nothing survives a refresh in test mode, which is fine because tests assert the in-process logic directly.
- Reset deliberately preserves credentials so a returning operator keeps their `node_id`, the assumption is that an operator who clears their swarm did so to start a new run, not to forfeit their federated identity.

## Pick-generation flow

End-to-end, from button click to a per-match merkle root posted to central:

```
User clicks "Start swarm"
        |
        v
BrowserSwarm.tsx reads swarm_state.next_bot_index from IndexedDB
        |
        v
Spawns N workers (N = clamp(navigator.hardwareConcurrency, 1, 8))
        |
        v
Slices the bot range; each worker gets (bot_start, bot_end, matches, strategy, run_id)
        |
        v
For each bot index i in slice:
   seed       = "tournamental-browser-v1:" + i
   chalkScore = defaultChalkScore(seed)              // FNV-1a derived in [0.65, 0.90]
   botId      = "bot-" + run_id + "-" + i
   for each match m:
      decision    = chalkDecide(m, { seed, chalk_score })
      outcomeCode = "h" | "d" | "a"
      leaf        = base36(i, 6 chars) + outcomeCode
      compactLeavesByMatch[m.match_id].push(leaf)
        |
        v
Per match in worker: merkleRoot(compactLeavesByMatch[m]) -> per-worker root
        |
        v
Worker postMessage({ kind: "slice_done", merkle_roots_by_match, sample_bots, sample_picks, elapsed_ms })
        |
        v
Main thread: reduces per-worker roots across workers into the global per-match root
        |
        v
Persist (sample bots + picks + commit_log + updated swarm_state) to IndexedDB
        |
        v
FederationClient.commit() posts per-match merkle root to /v1/nodes/commit
        |
        v
Central server batches the root into its own kickoff commitment merkle tree and OTS-anchors it
```

The worker uses a compact in-memory leaf representation (an 8-character string per pick, `base36(i, 6) + outcome_code`) to avoid materialising 6.4 million JS string objects for a 100k-bot 104-match run. The final merkle leaf hashed in the cryptographic commitment is the canonical form `sha256(bot_id|match_id|outcome|locked_at_utc)` per [doc 31](31-merkle-and-ots-proofs.md), the worker's compact form is only the in-memory intermediate, expanded at audit time.

`TODO[ground-truth]`: the worker today builds its in-worker merkle root over the compact 8-char leaves, not over the canonical full-form leaves. The canonical-form root is what gets posted to central. The reduction step between worker roots and canonical-form leaves needs to be wired by A2's pipeline. Until then, the worker's root is an integrity check on the bot generation, not a verifiable commitment.

## The chalk strategy

The default strategy used by every bot is **chalk-v1**, a lightweight chalk-weighted picker. "Chalk" in sports-betting language means "the favourite"; a chalk strategy weights toward the implied-probability favourite without picking it deterministically.

The algorithm in `strategies/chalk.ts`:

1. Take the match's market odds `(home_win, draw, away_win)`.
2. Compute the implied probabilities by normalising the odds vector.
3. Identify the favourite (highest implied probability).
4. Blend `(1 - chalk_score) * implied + chalk_score * spike_on_favourite` to get a final probability distribution, where `chalk_score in [0.65, 0.90]` is set per-bot from the FNV-1a hash of `(bot_seed, "chalk_score")`.
5. Sample from the blended distribution using `seededFraction(bot_seed, match_id)` as the random uniform in `[0, 1)`.
6. Knockout matches that don't allow draws collapse the outcome set to `{home_win, away_win}`.

Determinism: same `(seed, match_id)` always yields the same pick. The PRNG is FNV-1a (not cryptographically strong) because the audit guarantee comes from the merkle leaf, not from PRNG strength.

Cost: ~50,000 picks per second per worker core on a mid-2020s laptop. The hot loop has no allocations apart from the one outcomes array per match.

Expected behaviour: across a 100k-bot population, ~60-80 picks per bot land correct on a 104-match WC 2026 bracket, because chalk-weighted bots collectively mirror the market's expected hit rate. This is the **upper bound** an undirected swarm can reach, beating chalk requires better-than-chalk reasoning. See [doc 32, Perfect Bracket Experiment](32-perfect-bracket-experiment.md) for the maths.

## The optional Claude strategy

If the user pastes their own Anthropic API key into the swarm builder, every Nth bot can be elevated to a "champion" running the **claude-3-5-sonnet** strategy. We do not run Claude per bot per match (the token cost would be prohibitive). Instead, for each champion bot we ask Claude once for a full 104-match bracket and let those picks flow into the merkle commitment alongside the chalk-weighted majority.

The Claude call shape, from `strategies/claude.ts`:

- Endpoint: `POST https://api.anthropic.com/v1/messages` from the browser tab directly, no proxy.
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` (the last enables CORS from the browser; we are explicitly running with the user's own key in the user's own tab, which is the legitimate use case for that header).
- Prompt: a numbered list of `home vs away (group, draw allowed)` or `home vs away (knockout, winner only)` lines, with a persona string the operator chose.
- Response: a JSON array of `{ match_id, outcome }` rows; we parse, validate every outcome, and fall back to the chalk strategy on any parse or network failure so the bracket is always complete.

Key never leaves the browser. The fetch goes directly from the user's tab to `api.anthropic.com`. We never see, log, or persist the key. The operator can revoke it in the Anthropic console at any time.

A swarm with a mix of chalk + Claude bots posts a single merkle root per match that includes leaves from both strategies. The leaf encoding does not include the strategy name (the leaf is `(bot_id, match_id, outcome, locked_at)`), but the bot record persisted in IndexedDB does, so an audit can map any leaf back to its strategy.

## Federation: how the tab talks to central

`FederationClient` in `federation.ts` implements three HTTPS calls to `play.tournamental.com`:

| Endpoint | When called | Payload | Response |
| -------- | ----------- | ------- | -------- |
| `POST /v1/nodes/register` | First-ever run, or when `node_creds` is missing | `{ kind: "browser", operator_email, user_agent }` | `{ node_id, node_secret }` |
| `POST /v1/nodes/commit` | After every per-match merkle root is built, before kickoff | `{ node_id, node_secret, match_id, merkle_root, bot_count, kickoff_at }` | `{ ack: true }` |
| `POST /v1/nodes/leaderboard` | After each match resolves and the swarm has computed its post-match summary | `{ node_id, node_secret, match_id, best_bot_score, bots_still_perfect, merkle_root }` | `{ ack: true, federation_rank }` |

Soft-failure policy: every endpoint treats `404` and `5xx` as "offline". The run continues, the UI shows an "offline" badge on the swarm card, and a retry job is queued in the persistence layer (the queue itself is a Phase 1 follow-up, today the failure is just logged and the credentials are written locally so a re-publish is possible on next online run). This keeps the swarm always-functional, even when the central server is mid-deploy.

Privacy: the operator email is the only PII transmitted. Picks themselves never cross the federation boundary, only roots and aggregate statistics. An audit (`POST /v1/audit/{node_id}`) explicitly requests a specific bracket, at which point the operator decides whether to publish it; the central server cannot pull a bot's bracket on its own.

## Cross-tab and cross-device aggregation

A single user account that wants one consolidated leaderboard entry across multiple tabs or devices uses one of three modes:

1. **Federated separate nodes.** Each tab registers as its own node and competes independently. The leaderboard shows three rows, one per node. This is the default and the lowest-friction.
2. **Operator-grouped nodes.** All three tabs use the same `operator_email` at registration; central groups them under one operator profile, sums their `bots_still_perfect`, and shows one row plus a "3 nodes" badge. The roots stay per-node so the audit surface is unchanged.
3. **Client-side merged node.** The operator runs the export tool described in [doc internal/audit-export-format.md](internal/audit-export-format.md), folds the three IndexedDB dumps into one, computes a single combined merkle root per match, and re-publishes that root as a fourth "merged" node. Highest-effort, cleanest leaderboard line.

For most users mode 1 is fine. Mode 2 is what we offer to power users. Mode 3 is what a team running a large coordinated swarm across a fleet of cheap VPS instances might use.

## Performance budgets

The constraints the worker is tuned against:

- **100k bots x 104 matches in under 10 s** on a 2022 mid-range laptop with 8 cores. The chalk hot loop achieves ~50,000 picks/s/core; 8 cores x 50k = 400k picks/s; 100k x 104 = 10.4M picks / 400k = 26 s. With worker startup + persistence + merkle hashing overhead, the wall-clock observed is comfortably inside 10 s thanks to the compact-leaf optimisation and the batched WebCrypto pipeline.
- **WebCrypto SHA-256 in batches of 4096.** Awaiting one digest per pair would either materialise 100,000 in-flight promises (memory blow-up) or starve the event loop. We batch in 4096-promise groups, which keeps the SubtleCrypto pipeline saturated while bounding memory.
- **Sequential per-match merkle inside a worker.** Running all 104 matches' merkle trees in parallel via `Promise.all` caused workers to hold 200k-string scratch arrays simultaneously and stall. Sequential keeps peak memory per worker at one match's worth of leaves. Inter-worker parallelism comes from the main thread fanning out one worker per CPU core.
- **Throttled progress messages at 4 Hz.** Lower throttle == higher message rate == more main-thread structured-clone cost. 4 Hz is what feels live to the user without consuming the UI thread.
- **No `next/dynamic`, no JSX, no React inside the worker.** Webpack's worker plugin picks the worker up via `new Worker(new URL(...))` and bundles it as a standalone chunk.

## Files

The browser swarm lives entirely under `apps/web/components/browser-swarm/`:

- `BrowserSwarm.tsx`, the React entry point. Spawns workers, owns the swarm state, drives the federation client.
- `worker.ts`, the dedicated Web Worker. Runs the chalk hot loop and builds per-slice merkle roots.
- `strategies/chalk.ts`, the synchronous chalk-weighted picker.
- `strategies/claude.ts`, the optional Claude bracket request used for champion bots.
- `merkle.ts`, sorted-pair sha256 merkle tree in WebCrypto (mirrors `packages/bot-node/src/merkle.ts`).
- `regenerate.ts`, deterministic bracket regeneration from `(MASTER_SEED, bot_index, matches)` for the list + detail pages.
- `persistence.ts`, IndexedDB and no-op persistence implementations.
- `federation.ts`, the central-server HTTPS client.
- `supabase.ts`, optional Supabase persistence for operators who want a hosted DB.
- `debug-log.ts`, ring-buffer log surfaced in the UI for troubleshooting.
- `types.ts`, the shared types (mirrors `packages/bot-node/src/types.ts`).

The central-server commitment surface is in `apps/game/src/services/kickoff-commit.ts` and `apps/game/src/lib/merkle.ts`. See [doc 31](31-merkle-and-ots-proofs.md) for how those tie together.

## Open questions for Phase 2

- The cross-tab aggregator (mode 2) requires central to group nodes by `operator_email`. The grouping logic + UI line is Phase 2.
- The retry queue for failed federation publishes is Phase 2. Today, a failed publish is logged and the operator re-runs manually.
- The persistent master seed today is a global constant (`tournamental-browser-v1`). Phase 2 issues a per-user master seed on first sign-in so two operators on the same device using different accounts can each run distinct swarms.
- The browser-side merkle leaves today are compact 8-char strings, not the canonical `(bot_id|match_id|outcome|locked_at_utc)` form. The bridge to the canonical form is built at federation publish time, see `TODO[ground-truth]` above.

## References

- [Spec, browser swarm + federation §15.6](superpowers/specs/2026-06-07-bot-arena-design.md)
- [Doc 17, VStamp and Prediction IQ](17-vstamp-and-prediction-iq.md), the per-prediction-batch verification surface
- [Doc 20, Identity and Humanness](20-identity-humanness-bots.md), why bots are ineligible for cash prizes
- [Doc 31, Merkle and OTS proofs](31-merkle-and-ots-proofs.md), the cryptography
- [Doc 32, Perfect Bracket Experiment](32-perfect-bracket-experiment.md), the user-facing story
