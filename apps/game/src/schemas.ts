/**
 * Zod schemas mirroring the `@tournamental/bracket-engine` Bracket / MatchPrediction
 * types. We can't import the TS types as a runtime parser, so we keep the
 * shapes in lock-step here. If `Bracket` ever changes, this file is the
 * one place to update.
 *
 * Validation contract: reject anything that isn't structurally valid before
 * it touches the DB. The route handlers turn every Zod error into a 400
 * with a stable error shape.
 */

import { z } from "zod";

// ---------- match prediction ----------

export const matchPredictionSchema = z.object({
  matchId: z.string().min(1).max(64),
  outcome: z.enum(["home_win", "draw", "away_win"]),
  homeScore: z.number().int().min(0).max(99).optional(),
  awayScore: z.number().int().min(0).max(99).optional(),
  lockedAt: z.string().min(1),
});

// ---------- group tiebreaker ----------

export const groupTiebreakerSchema = z.object({
  groupId: z.string().min(1).max(8),
  rankedTeams: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  setAt: z.string().min(1),
});

// ---------- bracket ----------

export const bracketSchema = z.object({
  bracketId: z.string().min(1).max(128),
  matchPredictions: z.record(z.string(), matchPredictionSchema),
  groupTiebreakers: z.record(z.string(), groupTiebreakerSchema),
  knockoutPredictions: z.record(z.string(), matchPredictionSchema),
  lockedAt: z.string().optional(),
  version: z.number().int().min(0),
});

// ---------- submit body ----------

/**
 * Share guid accepted on submit. We allow either a UUID v4 (the modern
 * web-client format) or a 16-char nanoid-style id (backfill + legacy
 * pre-launch shares). Both are accepted by the web `/s/<guid>` route's
 * `isShareGuidShape` check. The server treats it as an opaque token.
 */
export const shareGuidSchema = z
  .string()
  .regex(
    /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-zA-Z0-9_-]{16})$/,
    "share_guid must be a UUID v4 or a 16-char nanoid",
  );

export const submitBracketBodySchema = z.object({
  tournament_id: z.string().min(1).max(64),
  user_id: z.string().min(1).max(128),
  bracket: bracketSchema,
  /** Optional client-minted share guid. Server mints one if absent. */
  share_guid: shareGuidSchema.optional(),
});

// ---------- match-result body ----------

export const matchResultBodySchema = z.object({
  tournament_id: z.string().min(1).max(64),
  outcome: z.enum(["home_win", "draw", "away_win"]),
  homeScore: z.number().int().min(0).max(99).optional(),
  awayScore: z.number().int().min(0).max(99).optional(),
  winner: z.string().min(1).max(16).optional(),
  stage: z.enum(["group", "r32", "r16", "qf", "sf", "f"]).optional(),
  impliedAtLock: z.number().min(0).max(1).optional(),
  secondsSinceLock: z.number().min(0).optional(),
  windowSeconds: z.number().min(1).optional(),
});

// ---------- syndicate join (test/admin convenience) ----------

export const syndicateJoinBodySchema = z.object({
  user_id: z.string().min(1).max(128),
  syndicate_id: z.string().min(1).max(64),
});

export type SubmitBracketBody = z.infer<typeof submitBracketBodySchema>;
export type MatchResultBody = z.infer<typeof matchResultBodySchema>;
export type SyndicateJoinBody = z.infer<typeof syndicateJoinBodySchema>;
