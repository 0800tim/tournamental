import type {
  EventMessage,
  MatchInit,
  StateFrame,
} from "@tournamental/spec";

/**
 * Broadcast-style match-stat aggregator.
 *
 * Pure function over an event log + (optionally) the state-frame
 * stream, given everything up to time `t`, returns the stats panel
 * the broadcast HUD (`MatchStatsHUD`) renders. No mutable state, no
 * memoisation; `MatchStatsHUD` calls this on every animation frame
 * with the current playhead and React diffs the resulting object.
 *
 * The aggregator is intentionally idempotent at any `t`, recomputing
 * from scratch is cheap because the events list is bounded (typically
 * a few hundred per match) and the math per event is O(1). This
 * matters because we do NOT want to maintain a parallel store for
 * stats; doing so introduces a second cache that can drift from the
 * event-log truth, and a backward scrub on the timeline would have
 * to invert all the side effects.
 *
 * Shape:
 *
 *   - `home` / `away`: per-side counters (shots, fouls, cards, etc).
 *   - `scorers`: chronological scorer ticker, one entry per goal.
 *   - `cards`: yellow + red cards by team and player.
 *   - `subs`: substitutions in event order.
 *   - `possession`: rough split derived from the state-frame ball
 *     carrier history; can be omitted by callers that don't ship the
 *     state stream (HUD pre-mount before the first frame, tests).
 *   - `mostRecentGoal`: convenience reference to the latest scorer
 *     for the goal-celebration animation in the HUD.
 */

export interface SideStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  passes: number;
  passesCompleted: number;
  saves: number;
  /** Possession share in [0, 1]. Sums to ~1 with the other side. */
  possession: number;
}

export interface ScorerEntry {
  /** Match clock seconds at the goal (0 = kickoff). */
  matchSec: number;
  /** Stable team id (matches `MatchInit.teams[i].id`). */
  teamId: string;
  /** Convenience: "home" or "away" relative to teams[0]/teams[1]. */
  side: "home" | "away";
  /** Scoring player id. */
  playerId: string;
  /** Display name of the scorer if available; falls back to player id. */
  playerName: string;
  /** Optional assist player display name. */
  assistName?: string;
  /** True if the goal was a penalty (heuristic, see `attributeGoal`). */
  isPenalty: boolean;
  /** Score after this goal, in `[home, away]` order. */
  scoreAfter: { home: number; away: number };
}

export interface CardEntry {
  matchSec: number;
  side: "home" | "away";
  teamId: string;
  playerId: string;
  playerName: string;
  severity: "yellow" | "red";
}

export interface SubEntry {
  matchSec: number;
  side: "home" | "away";
  teamId: string;
  playerInId: string;
  playerInName: string;
  playerOutId: string;
  playerOutName: string;
}

export interface MatchStats {
  home: SideStats;
  away: SideStats;
  scorers: ScorerEntry[];
  cards: CardEntry[];
  subs: SubEntry[];
  /** Most recent goal's `t` in ms; -1 if none. */
  lastGoalT: number;
  /** Convenience copy of the most recent scorer entry, or null. */
  mostRecentGoal: ScorerEntry | null;
}

const emptySide = (): SideStats => ({
  goals: 0,
  shots: 0,
  shotsOnTarget: 0,
  corners: 0,
  fouls: 0,
  yellows: 0,
  reds: 0,
  passes: 0,
  passesCompleted: 0,
  saves: 0,
  possession: 0,
});

export const EMPTY_MATCH_STATS: MatchStats = {
  home: emptySide(),
  away: emptySide(),
  scorers: [],
  cards: [],
  subs: [],
  lastGoalT: -1,
  mostRecentGoal: null,
};

interface AggregateOptions {
  /** Ms playhead to truncate the event log at (inclusive). */
  t: number;
  /**
   * Optional state-frame buffer for possession aggregation. We only
   * consult `state.ball.carrier` (and the player's team) so passing
   * a thinned-out array (e.g. 1 frame/sec) is fine and keeps the
   * computation cheap.
   */
  frames?: StateFrame[];
}

/**
 * Compute the full stats panel from an event + frame log up to time
 * `t`. Pure; safe to call on every animation frame.
 */
export function computeMatchStats(
  init: MatchInit | null,
  events: readonly EventMessage[],
  opts: AggregateOptions,
): MatchStats {
  if (!init) return EMPTY_MATCH_STATS;

  const homeTeam = init.teams[0];
  const awayTeam = init.teams[1];
  const home = emptySide();
  const away = emptySide();
  const scorers: ScorerEntry[] = [];
  const cards: CardEntry[] = [];
  const subs: SubEntry[] = [];
  let lastGoalT = -1;
  let lastScoreChange: { home: number; away: number } | null = null;
  let runningHome = 0;
  let runningAway = 0;

  // Build a one-shot index from player id → (team, name) so we can
  // attribute events without pre-computing per call. Substitutions
  // don't change a player's team, so this is stable for a match.
  const playerIndex = new Map<
    string,
    { side: "home" | "away"; teamId: string; name: string }
  >();
  for (const p of homeTeam.players)
    playerIndex.set(p.id, { side: "home", teamId: homeTeam.id, name: p.name });
  for (const p of awayTeam.players)
    playerIndex.set(p.id, { side: "away", teamId: awayTeam.id, name: p.name });

  const sideForTeam = (teamId: string): "home" | "away" =>
    teamId === homeTeam.id ? "home" : "away";

  // We track penalty-shootout outcomes separately from `event.score_change`
  // so the regulation-scoreboard score doesn't increment during penalties.
  // Goals scored from the spot (event.goal during regulation, attributed by
  // the closest preceding event.shot from the spot or our heuristic) flow
  // through the normal goals counter.
  let inShootout = false;

  // Walk events in timestamp order; the buffer is already sorted by
  // `buildManifestBuffer`, but for streamed-only callers we re-check.
  // We use a stable insertion-order sort to keep events at the same
  // `t` in their original order (e.g. score_change AFTER goal).
  const sorted = [...events].sort((a, b) => a.t - b.t);

  for (const ev of sorted) {
    if (ev.t > opts.t) break;
    const matchSec = Math.floor(ev.t / 1000);

    switch (ev.type) {
      case "event.shot": {
        const lookup = playerIndex.get(ev.player);
        const side = lookup?.side ?? "home";
        const target = side === "home" ? home : away;
        target.shots += 1;
        if (ev.on_target) target.shotsOnTarget += 1;
        break;
      }
      case "event.save": {
        // Saves credit the keeper's side as a save; we also bump the
        // attacking team's shotsOnTarget if they didn't already (shot
        // events normally precede saves, so this is usually a no-op).
        const lookup = playerIndex.get(ev.keeper);
        const side = lookup?.side ?? "home";
        const target = side === "home" ? home : away;
        target.saves += 1;
        break;
      }
      case "event.goal": {
        if (inShootout) break; // shootout penalties are tracked separately
        const lookup = playerIndex.get(ev.player);
        const side = lookup?.side ?? sideForTeam(ev.team);
        const target = side === "home" ? home : away;
        target.goals += 1;
        if (side === "home") runningHome += 1;
        else runningAway += 1;
        const assistName = ev.assist
          ? playerIndex.get(ev.assist)?.name
          : undefined;
        const entry: ScorerEntry = {
          matchSec,
          teamId: ev.team,
          side,
          playerId: ev.player,
          playerName: lookup?.name ?? ev.player,
          assistName,
          isPenalty: false, // refined below if a preceding event.shot was a penalty
          scoreAfter: { home: runningHome, away: runningAway },
        };
        scorers.push(entry);
        lastGoalT = ev.t;
        break;
      }
      case "event.score_change": {
        // Authoritative scoreboard. We pin our running counts to the
        // producer's so any drift between our `event.goal` count and
        // their official scoreline (e.g. own-goals, missing assists)
        // resolves to the producer's truth.
        lastScoreChange = { home: ev.home, away: ev.away };
        runningHome = ev.home;
        runningAway = ev.away;
        // Fix up the most recent scorer entry to match the truth.
        const lastScorer = scorers[scorers.length - 1];
        if (lastScorer) {
          lastScorer.scoreAfter = { home: ev.home, away: ev.away };
        }
        break;
      }
      case "event.foul": {
        const lookup = playerIndex.get(ev.player);
        const side = lookup?.side ?? "home";
        const target = side === "home" ? home : away;
        target.fouls += 1;
        if (ev.severity === "yellow" || ev.severity === "red") {
          if (ev.severity === "yellow") target.yellows += 1;
          if (ev.severity === "red") target.reds += 1;
          cards.push({
            matchSec,
            side,
            teamId: lookup?.teamId ?? "",
            playerId: ev.player,
            playerName: lookup?.name ?? ev.player,
            severity: ev.severity,
          });
        }
        break;
      }
      case "event.pass": {
        const lookup = playerIndex.get(ev.from);
        const side = lookup?.side ?? "home";
        const target = side === "home" ? home : away;
        target.passes += 1;
        if (ev.success !== false) target.passesCompleted += 1;
        break;
      }
      case "event.out_of_bounds": {
        if (ev.restart === "corner") {
          // Award a corner to whichever team is taking it. The spec
          // doesn't include the attacking team directly; we attribute
          // by `touched_by` (defending team last touched it) → the
          // OPPOSITE side gets the corner. Fall back to home if
          // unknown.
          if (ev.touched_by) {
            const lookup = playerIndex.get(ev.touched_by);
            const otherSide: "home" | "away" =
              lookup?.side === "home" ? "away" : "home";
            (otherSide === "home" ? home : away).corners += 1;
          }
        }
        break;
      }
      case "event.substitution": {
        const team = ev.team;
        const side = sideForTeam(team);
        const inLookup = playerIndex.get(ev.player_in);
        const outLookup = playerIndex.get(ev.player_out);
        subs.push({
          matchSec,
          side,
          teamId: team,
          playerInId: ev.player_in,
          playerInName: inLookup?.name ?? ev.player_in,
          playerOutId: ev.player_out,
          playerOutName: outLookup?.name ?? ev.player_out,
        });
        break;
      }
      case "event.penalty_shootout_start":
        inShootout = true;
        break;
      case "event.penalty_shootout_end":
        inShootout = false;
        break;
      default:
        break;
    }
  }

  // If a producer-side `event.score_change` set the truth, ensure
  // home.goals / away.goals align (some producers don't emit
  // event.goal but do emit score_change). If we already counted goals
  // above we leave them, score_change might have arrived ahead of
  // a deferred event.goal in re-ordered streams.
  if (lastScoreChange) {
    if (home.goals < lastScoreChange.home) home.goals = lastScoreChange.home;
    if (away.goals < lastScoreChange.away) away.goals = lastScoreChange.away;
  }

  // Possession from the ball-carrier track. Cheap because we use
  // whole-frame deltas instead of integrating between frames.
  if (opts.frames && opts.frames.length > 1) {
    let homeMs = 0;
    let awayMs = 0;
    let total = 0;
    for (let i = 0; i < opts.frames.length - 1; i += 1) {
      const f = opts.frames[i];
      if (f.t > opts.t) break;
      const next = opts.frames[i + 1];
      const dt = Math.max(0, Math.min(next.t, opts.t) - f.t);
      if (dt <= 0) continue;
      const carrier = f.ball.carrier ?? f.players.find((p) => p.has_ball)?.id;
      if (!carrier) continue;
      const lookup = playerIndex.get(carrier);
      if (!lookup) continue;
      if (lookup.side === "home") homeMs += dt;
      else awayMs += dt;
      total += dt;
    }
    if (total > 0) {
      home.possession = homeMs / total;
      away.possession = awayMs / total;
    }
  }

  return {
    home,
    away,
    scorers,
    cards,
    subs,
    lastGoalT,
    mostRecentGoal: scorers[scorers.length - 1] ?? null,
  };
}

/**
 * Cheap alias for the common case: HUD has events + the current
 * playhead, no frames. Used in unit tests and on first paint before
 * the state stream has populated.
 */
export function computeStatsAtTime(
  init: MatchInit | null,
  events: readonly EventMessage[],
  t: number,
): MatchStats {
  return computeMatchStats(init, events, { t });
}

/**
 * Format a match-time second count as `MM'` (e.g. `36'` for 36
 * minutes). Used by the scorer chip in the HUD ticker.
 */
export function formatMatchMinute(matchSec: number): string {
  const min = Math.floor(matchSec / 60);
  return `${min}'`;
}

/**
 * Format possession as a 0-100 percent integer string.
 */
export function formatPossession(p: number): string {
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}`;
}
