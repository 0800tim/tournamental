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

// ---------- users + profile ----------

/**
 * Handle pattern: lowercase letters, digits, underscore. 3-24 chars.
 * Deliberately no `.` (Twitter-style handles are easier to address than
 * email-style ones) and no leading underscore (Telegram convention).
 */
export const handleSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "handle must be lowercase letters, digits or underscore");

export const authMethodSchema = z.enum([
  "telegram",
  "sms",
  "email-magic-link",
  "guest",
]);

export const ageBucketSchema = z.enum([
  "<18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
]);

export const genderSchema = z.enum([
  "male",
  "female",
  "non-binary",
  "prefer-not-to-say",
]);

export const watchesViaSchema = z.enum([
  "tv",
  "streaming",
  "in-person",
  "highlights",
]);

/** ISO-2 country code; we don't validate against a closed list so unknown
 *  codes (e.g. Kosovo "XK") still flow through. The shape is the cheap
 *  defence; the canonical 48-team list governs `favourite_team_code`. */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "country_code must be ISO-2 uppercase");

/** FIFA-3 team code (e.g. "ARG"). Closed-list validation against the
 *  canonical 48-team file is layered on top in the route handler — the
 *  schema only enforces the *shape* so the rest of the validation
 *  pipeline is one Zod parse. */
export const teamCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "favourite_team_code must be a 3-letter team code");

export const registerUserBodySchema = z
  .object({
    handle: handleSchema,
    auth_method: authMethodSchema,
    auth_id: z.string().min(1).max(128).optional(),
    display_name: z.string().min(1).max(64).optional(),
  })
  .strict();

export const profilePatchBodySchema = z
  .object({
    age_bucket: ageBucketSchema.nullable().optional(),
    gender: genderSchema.nullable().optional(),
    country_code: countryCodeSchema.nullable().optional(),
    city: z.string().max(80).nullable().optional(),
    timezone: z.string().max(64).nullable().optional(),
    favourite_team_code: teamCodeSchema.nullable().optional(),
    follows_leagues: z.string().max(256).nullable().optional(),
    watches_via: watchesViaSchema.nullable().optional(),
    marketing_consent: z.boolean().optional(),
    analytics_consent: z.boolean().optional(),
    display_name: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0,
    "profile patch must include at least one field",
  );

export type RegisterUserBody = z.infer<typeof registerUserBodySchema>;
export type ProfilePatchBody = z.infer<typeof profilePatchBodySchema>;
