/**
 * Zod schemas mirroring the `@vtorn/bracket-engine` Bracket / MatchPrediction
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

export const submitBracketBodySchema = z.object({
  tournament_id: z.string().min(1).max(64),
  user_id: z.string().min(1).max(128),
  bracket: bracketSchema,
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
