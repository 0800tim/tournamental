/**
 * Score model — the early-lock long-shot formula from `docs/24` and `docs/16`.
 *
 * The unifying score:
 *
 *   points = round(
 *     base_points × time_multiplier × confidence_multiplier ×
 *     stage_multiplier × streak_multiplier × mode_multiplier
 *   )
 *
 *   base_points = 100 × (1 - market_implied_at_lock)
 *
 * Skill is measured by how much you knew that the market didn't, at the
 * moment you locked. The earlier you locked relative to kickoff, the
 * higher the time multiplier — early conviction beats late conviction.
 *
 * Bracket-mode-specific additions on top of `docs/16`:
 *
 *   - "Lock-and-don't-change" bonus: a per-pick lock that's never edited
 *     before the match starts gets a 1.10× multiplier baked into the
 *     mode_multiplier. Implemented here so the engine can compute it
 *     without round-tripping to the API.
 *   - Stage multiplier matches `docs/16` exactly:
 *     group=1.0, r16=1.25, qf=1.5, sf=2.0, f=3.0. (R32 is below R16; we
 *     interpolate it at 1.10 — documented in `STAGE_MULTIPLIERS`.)
 *
 * Pure / deterministic. No clock reads, no randomness. Every input is
 * explicit so the engine can replay the score for any past prediction.
 */

import type { CascadedBracket } from "./cascade.js";
import type {
  BracketPrediction,
  KnockoutFixture,
  MatchPrediction,
  StageId,
  TeamId,
  Tournament,
} from "./tournament.js";

// ---------- multipliers ----------

/**
 * Stage multipliers from `docs/16`. R32 is interpolated as 1.10 (below
 * R16's 1.25, above the group-stage 1.00). When the bracket-prophet doc
 * is updated, change here in lock-step.
 */
export const STAGE_MULTIPLIERS = {
  group: 1.0,
  r32: 1.1,
  r16: 1.25,
  qf: 1.5,
  sf: 2.0,
  // Third-place playoff: same difficulty as a SF (it's a real fixture
  // between two of the world's top 4) but the points payoff is lower
  // because there's no "I called the champion" marketing value.
  // Sits between QF (1.5) and SF (2.0).
  tp: 1.75,
  f: 3.0,
} as const;

/**
 * Time multiplier as a smooth function of `(seconds_to_kickoff_at_lock)`.
 * The discrete buckets in `docs/16` are the calibration; this function
 * interpolates between them so the UI can show "your potential points are
 * ticking down by N every minute".
 *
 * - >= 30 minutes before kickoff       → 1.50
 * - kickoff to 30 min before           → 1.25
 * - first third (0% to 33% of match)   → 1.10
 * - middle third                       → 1.00
 * - last third (66% to 90%)            → 0.50
 * - final 10% of match                 → 0.10
 *
 * For pre-tournament locks (days/weeks before kickoff), the multiplier
 * is capped at 1.50 to keep early-bird picks from running away with the
 * leaderboard, but the long-shot ("lock 6 weeks early on a 5% team")
 * payoff still comes from the inverse-implied-probability base.
 */
export function timeMultiplier(seconds_to_kickoff_at_lock: number, match_duration_s = 90 * 60): number {
  if (seconds_to_kickoff_at_lock >= 30 * 60) return 1.5;
  if (seconds_to_kickoff_at_lock >= 0) return 1.25;

  // negative: locked after kickoff
  const elapsed = -seconds_to_kickoff_at_lock;
  const frac = elapsed / match_duration_s;
  if (frac < 1 / 3) return 1.1;
  if (frac < 2 / 3) return 1.0;
  if (frac < 0.9) return 0.5;
  return 0.1;
}

export const CONFIDENCE_MULTIPLIERS = [1.0, 1.0, 1.1, 1.2, 1.3, 1.5] as const; // index 1..5

export function confidenceMultiplier(confidence: number): number {
  if (confidence < 1) return 1.0;
  if (confidence > 5) return CONFIDENCE_MULTIPLIERS[5];
  return CONFIDENCE_MULTIPLIERS[Math.round(confidence)] ?? 1.0;
}

/** Bracket-mode default. Overridden by the per-pick "locked early and didn't change" bonus. */
export const BRACKET_MODE_MULTIPLIER = 1.0;
export const LOCK_AND_HOLD_BONUS = 1.1;

// ---------- core scoring ----------

export interface ScoreInput {
  /** Market-implied probability of the predicted outcome at lock time. 0–1. */
  readonly market_implied_at_lock: number;
  /** Seconds to kickoff at the moment of lock. Negative = locked after kickoff. */
  readonly seconds_to_kickoff_at_lock: number;
  /** Tournament stage of the match. */
  readonly stage: keyof typeof STAGE_MULTIPLIERS;
  /** Optional confidence chips spent (1–5). */
  readonly confidence?: number;
  /** Optional running streak length at the moment of lock. */
  readonly streak?: number;
  /** True if user locked the pick early and never edited it before kickoff. */
  readonly locked_and_held?: boolean;
  /** Optional mode multiplier override. Default: 1.0 (Bracket mode). */
  readonly mode_multiplier?: number;
  /** Whether the prediction was correct. Used at settlement time. */
  readonly correct: boolean;
}

export interface ScoreBreakdown {
  readonly base_points: number;
  readonly time_multiplier: number;
  readonly confidence_multiplier: number;
  readonly stage_multiplier: number;
  readonly streak_multiplier: number;
  readonly mode_multiplier: number;
  readonly raw: number;
  readonly points_awarded: number;
}

export function streakMultiplier(streak: number): number {
  if (streak < 3) return 1.0;
  if (streak < 5) return 1.1;
  if (streak < 10) return 1.2;
  if (streak < 15) return 1.3;
  if (streak < 20) return 1.4;
  return 1.5;
}

/**
 * Compute the points for a single prediction. Returns the full
 * breakdown so the UI can show the user exactly *why* their points are
 * what they are (this is a major UX moment — the "you locked France at
 * 18% so you got 82 base points × 1.5 (early lock) × 3.0 (final) = 369
 * points" reveal).
 */
export function scorePick(input: ScoreInput): ScoreBreakdown {
  const base_points = 100 * (1 - input.market_implied_at_lock);
  const time_multiplier = timeMultiplier(input.seconds_to_kickoff_at_lock);
  const confidence_multiplier = confidenceMultiplier(input.confidence ?? 1);
  const stage_multiplier = STAGE_MULTIPLIERS[input.stage];
  const streak_multiplier = streakMultiplier(input.streak ?? 0);
  const mode_multiplier =
    (input.mode_multiplier ?? BRACKET_MODE_MULTIPLIER) *
    (input.locked_and_held ? LOCK_AND_HOLD_BONUS : 1.0);

  const raw = input.correct
    ? base_points *
      time_multiplier *
      confidence_multiplier *
      stage_multiplier *
      streak_multiplier *
      mode_multiplier
    : 0;

  return {
    base_points,
    time_multiplier,
    confidence_multiplier,
    stage_multiplier,
    streak_multiplier,
    mode_multiplier,
    raw,
    points_awarded: Math.round(raw),
  };
}

// ---------- bracket-level scoring ----------

export interface BracketScoreContext {
  readonly tournament: Tournament;
  readonly bracket: BracketPrediction;
  readonly cascaded: CascadedBracket;
  /**
   * Map of match_id → market-implied probability at the user's lock time
   * (or pre-tournament implied probability if the user didn't lock the
   * individual pick — the engine reads `pre_tournament_implied_win` on
   * the team).
   */
  readonly implied_at_lock_by_match: ReadonlyMap<string, number>;
  /**
   * Optional "now" for testing. If omitted the engine reads the lock
   * time from the per-pick lock or treats the prediction as locked at
   * tournament start.
   */
  readonly now_utc?: string;
}

export interface BracketScoreLine {
  readonly match_id: string;
  readonly stage: KnockoutFixture["stage"];
  readonly winner_predicted: string | null;
  readonly winner_actual: string | null;
  readonly correct: boolean;
  readonly breakdown: ScoreBreakdown;
}

export interface BracketScoreSummary {
  readonly tournament_id: string;
  readonly user_id: string;
  readonly total_points: number;
  readonly per_match: readonly BracketScoreLine[];
  /** Number of correct picks among predicted matches with a settled actual. */
  readonly correct_count: number;
  /** Number of settled matches counted. */
  readonly settled_count: number;
}

/**
 * Score the entire bracket for the user. Only matches with a settled
 * actual_winner contribute; unsettled matches return zeros and `correct:
 * false` so the caller can show "potential points if you're right". For
 * potential-points UI use `scorePick({ correct: true })` directly.
 */
export function scoreBracket(ctx: BracketScoreContext): BracketScoreSummary {
  const lines: BracketScoreLine[] = [];
  let total = 0;
  let correct = 0;
  let settled = 0;

  for (const k of ctx.cascaded.knockouts) {
    const lock = ctx.bracket.locks.find((l) => l.key === `knockout:${k.id}`);
    const fixture = ctx.tournament.knockouts.find((f) => f.id === k.id)!;

    const market_implied_at_lock =
      lock?.market_implied_at_lock ??
      ctx.implied_at_lock_by_match.get(k.id) ??
      // Fallback: derive implied from pre-tournament team strength if
      // available; else flat 50%.
      derivePreTournamentImplied(ctx.tournament, k);

    const seconds_to_kickoff_at_lock = secondsToKickoff(
      lock?.locked_at_utc ?? ctx.now_utc ?? ctx.tournament.start_utc,
      fixture.kickoff_utc,
    );

    const isSettled = !!k.actual_winner;
    const isCorrect = isSettled && k.predicted_winner === k.actual_winner;
    if (isSettled) settled++;
    if (isCorrect) correct++;

    const breakdown = scorePick({
      market_implied_at_lock,
      seconds_to_kickoff_at_lock,
      stage: k.stage,
      locked_and_held: !!lock,
      correct: isCorrect,
    });

    total += breakdown.points_awarded;
    lines.push({
      match_id: k.id,
      stage: k.stage,
      winner_predicted: k.predicted_winner,
      winner_actual: k.actual_winner,
      correct: isCorrect,
      breakdown,
    });
  }

  return {
    tournament_id: ctx.tournament.id,
    user_id: ctx.bracket.user_id,
    total_points: total,
    per_match: lines,
    correct_count: correct,
    settled_count: settled,
  };
}

// ---------- helpers ----------

function secondsToKickoff(lock_utc: string, kickoff_utc: string): number {
  const lock = Date.parse(lock_utc);
  const kickoff = Date.parse(kickoff_utc);
  if (Number.isNaN(lock) || Number.isNaN(kickoff)) return 0;
  return (kickoff - lock) / 1000;
}

function derivePreTournamentImplied(
  tournament: Tournament,
  knockout: { home: { team: string | null }; away: { team: string | null } },
): number {
  const homeTeam = tournament.teams.find((t) => t.id === knockout.home.team);
  const awayTeam = tournament.teams.find((t) => t.id === knockout.away.team);
  if (!homeTeam || !awayTeam) return 0.5;
  // The "predicted winner"'s implied is what we want. We can't tell here
  // without the prediction, so fall back to the larger of the two teams'
  // pre_tournament_implied_win — this is conservative for long-shots
  // (gives them more base_points). Caller can override via
  // implied_at_lock_by_match.
  return Math.max(
    homeTeam.pre_tournament_implied_win,
    awayTeam.pre_tournament_implied_win,
  );
}

// ---------- per-match scoring (docs/30) ----------

/**
 * Base correctness points per docs/30. The legacy long-shot model in
 * `scorePick` is still used for downstream cascade scoring; the per-match
 * model below is for the user-facing per-match-prediction game.
 */
export const BASE_POINTS = {
  group_outcome: 50,
  group_exact_score: 200,
  group_first_place: 100,
  group_second_place: 50,
  knockout: {
    r32: 200,
    r16: 400,
    qf: 800,
    sf: 1500,
    tp: 1750,
    f: 3000,
  },
  tournament_winner: 3000,
  top_scorer: 2000,
} as const;

/**
 * The early-lock multiplier from docs/30:
 *
 *   lock_mult(t) = 1.0 + 4.0 × exp(-3 × (t / window))
 *
 * `t` is "time since the user last touched the pick" (so a freshly
 * locked-in pick has small t and high multiplier). `window` is the time
 * from "draw + 24h" to the moment the pick's outcome window opens
 * (kickoff for that pick's match). The multiplier is capped at 5.0×.
 *
 * Inputs are seconds. If the user touched the pick *after* the window
 * opens (negative `t`), the multiplier is clamped to 1.0×.
 */
export function lockMultiplier(secondsSinceLock: number, windowSeconds: number): number {
  if (secondsSinceLock <= 0) return 5.0; // touched at draw → maximum
  if (secondsSinceLock >= windowSeconds) return 1.0; // at-or-after kickoff
  const raw = 1.0 + 4.0 * Math.exp((-3 * secondsSinceLock) / windowSeconds);
  return Math.min(5.0, Math.max(1.0, raw));
}

/**
 * Contrarian multiplier table from docs/30. Applied only to *correct*
 * picks; incorrect picks always score zero so the multiplier doesn't
 * matter on the wrong side.
 */
export function contrarianMultiplier(impliedAtLock: number): number {
  if (impliedAtLock > 0.5) return 1.0;
  if (impliedAtLock >= 0.3) return 1.25;
  if (impliedAtLock >= 0.15) return 1.75;
  if (impliedAtLock >= 0.05) return 2.5;
  return 4.0;
}

export interface MatchScoreInput {
  readonly stage: StageId;
  /** "home_win" | "draw" | "away_win" — predicted outcome. */
  readonly predictedOutcome: MatchPrediction["outcome"];
  readonly actualOutcome: MatchPrediction["outcome"];
  readonly predictedHomeScore?: number;
  readonly predictedAwayScore?: number;
  readonly actualHomeScore?: number;
  readonly actualAwayScore?: number;
  /** Polymarket implied probability of the predicted outcome at lock time. */
  readonly impliedAtLock: number;
  /** Seconds elapsed from "draw + 24h" to the lock time. */
  readonly secondsSinceLock: number;
  /** Length of the lock-window (draw → match kickoff), in seconds. */
  readonly windowSeconds: number;
}

export interface MatchScoreBreakdown {
  readonly basePoints: number;
  readonly outcomeCorrect: boolean;
  readonly exactScoreCorrect: boolean;
  readonly lockMult: number;
  readonly contrarianMult: number;
  readonly raw: number;
  readonly pointsAwarded: number;
}

/**
 * Score one group-stage match prediction per the docs/30 formula:
 *
 *   score = base × lock_mult × contrarian_mult
 *
 * `base` is `group_outcome` (50) for a correct outcome plus
 * `group_exact_score` (200) extra when the exact score is also correct.
 * Wrong outcome → score is 0.
 */
export function scoreGroupMatchPrediction(input: MatchScoreInput): MatchScoreBreakdown {
  const outcomeCorrect = input.predictedOutcome === input.actualOutcome;
  const exactScoreCorrect =
    outcomeCorrect &&
    typeof input.predictedHomeScore === "number" &&
    typeof input.predictedAwayScore === "number" &&
    input.predictedHomeScore === input.actualHomeScore &&
    input.predictedAwayScore === input.actualAwayScore;
  const basePoints = outcomeCorrect
    ? BASE_POINTS.group_outcome + (exactScoreCorrect ? BASE_POINTS.group_exact_score : 0)
    : 0;
  const lockMult = lockMultiplier(input.secondsSinceLock, input.windowSeconds);
  const contrarianMult = contrarianMultiplier(input.impliedAtLock);
  const raw = basePoints * lockMult * contrarianMult;
  return {
    basePoints,
    outcomeCorrect,
    exactScoreCorrect,
    lockMult,
    contrarianMult,
    raw,
    pointsAwarded: Math.round(raw),
  };
}

export interface KnockoutMatchScoreInput {
  readonly stage: Exclude<StageId, "group">;
  readonly predictedWinner: TeamId;
  readonly actualWinner: TeamId;
  readonly impliedAtLock: number;
  readonly secondsSinceLock: number;
  readonly windowSeconds: number;
}

/**
 * Score one knockout-match pick. Same formula structure as group-match
 * scoring, but the base flips to the round-specific value
 * (200/400/800/1500/3000) and there's no exact-score concept (knockouts
 * resolve via ET + pens which we don't ask the user to predict).
 */
export function scoreKnockoutMatchPrediction(input: KnockoutMatchScoreInput): MatchScoreBreakdown {
  const outcomeCorrect = input.predictedWinner === input.actualWinner;
  const basePoints = outcomeCorrect ? BASE_POINTS.knockout[input.stage] ?? 0 : 0;
  const lockMult = lockMultiplier(input.secondsSinceLock, input.windowSeconds);
  const contrarianMult = contrarianMultiplier(input.impliedAtLock);
  const raw = basePoints * lockMult * contrarianMult;
  return {
    basePoints,
    outcomeCorrect,
    exactScoreCorrect: false,
    lockMult,
    contrarianMult,
    raw,
    pointsAwarded: Math.round(raw),
  };
}

export interface GroupStandingPlacementScoreInput {
  readonly position: 1 | 2;
  readonly predictedTeam: TeamId;
  readonly actualTeam: TeamId;
}

/**
 * Score a single group-standings placement (1st or 2nd). The base values
 * come from docs/30 (100 / 50). Multipliers don't apply because the
 * placement is a derived prediction — the lock-time and contrarian
 * multipliers were already applied to the matches that *produced* the
 * standings.
 */
export function scoreGroupPlacement(input: GroupStandingPlacementScoreInput): number {
  if (input.predictedTeam !== input.actualTeam) return 0;
  return input.position === 1
    ? BASE_POINTS.group_first_place
    : BASE_POINTS.group_second_place;
}

