/**
 * Public types for `@vtorn/social-cards`.
 *
 * Each card kind has a typed input. `generateOG(input, kind)` is the single
 * entry point and is fully discriminated: TypeScript will narrow on `kind`.
 */

export type CardKind =
  | "bracket-prediction"
  | "goal-clip"
  | "match-result"
  | "leaderboard-rank"
  | "badge-earned"
  | "referral-invite"
  | "tournament-recap";

export interface CommonFooter {
  /** User handle to feature in the card body and footer. */
  userHandle: string;
  /** Stable user id for the referral URL — never expose raw email/uuid here. */
  userId: string;
  /** Optional locale tag (e.g. "en", "es", "pt", "fr", "ar", "ja"). */
  locale?: string;
  /**
   * Optional Verified-Pundit status. When present and `verified`, every
   * card type renders a small gold tick next to the user handle in the
   * footer + body so the brand-trust signal travels with every share.
   *
   * Future-revenue-share hook (TODO, do NOT implement here): the same
   * shape is the canonical signal for the Drips Network contributor
   * allocation per docs/19. Treat it as the single source of truth.
   */
  pundit?: {
    verified: boolean;
    levels: number;
    sinceDate?: string | null;
    tournaments?: ReadonlyArray<string>;
  };
}

export interface BracketPredictionInput extends CommonFooter {
  tournamentName: string;
  /**
   * Bracket lock — list of round → predicted winner pairs.
   * A 32-team WC bracket has 47 picks; a 16-team has 15.
   * Cards render the first 16 picks max (the rest are visually folded).
   */
  picks: Array<{ round: string; pick: string }>;
  /** Optional confidence number to spotlight (Prediction IQ at lock-time). */
  predictionIq?: number;
}

export interface GoalClipInput extends CommonFooter {
  tournamentName: string;
  matchLabel: string; // "ARG vs FRA — Final"
  scorer: string; // "Lionel Messi"
  scoreTeam0: number;
  scoreTeam1: number;
  team0Code: string; // "ARG"
  team1Code: string; // "FRA"
  minute: number;
  /** "called-this" — whether the user predicted this goal correctly. */
  predictedByUser?: boolean;
}

export interface MatchResultInput extends CommonFooter {
  tournamentName: string;
  matchLabel: string;
  team0Code: string;
  team1Code: string;
  scoreTeam0: number;
  scoreTeam1: number;
  /** Predicted score, if the user locked one in. */
  predictedScoreTeam0?: number;
  predictedScoreTeam1?: number;
  pointsEarned: number;
}

export interface LeaderboardRankInput extends CommonFooter {
  scope: "global" | "country" | "tournament";
  scopeLabel: string; // "Global" | "Argentina" | "World Cup 2026"
  rank: number;
  totalEntrants: number;
  weeklyMove?: number; // +/- positions; positive = climbed
}

export interface BadgeEarnedInput extends CommonFooter {
  badgeSlug: string;
  badgeTitle: string;
  badgeTier: "bronze" | "silver" | "gold" | "platinum" | "mythic";
  badgeDescription: string;
}

export interface ReferralInviteInput extends CommonFooter {
  /** Optional human-readable invite headline override. */
  inviteHeadline?: string;
  /** Bonus tokens granted on signup, displayed prominently. */
  bonusTokens: number;
  /** Optional tournament context — e.g. "World Cup 2026". */
  tournamentName?: string;
}

export interface TournamentRecapInput extends CommonFooter {
  tournamentName: string;
  predictionsLocked: number;
  correctPredictions: number;
  pointsEarned: number;
  rankFinal: number;
  totalEntrants: number;
  /** Highlight reel of headline moments. Only first 3 are rendered. */
  highlights?: string[];
}

/** Discriminated union of every card input. */
export type CardInput =
  | { kind: "bracket-prediction"; data: BracketPredictionInput }
  | { kind: "goal-clip"; data: GoalClipInput }
  | { kind: "match-result"; data: MatchResultInput }
  | { kind: "leaderboard-rank"; data: LeaderboardRankInput }
  | { kind: "badge-earned"; data: BadgeEarnedInput }
  | { kind: "referral-invite"; data: ReferralInviteInput }
  | { kind: "tournament-recap"; data: TournamentRecapInput };

export interface RenderOptions {
  /**
   * Which size variant to produce.
   *  - `og` (1200×630) for OG / X / FB / Telegram link previews.
   *  - `story` (1080×1920) for TikTok / IG Reels / IG Stories / YT Shorts.
   */
  size: "og" | "story";
  /** Custom UTM source override. Defaults to `share-card`. */
  utmSource?: string;
  /** Optional UTM campaign override. Defaults to the card kind. */
  utmCampaign?: string;
}
