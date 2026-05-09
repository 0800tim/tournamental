/**
 * Tournament model — pure data shapes for the bracket engine.
 *
 * The 2026 FIFA World Cup is the launch tournament. Format used here:
 *
 *   48 teams → 8 groups of 6 → top-4-of-each-group advance → 32 teams →
 *   Round of 32 → R16 → Quarter-finals → Semi-finals → Final.
 *
 * Note: the official FIFA 2026 format is 12 groups of 4 with top-32
 * advancing. This package follows the VTourn product brief (8 groups of 6,
 * 48 teams, R32→F) — see `data/fifa-wc-2026-fixtures.json` `_meta` for
 * source notes. The engine itself is generic — group counts, team-per-
 * group counts, and advancement rules are all config-driven so a real
 * 12×4 config can be dropped in by replacing the JSON.
 */

// ---------- primitives ----------

export type TeamId = string; // ISO-3166 alpha-3 (e.g. "FRA", "ARG", "USA")
export type GroupId = string; // "A".."H"
export type StageId = "group" | "r32" | "r16" | "qf" | "sf" | "f";

/**
 * Stage advancement order. The engine walks this in order to compute the
 * downstream cascade.
 */
export const KNOCKOUT_STAGES: readonly StageId[] = [
  "r32",
  "r16",
  "qf",
  "sf",
  "f",
] as const;

// ---------- team ----------

export interface Team {
  /** Stable team id. ISO alpha-3 where possible. Placeholder slots use "SLOT_<n>". */
  readonly id: TeamId;
  /** Display name, e.g. "France". */
  readonly name: string;
  /** ISO alpha-3 country code (the host nation for player events). */
  readonly country: string;
  /** FIFA world ranking at config time, lower = stronger. */
  readonly fifa_rank: number;
  /**
   * Pre-tournament market-implied win probability (0–1). Used by the score
   * model when an explicit lock-time market price isn't available.
   */
  readonly pre_tournament_implied_win: number;
  /** True if the team is a placeholder (draw not yet performed). */
  readonly placeholder?: boolean;
}

// ---------- group ----------

export interface Group {
  readonly id: GroupId;
  readonly team_ids: readonly TeamId[]; // canonical ordering inside the group; index 0..n-1
}

/**
 * Match in the group stage, identified by the two slot indices inside the
 * group (e.g. group A, team_idx 0 vs team_idx 3).
 */
export interface GroupFixture {
  readonly match_no: number; // 1..104, FIFA-canonical match number
  readonly group_id: GroupId;
  readonly home_idx: number;
  readonly away_idx: number;
  readonly kickoff_utc: string; // ISO-8601, e.g. "2026-06-11T16:00:00Z"
  readonly host: "US" | "CA" | "MX";
  readonly venue: string;
}

// ---------- knockout slot ----------

/**
 * A knockout slot is a placeholder for "the team that will fill this
 * position once group / earlier knockout results are known". It encodes
 * dependencies declaratively so the cascade calculator never has to know
 * specific competition rules — it just walks the dependency graph.
 *
 * Examples:
 *   { kind: "group_position", group: "A", position: 1 }
 *     → "winner of group A"
 *   { kind: "best_third", rank: 2, eligible_groups: ["A","B","C","D","E","F","G","H"] }
 *     → "the 2nd-best 3rd-placed team across all groups"
 *   { kind: "knockout_winner", match_id: "r32_03" }
 *     → "winner of knockout match r32_03"
 */
export type SlotSource =
  | {
      readonly kind: "group_position";
      readonly group: GroupId;
      readonly position: number; // 1=winner, 2=runner-up, 3=third, ...
    }
  | {
      readonly kind: "best_third";
      /** 1-indexed rank among eligible 3rd-placed teams. */
      readonly rank: number;
      readonly eligible_groups: readonly GroupId[];
    }
  | {
      readonly kind: "best_fourth";
      readonly rank: number;
      readonly eligible_groups: readonly GroupId[];
    }
  | {
      readonly kind: "knockout_winner";
      readonly match_id: string;
    }
  | {
      readonly kind: "knockout_loser";
      readonly match_id: string;
    };

export interface KnockoutFixture {
  readonly id: string; // e.g. "r32_01", "r16_07", "qf_03", "sf_01", "final"
  readonly stage: Exclude<StageId, "group">;
  readonly match_no: number;
  readonly home: SlotSource;
  readonly away: SlotSource;
  readonly kickoff_utc: string;
  readonly host: "US" | "CA" | "MX";
  readonly venue: string;
}

// ---------- tournament ----------

export interface Tournament {
  readonly id: string; // e.g. "fifa-wc-2026"
  readonly name: string;
  readonly start_utc: string; // tournament kickoff (UTC)
  readonly final_utc: string; // tournament final kickoff (UTC)
  readonly teams: readonly Team[];
  readonly groups: readonly Group[];
  readonly group_fixtures: readonly GroupFixture[];
  readonly knockouts: readonly KnockoutFixture[];
  /**
   * Advancement rules: how many teams advance from each group, plus any
   * cross-group "best Nth-placed" pools. Used by the cascade calculator
   * when group_position slots reference a position > N.
   */
  readonly advancement: AdvancementRules;
}

export interface AdvancementRules {
  /** N teams from each group automatically advance, in finishing order. */
  readonly automatic_per_group: number;
  /** Total number of "best Nth-placed" wildcards. */
  readonly wildcard_third: number;
  readonly wildcard_fourth: number;
}

// ---------- predictions ----------

/**
 * The user's predicted finishing order for one group. Index 0 is predicted
 * 1st, index 1 is 2nd, and so on. Length must equal the group's team count.
 */
export interface GroupPrediction {
  readonly group_id: GroupId;
  /** Team ids in predicted finishing order (1st, 2nd, ...). */
  readonly order: readonly TeamId[];
}

/**
 * The user's predicted winner of a knockout fixture. The cascade
 * calculator validates that the predicted winner is actually a possible
 * occupant of one of the two slots given the upstream picks.
 */
export interface KnockoutPrediction {
  readonly match_id: string;
  readonly winner: TeamId;
}

/**
 * Per-pick lock state. A user can optionally "lock" individual picks at
 * the current market odds for higher-on-correct points (vs. saving the
 * draft, which doesn't lock).
 */
export interface PickLock {
  readonly key: string; // e.g. "group:A" or "knockout:r32_03"
  readonly locked_at_utc: string;
  readonly market_implied_at_lock: number; // 0–1
}

export interface BracketPrediction {
  readonly tournament_id: string;
  readonly user_id: string;
  readonly groups: readonly GroupPrediction[];
  /**
   * 0 .. wildcard_third teams. Order matters: index 0 is the user's
   * predicted "best 3rd-placer".
   */
  readonly best_thirds: readonly TeamId[];
  readonly best_fourths: readonly TeamId[];
  readonly knockouts: readonly KnockoutPrediction[];
  readonly locks: readonly PickLock[];
  /** ISO-8601 timestamp of when this BracketPrediction was last edited. */
  readonly updated_at_utc: string;
}

// ---------- actual results (for live recalc) ----------

export interface GroupActualStanding {
  readonly group_id: GroupId;
  readonly final_order: readonly TeamId[]; // confirmed finishing order
  readonly settled: boolean;
}

export interface KnockoutActualResult {
  readonly match_id: string;
  readonly winner: TeamId;
  readonly settled: boolean;
}

export interface CompletedResults {
  readonly groups: readonly GroupActualStanding[];
  readonly knockouts: readonly KnockoutActualResult[];
  /**
   * Optional list of teams withdrawn from the tournament. Withdrawn teams
   * are treated as automatic losses everywhere they appear in predictions
   * and cascades. The cascade flags affected matches.
   */
  readonly withdrawn?: readonly TeamId[];
}
