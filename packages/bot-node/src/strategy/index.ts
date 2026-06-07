import type { MatchSpec, Outcome } from "../types.js";

export interface StrategyContext {
  /** Deterministic seed for this bot, hex or any string. */
  seed: string;
  /** The bot's chalk score in [0, 1]: high = follow the favourite. */
  chalk_score: number;
  /**
   * Optional sentimental favourite. When set, the strategy adds a small
   * additive bonus to the side whose `home_team` or `away_team` code
   * matches this string before re-normalising. Leave undefined to disable
   * the darling bias entirely (the v0.1 behaviour).
   */
  darling_team?: string;
}

export interface PickDecision {
  outcome: Outcome;
}

export interface Strategy {
  /** Stable identifier persisted in the bot row, e.g. `chalk-v1`. */
  name: string;
  /**
   * Decide a pick for one match. Must be deterministic given the same
   * `(match, context)` pair so a node can be replayed bit-for-bit.
   */
  decide(match: MatchSpec, context: StrategyContext): PickDecision;
}

export {
  chalkStrategy,
  defaultChalkScore,
  defaultDarlingTeam,
  DARLING_TEAM_POOL,
} from "./chalk.js";
