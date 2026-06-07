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
import type { BotPick, BotRecord, MatchSpec, Outcome, StrategyName } from "./types";

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
}

interface ProgressMessage {
  readonly kind: "progress";
  readonly worker_index: number;
  readonly bots_generated: number;
  readonly picks_made: number;
  readonly current_match_id: string | null;
}

interface SliceDoneMessage {
  readonly kind: "slice_done";
  readonly worker_index: number;
  readonly run_id: string;
  /** Local merkle root per match for this worker's slice. The main
   *  thread combines worker-roots into the global per-match root. */
  readonly merkle_roots_by_match: Record<string, string>;
  /** Best score across this slice (max correct so far is unknown until
   *  match results land, so this returns the chalk_score of the bot
   *  with the highest cumulative implied probability). */
  readonly best_bot_score: number;
  readonly bots_generated: number;
  readonly picks_made: number;
  readonly elapsed_ms: number;
  /** A small sample of bots + picks the main thread can persist as a
   *  representative slice. We never ship the full 1M bot set across
   *  the postMessage boundary because the structured-clone cost would
   *  defeat the parallelism. The main thread reconstructs full rows
   *  from the deterministic seeds at persistence time. */
  readonly sample_bots: BotRecord[];
  readonly sample_picks: BotPick[];
}

interface ErrorMessage {
  readonly kind: "error";
  readonly worker_index: number;
  readonly message: string;
}

type OutboundMessage = ProgressMessage | SliceDoneMessage | ErrorMessage;

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

    const sampleBots: BotRecord[] = [];
    const samplePicks: BotPick[] = [];
    const sampleStride = Math.max(1, Math.floor(totalBots / 64));

    let bestScore = -Infinity;
    let picksMade = 0;
    let lastProgress = t0;

    for (let i = bot_start; i < bot_end; i++) {
      const seed = `${run_id}:${i}`;
      const chalkScore = defaultChalkScore(seed);
      const botId = `bot-${run_id}-${i}`;

      let perBotProbScore = 0;

      // Pre-compute the bot's 6-char compact prefix in base36 once.
      const compactIdx = i.toString(36).padStart(6, "0");
      for (let mi = 0; mi < matches.length; mi++) {
        const match = matches[mi]!;
        const decision = chalkDecide(match, { seed, chalk_score: chalkScore });
        const outcomeCode =
          decision.outcome === "home_win"
            ? "h"
            : decision.outcome === "draw"
              ? "d"
              : "a";
        compactLeavesByMatch
          .get(match.match_id)!
          .push(compactIdx + outcomeCode);
        picksMade++;

        // Tally an "expected score" so the UI has something to surface
        // pre-match: use the implied probability of the chosen outcome.
        if (match.odds) {
          perBotProbScore += match.odds[decision.outcome] ?? 0;
        }

        if (((i - bot_start) % sampleStride) === 0) {
          samplePicks.push({
            bot_id: botId,
            match_id: match.match_id,
            outcome: decision.outcome as Outcome,
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
      let mDone = 0;
      for (const m of matches) {
        const leaves = compactLeavesByMatch.get(m.match_id) ?? [];
        rootsByMatch[m.match_id] = await merkleRoot(leaves);
        // Free this match's leaves immediately so peak memory stays
        // at one match's worth.
        compactLeavesByMatch.delete(m.match_id);
        mDone++;
        // Emit a progress beat between matches so the UI can show the
        // merkle phase actually moving. We reuse the `progress` shape
        // and set `current_match_id` to the match just finished.
        post({
          kind: "progress",
          worker_index,
          bots_generated: totalBots,
          picks_made: picksMade,
          current_match_id: `${m.match_id} (merkle ${mDone}/${matches.length})`,
        });
      }
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

function post(message: OutboundMessage): void {
  self.postMessage(message);
}

export {};
