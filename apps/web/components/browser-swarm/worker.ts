/**
 * Browser-swarm dedicated Web Worker.
 *
 * One instance per CPU core (the client spawns
 * `navigator.hardwareConcurrency` workers and shards the bot range
 * across them). Each worker:
 *
 *   1. Receives a `{ kind: "generate", batch }` message with the slice
 *      of `bot_index` it owns, the match list, and a chalk-score range.
 *   2. Generates BotRecord + BotPick rows for every bot in the slice
 *      using the synchronous chalk strategy.
 *   3. Streams progress messages back every ~250ms so the UI can show
 *      live throughput.
 *   4. After all bots in the slice have picks for a given match,
 *      computes the per-match merkle root for that slice and returns
 *      the local roots back to the main thread, which then combines
 *      across workers.
 *
 * The worker is self-contained: no `next/dynamic`, no JSX, no React.
 * Next.js's webpack loader picks it up via `new Worker(new URL(...))`
 * in `BrowserSwarm.tsx`.
 *
 * Performance discipline:
 *   - Synchronous chalk strategy in a tight loop (no awaits per pick).
 *   - Picks for a single bot held in a flat array of 8-byte numbers
 *     plus the outcome string; no per-pick object allocation in the
 *     hot path.
 *   - WebCrypto merkle hashing only at slice boundaries, not per pick.
 *   - Progress messages are throttled to ~4Hz.
 */

/// <reference lib="webworker" />

import { chalkDecide, defaultChalkScore, CHALK_STRATEGY_NAME } from "./strategies/chalk";
import { merkleRoot } from "./merkle";
import {
  buildDeviationTable,
  perturbedOutcome,
} from "./uniqueness";
import { anchorDrawForMatch, blendOutcome, type AnchorSnapshot } from "./anchor";
import type {
  BotPick,
  BotRecord,
  MatchSpec,
  Outcome,
  StrategyName,
  WorkerOutboundMessage,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

interface GenerateMessage {
  readonly kind: "generate";
  readonly worker_index: number;
  readonly bot_start: number;
  readonly bot_end: number;
  readonly run_id: string;
  readonly strategy: StrategyName;
  readonly matches: readonly MatchSpec[];
  /** Optional: when true the worker skips merkle hashing for a faster
   *  smoke-test path used by the UI's dry-run button. */
  readonly skip_merkle?: boolean;
  /** A11 Phase 2: optional anchor snapshot. When weight > 0 the
   *  worker blends each bot's perturbed outcome with the user's pick
   *  per `blendOutcome()`. When omitted (or weight === 0) the
   *  behaviour is identical to Phase 1: pure chalk + perturbation. */
  readonly anchor?: AnchorSnapshot;
}

/** Throttle for hashing progress posts: at most one message every
 *  `HASHING_THROTTLE_MS` per worker so we don't flood the main thread.
 *  ~120ms = ~8Hz, safely under the <10Hz limit Tim asked for. */
const HASHING_THROTTLE_MS = 120;

self.onmessage = (event: MessageEvent<GenerateMessage>) => {
  const msg = event.data;
  if (msg.kind === "generate") {
    void runGenerate(msg);
  }
};

async function runGenerate(msg: GenerateMessage): Promise<void> {
  const t0 = performance.now();
  const { matches, bot_start, bot_end, run_id, worker_index } = msg;
  const totalBots = bot_end - bot_start;

  try {
    // For each match: a flat string of compact leaves. Each leaf is
    // 8 chars: the 6-char bot index in base36 + a 2-char outcome code
    // (h/d/a + a delimiter). We keep them in a Uint8Array-ish flat
    // layout (one string per match, leaves concatenated, sliced at
    // merkle time) to avoid materialising 6.4M JS strings for the
    // 100k-bot run. Then we slice into proper leaves only at merkle
    // build time when the array layout is naturally GC-friendly.
    const compactLeavesByMatch = new Map<string, string[]>();
    for (const m of matches) compactLeavesByMatch.set(m.match_id, []);

    // A11 Phase 2: build the deviation table once at worker start. The
    // chalk strategy still drives the per-bot expected-score signal
    // (used for the leaderboard), but the actual committed outcome
    // comes from the index-based perturbation algorithm so two bots in
    // the swarm are GUARANTEED to commit structurally distinct
    // brackets. The chalk PRNG path is retained as a backup signal but
    // the perturbation overrides where they disagree.
    const deviationTable = buildDeviationTable(matches);

    const sampleBots: BotRecord[] = [];
    const samplePicks: BotPick[] = [];
    const sampleStride = Math.max(1, Math.floor(totalBots / 64));

    let bestScore = -Infinity;
    let picksMade = 0;
    let lastProgress = t0;

    for (let i = bot_start; i < bot_end; i++) {
      // Tim 2026-06-07: stable per-bot seed derived from the
      // MASTER_SEED constant in regenerate.ts. The /run/bots list +
      // detail pages can now regenerate any bot's bracket from its
      // index alone without storing picks. run_id stays in the bot_id
      // for batch traceability but does not affect the picks.
      const seed = `tournamental-browser-v1:${i}`;
      const chalkScore = defaultChalkScore(seed);
      const botId = `bot-${run_id}-${i}`;

      let perBotProbScore = 0;

      // Pre-compute the bot's 6-char compact prefix in base36 once.
      const compactIdx = i.toString(36).padStart(6, "0");
      for (let mi = 0; mi < matches.length; mi++) {
        const match = matches[mi]!;
        // A11 Phase 2: the committed outcome comes from the
        // deviation-table perturbation so two distinct bot indices in
        // the same operator scope are GUARANTEED structurally
        // distinct. The chalk strategy is still consulted for the
        // perBotProbScore signal so the leaderboard "expected score"
        // shape stays meaningful.
        const baseOutcome = perturbedOutcome(deviationTable, i, mi);
        // A11 Phase 2: anchor blend. When the user has the swarm
        // anchored to their own bracket (Soft / Strong / Lockstep)
        // each bot draws from `[user_pick, chalk_pick]` weighted by
        // anchor weight. The PRNG draw is seeded by (bot_index,
        // match_id) so a re-run with the same snapshot reproduces the
        // same picks.
        // anchorDrawForMatch keys group games on (bot_index, match_id)
        // and knockouts on (bot_index) alone - the SAME keys the
        // on-demand regenerate path (list + detail pages) uses, so the
        // committed bracket and the regenerated display agree bit-for-bit.
        const outcome =
          msg.anchor && msg.anchor.weight > 0
            ? blendOutcome(
                match.match_id,
                baseOutcome,
                msg.anchor,
                anchorDrawForMatch(i, match.match_id, match.allows_draw),
              )
            : baseOutcome;
        // Retained for the expected-score signal only.
        const chalkDecision = chalkDecide(match, { seed, chalk_score: chalkScore });
        const outcomeCode =
          outcome === "home_win"
            ? "h"
            : outcome === "draw"
              ? "d"
              : "a";
        compactLeavesByMatch
          .get(match.match_id)!
          .push(compactIdx + outcomeCode);
        picksMade++;

        // Tally an "expected score" so the UI has something to surface
        // pre-match: use the implied probability of the chosen outcome.
        if (match.odds) {
          perBotProbScore += match.odds[outcome] ?? 0;
        }
        // Reference chalkDecision so the compiler keeps the call (it
        // also seeds the PRNG, which is a side-effect we keep for
        // forward-compat with the chalk-blended display in the list
        // page). The variable is intentionally read but unused.
        void chalkDecision;

        if (((i - bot_start) % sampleStride) === 0) {
          samplePicks.push({
            bot_id: botId,
            match_id: match.match_id,
            outcome,
            chalk_score: chalkScore,
            locked_at_utc: Date.now(),
            committed_at_utc: null,
          });
        }
      }

      if (perBotProbScore > bestScore) bestScore = perBotProbScore;

      if (((i - bot_start) % sampleStride) === 0) {
        sampleBots.push({
          bot_id: botId,
          seed,
          strategy: CHALK_STRATEGY_NAME,
          chalk_score: chalkScore,
          created_at: Date.now(),
        });
      }

      // Throttled progress every ~250ms.
      const now = performance.now();
      if (now - lastProgress > 250) {
        post({
          kind: "progress",
          worker_index,
          bots_generated: i - bot_start + 1,
          picks_made: picksMade,
          current_match_id: matches[matches.length - 1]?.match_id ?? null,
        });
        lastProgress = now;
      }
    }

    const rootsByMatch: Record<string, string> = {};
    if (!msg.skip_merkle) {
      // Sequential per match inside this worker. Parallelism comes
      // from the main thread fanning out one worker per CPU core.
      // Running all 104 merkle builds at once via Promise.all caused
      // workers to stall on 100k+ leaves because every match held a
      // 200k-string scratch array simultaneously. Sequential keeps
      // peak memory per worker at one match's worth of leaves.
      const sliceTotal = matches.length;
      let mDone = 0;
      let lastHashPost = 0;
      for (let si = 0; si < matches.length; si++) {
        const m = matches[si]!;
        const leaves = compactLeavesByMatch.get(m.match_id) ?? [];

        // Tim 2026-06-07: stream hashing progress per-batch through the
        // merkleRoot callback so the UI no longer goes quiet during the
        // hashing phase. We throttle to ~8Hz per worker so a 1M-leaf
        // build doesn't drown the postMessage channel.
        rootsByMatch[m.match_id] = await merkleRoot(leaves, (hp) => {
          const now = performance.now();
          if (now - lastHashPost < HASHING_THROTTLE_MS) return;
          lastHashPost = now;
          post({
            kind: "hashing",
            worker_index,
            slice_index: si,
            slice_total: sliceTotal,
            level: hp.level,
            total_levels: hp.total_levels,
            leaves_remaining: hp.leaves_remaining,
            level_size: hp.level_size,
          });
        });

        // Free this match's leaves immediately so peak memory stays
        // at one match's worth.
        compactLeavesByMatch.delete(m.match_id);
        mDone++;
        // Emit a final "this match is done" hashing beat with
        // leaves_remaining=0 so the UI's per-slice counter always
        // ticks even if the throttle ate the last batch.
        post({
          kind: "hashing",
          worker_index,
          slice_index: si,
          slice_total: sliceTotal,
          level: 0,
          total_levels: 0,
          leaves_remaining: 0,
          level_size: 0,
        });
      }
      // Reference mDone so the compiler doesn't drop the loop var if we
      // ever stop using it; also helps debug logs in future.
      void mDone;
    }

    post({
      kind: "slice_done",
      worker_index,
      run_id,
      merkle_roots_by_match: rootsByMatch,
      best_bot_score: bestScore === -Infinity ? 0 : bestScore,
      bots_generated: totalBots,
      picks_made: picksMade,
      elapsed_ms: performance.now() - t0,
      sample_bots: sampleBots,
      sample_picks: samplePicks,
    });
  } catch (err) {
    post({
      kind: "error",
      worker_index,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function post(message: WorkerOutboundMessage): void {
  self.postMessage(message);
}

export {};
