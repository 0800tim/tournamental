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

// SEC-BRK-02: `.strict()` rejects unknown keys (including the
// `source: "imported"` field which would otherwise bypass the
// server-side kickoff lockout in `filterPredictionsByKickoff`). The
// legitimate import path is an internal flow on the WEB side, not a
// client-supplied attribute on the public submit endpoint.
//
// `oddsAtLock` is allowed because the per-match PUT writes it into
// the persisted bracket; the bulk-submit endpoint must accept it on
// the round-trip path (load → edit → re-save) without exploding.
const oddsAtLockSchema = z
  .object({
    homeWin: z.number().min(0).max(1),
    draw: z.number().min(0).max(1).nullable().optional(),
    awayWin: z.number().min(0).max(1),
    source: z.string().min(1).max(64),
    capturedAt: z.string().min(1).max(64),
  })
  .strict();

export const matchPredictionSchema = z
  .object({
    matchId: z.string().min(1).max(64),
    outcome: z.enum(["home_win", "draw", "away_win"]),
    homeScore: z.number().int().min(0).max(99).optional(),
    awayScore: z.number().int().min(0).max(99).optional(),
    lockedAt: z.string().min(1).max(64),
    oddsAtLock: oddsAtLockSchema.optional(),
  })
  .strict();

// ---------- group tiebreaker ----------

export const groupTiebreakerSchema = z
  .object({
    groupId: z.string().min(1).max(8),
    rankedTeams: z.tuple([z.string(), z.string(), z.string(), z.string()]),
    setAt: z.string().min(1).max(64),
  })
  .strict();

// ---------- caps + team-code shape ----------

// SEC-BRK-07: hard caps on prediction record sizes so a hostile client
// can't ship `matchPredictions: { ...100000 entries }` and DoS the JSON
// stringify + DB upsert. The 2026 fixture set is 104 matches; the cap
// is set with headroom for future fixture sets without reopening this
// schema.
export const MAX_GROUP_PREDICTIONS = 128;
// 16 r32 + 8 r16 + 4 qf + 2 sf + 1 tp + 1 final = 32; cap at 64 for
// headroom (future-format brackets) without unbounded growth.
export const MAX_KNOCKOUT_PREDICTIONS = 64;
// SEC-BRK-08: 8 best-thirds slots in the current format; cap at 16.
export const MAX_BEST_THIRDS = 16;

// SEC-BRK-08: ISO-3-ish team code (2..8 alpha chars to cover the
// canonical ISO-3 codes plus provisional placeholders like
// "QUAL"/"TBD"). Rejects prototype-pollution-flavoured keys
// (`__proto__`, etc.) and arbitrary 16-char garbage strings.
const teamCodeSchema = z.string().regex(/^[A-Z]{2,8}$/);

// ---------- bracket ----------

export const bracketSchema = z
  .object({
    bracketId: z.string().min(1).max(128),
    matchPredictions: z
      .record(z.string().max(64), matchPredictionSchema)
      .refine(
        (r) => Object.keys(r).length <= MAX_GROUP_PREDICTIONS,
        { message: `too many matchPredictions (max ${MAX_GROUP_PREDICTIONS})` },
      ),
    groupTiebreakers: z
      .record(z.string().max(16), groupTiebreakerSchema)
      .refine((r) => Object.keys(r).length <= 32, {
        message: "too many groupTiebreakers (max 32)",
      }),
    /**
     * 2026-06-01: user's "Top 8 3rd Place" picks (the 8 best 3rd-placed
     * teams that advance to R32). Optional for back-compat with brackets
     * saved before the new stage was introduced. The cascade engine
     * tolerates an empty / absent value (R32 best-third slots resolve to
     * null until the user fills the new stage).
     */
    bestThirds: z.array(teamCodeSchema).max(MAX_BEST_THIRDS).optional(),
    knockoutPredictions: z
      .record(z.string().max(64), matchPredictionSchema)
      .refine(
        (r) => Object.keys(r).length <= MAX_KNOCKOUT_PREDICTIONS,
        { message: `too many knockoutPredictions (max ${MAX_KNOCKOUT_PREDICTIONS})` },
      ),
    lockedAt: z.string().max(64).optional(),
    version: z.number().int().min(0).max(1_000_000),
  })
  .strict();

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
