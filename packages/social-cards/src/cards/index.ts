/**
 * Card builder index — every CardKind ↔ a `cardFor(...)` call.
 *
 * Builders return a satori-compatible element tree. They are *pure*: same
 * input → same output, no I/O, no side-effects. Rasterisation is in
 * `src/render.ts`.
 */

import type { SatoriElement } from "../jsdl.js";
import type { CardSize } from "../theme.js";
import type { CardInput } from "../types.js";

import { bracketPredictionCard } from "./bracket-prediction.js";
import { goalClipCard } from "./goal-clip.js";
import { matchResultCard } from "./match-result.js";
import { leaderboardRankCard } from "./leaderboard-rank.js";
import { badgeEarnedCard } from "./badge-earned.js";
import { referralInviteCard } from "./referral-invite.js";
import { tournamentRecapCard } from "./tournament-recap.js";

export {
  bracketPredictionCard,
  goalClipCard,
  matchResultCard,
  leaderboardRankCard,
  badgeEarnedCard,
  referralInviteCard,
  tournamentRecapCard,
};

/**
 * Build the satori element tree for any card kind.
 *
 * The discriminated union on `input.kind` makes this exhaustive at
 * compile-time: adding a new CardKind without a builder fails typecheck.
 */
export function buildCard(input: CardInput, size: CardSize): SatoriElement {
  switch (input.kind) {
    case "bracket-prediction":
      return bracketPredictionCard(input.data, size);
    case "goal-clip":
      return goalClipCard(input.data, size);
    case "match-result":
      return matchResultCard(input.data, size);
    case "leaderboard-rank":
      return leaderboardRankCard(input.data, size);
    case "badge-earned":
      return badgeEarnedCard(input.data, size);
    case "referral-invite":
      return referralInviteCard(input.data, size);
    case "tournament-recap":
      return tournamentRecapCard(input.data, size);
    default: {
      const _exhaustive: never = input;
      void _exhaustive;
      throw new Error(`[social-cards] unknown card kind`);
    }
  }
}
