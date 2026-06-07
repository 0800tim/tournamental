import type { MatchSpec, Outcome } from "../types.js";

export interface StrategyContext {
  /** Deterministic seed for this bot, hex or any string. */
  seed: string;
  /** The bot's chalk score in [0, 1]: high = follow the favourite. */
  chalk_score: number;
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

export { chalkStrategy } from "./chalk.js";
