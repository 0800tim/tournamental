/**
 * Per-match pick routes — atomic single-pick read/write/delete.
 *
 *   PUT    /v1/picks/:userId/:matchId   — lock or change a pick
 *   GET    /v1/picks/:userId/:matchId   — read the user's current pick
 *   DELETE /v1/picks/:userId/:matchId   — remove a pick (pre-kickoff)
 *
 * These complement the bulk `POST /v1/bracket/submit`. The persistence
 * shape is the same: each user has at most one bracket row per
 * tournament. Per-match writes do a read-modify-write into either
 * `matchPredictions` (group stage) or `knockoutPredictions` (knockouts),
 * so the bulk submit and the per-match write are interchangeable
 * sources of truth.
 *
 * Why this exists: the team-page pick popup (and any future browse-and-pick
 * surfaces) needs to save one prediction without re-encoding the whole
 * bracket. It also lets us emit a per-pick audit line, which is useful for
 * lock-time odds provenance and for UX debugging.
 *
 * Validation:
 *   - 422 `outcome_not_allowed_for_stage` if the match is a knockout
 *     (r32/r16/qf/sf/tp/f) and the body specifies `draw`.
 *   - 409 `match_already_started` if `now() >= kickoff_utc` (PUT, DELETE).
 *   - 404 `not_found` on GET when no pick exists.
 *
 * Auth: same dev-mesh trust model as the rest of `apps/game` —
 * `X-User-Id` header (or `?user_id=` query param) is required and must
 * match the `:userId` URL segment. Production wires this to the Telegram
 * Bot token / SMS-OTP session per docs/13.
 *
 * Rate limit: per-user-per-match token bucket capped at 10 writes/min.
 * Reads are not rate-limited (they hit the DB but are cheap).
 *
 * Audit: every write emits a structured log line at info level so the
 * pino transport (and the JSONL audit pipeline planned in docs/12) can
 * consume them without parsing free-form strings.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";
import type { Bracket } from "../types.js";
import type { MatchPrediction } from "@vtorn/bracket-engine";
import {
  buildDefaultKickoffRegistry,
  checkLockable,
  type KickoffRegistry,
} from "../kickoffs.js";
import { resolveUserId as resolveCallerId } from "./identity.js";

// ---------- helpers ----------

function resolveUserId(req: FastifyRequest): string | null {
  return resolveCallerId(req, {
    devAuth: process.env.GAME_DEV_AUTH === "1" || process.env.NODE_ENV !== "production",
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
  });
}

function isKnockoutStage(stage: string | null): boolean {
  if (!stage) return false;
  return stage !== "group";
}

// ---------- validation ----------

const oddsAtLockSchema = z
  .object({
    homeWin: z.number().min(0).max(1),
    draw: z.number().min(0).max(1).nullable().optional(),
    awayWin: z.number().min(0).max(1),
    source: z.string().min(1).max(64),
    capturedAt: z.string().min(1).max(64),
  })
  .strict();

export const putPickBodySchema = z
  .object({
    tournament_id: z.string().min(1).max(64),
    outcome: z.enum(["home_win", "draw", "away_win"]),
    homeScore: z.number().int().min(0).max(99).optional(),
    awayScore: z.number().int().min(0).max(99).optional(),
    oddsAtLock: oddsAtLockSchema.optional(),
  })
  .strict();

export type PutPickBody = z.infer<typeof putPickBodySchema>;

// ---------- per-user-per-match rate limiter ----------

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process token bucket keyed by `userId:matchId`. Default is 10
 * writes per 60 seconds. We don't reach for Redis here because the
 * service is single-process at dev/staging scale; when we shard, this
 * will become a tiny LUA script behind a Redis client.
 */
export class PerMatchRateLimiter {
  private readonly buckets: Map<string, Bucket> = new Map();
  constructor(
    private readonly maxPerWindow: number = 10,
    private readonly windowMs: number = 60_000,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** Returns true if the request is allowed; false if it should be 429'd. */
  consume(userId: string, matchId: string): boolean {
    const key = `${userId}:${matchId}`;
    const now = this.nowMs();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.maxPerWindow) {
      return false;
    }
    bucket.count++;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

// ---------- route registration ----------

export interface PickRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /** Override the kickoff registry (tests inject deterministic fixtures). */
  readonly kickoffs?: KickoffRegistry;
  /** Override the rate limiter (tests). */
  readonly rateLimiter?: PerMatchRateLimiter;
}

const EMPTY_BRACKET = (bracketId: string): Bracket => ({
  bracketId,
  matchPredictions: {},
  groupTiebreakers: {},
  knockoutPredictions: {},
  version: 1,
});

function generateBracketId(userId: string, tournamentId: string, nowMs: number): string {
  // Deterministic-ish, human readable, fits 128 chars.
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `bk_${safe}_${tournamentId}_${nowMs}`;
}

/**
 * Read the existing bracket payload for (userId, tournamentId) or build
 * a fresh empty one. The first per-match PUT for a user creates the
 * bracket row lazily.
 */
function loadOrInitBracket(
  store: GameStore,
  userId: string,
  tournamentId: string,
  nowMs: number,
): { bracket: Bracket; bracketId: string; created: boolean } {
  const existing = store.getBracketForUser(userId, tournamentId);
  if (!existing) {
    const bracketId = generateBracketId(userId, tournamentId, nowMs);
    return {
      bracket: EMPTY_BRACKET(bracketId),
      bracketId,
      created: true,
    };
  }
  let payload: Bracket;
  try {
    payload = JSON.parse(existing.payload_json) as Bracket;
  } catch {
    // Defensive: corrupt row → start fresh, the bulk submit handler will
    // overwrite if the user later submits the full bracket.
    return {
      bracket: EMPTY_BRACKET(existing.id),
      bracketId: existing.id,
      created: false,
    };
  }
  return { bracket: payload, bracketId: existing.id, created: false };
}

export async function registerPickRoutes(
  app: FastifyInstance,
  deps: PickRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const registry = deps.kickoffs ?? buildDefaultKickoffRegistry();
  const limiter = deps.rateLimiter ?? new PerMatchRateLimiter();

  // --- shared param checks -----------------------------------------

  function requireOwner(
    req: FastifyRequest,
    reply: FastifyReply,
    pathUserId: string,
  ): boolean {
    const callerId = resolveUserId(req);
    if (!callerId) {
      reply.code(401).send({ error: "missing_user" });
      return false;
    }
    if (callerId !== pathUserId) {
      reply.code(403).send({ error: "user_mismatch" });
      return false;
    }
    return true;
  }

  function validIds(
    userId: string,
    matchId: string,
    reply: FastifyReply,
  ): boolean {
    if (!userId || userId.length > 128) {
      reply.code(400).send({ error: "invalid_user_id" });
      return false;
    }
    if (!matchId || matchId.length > 64) {
      reply.code(400).send({ error: "invalid_match_id" });
      return false;
    }
    return true;
  }

  // --- PUT (atomic single-pick lock) -------------------------------

  app.put("/v1/picks/:userId/:matchId", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = req.params as { userId?: string; matchId?: string };
    const userId = params.userId ?? "";
    const matchId = params.matchId ?? "";
    if (!validIds(userId, matchId, reply)) return reply;
    if (!requireOwner(req, reply, userId)) return reply;

    if (!limiter.consume(userId, matchId)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const parsed = putPickBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const body = parsed.data;
    const lookup = registry.forTournament(body.tournament_id);

    // Stage validation: knockouts forbid draws.
    const stage = lookup.stageFor(matchId);
    if (body.outcome === "draw" && isKnockoutStage(stage)) {
      return reply.code(422).send({
        error: "outcome_not_allowed_for_stage",
        stage,
        message: "Knockout matches cannot end in a draw at this layer.",
      });
    }

    // Lockout: now() must be < kickoff_utc.
    const kickoff = lookup.kickoffFor(matchId);
    const nowMs = now();
    const lock = checkLockable({ kickoff_utc: kickoff, lockedAtMs: nowMs });
    if (!lock.lockable) {
      return reply.code(409).send({
        error: "match_already_started",
        match_id: matchId,
        kickoff_utc: lock.kickoff_utc,
        now: new Date(nowMs).toISOString(),
      });
    }

    const lockedAtIso = new Date(nowMs).toISOString();
    const newPick: MatchPrediction = {
      matchId,
      outcome: body.outcome,
      ...(body.homeScore !== undefined ? { homeScore: body.homeScore } : {}),
      ...(body.awayScore !== undefined ? { awayScore: body.awayScore } : {}),
      lockedAt: lockedAtIso,
      ...(body.oddsAtLock ? { oddsAtLock: body.oddsAtLock } : {}),
    } as MatchPrediction;

    const { bracket, bracketId, created } = loadOrInitBracket(
      deps.store,
      userId,
      body.tournament_id,
      nowMs,
    );
    const isKnockout = isKnockoutStage(stage);
    const nextBracket: Bracket = {
      ...bracket,
      matchPredictions: isKnockout
        ? bracket.matchPredictions
        : { ...bracket.matchPredictions, [matchId]: newPick },
      knockoutPredictions: isKnockout
        ? { ...bracket.knockoutPredictions, [matchId]: newPick }
        : bracket.knockoutPredictions,
    };
    deps.store.upsertBracket({
      bracketId,
      userId,
      tournamentId: body.tournament_id,
      bracket: nextBracket,
      lockedAt: nowMs,
    });

    req.log.info(
      {
        evt: "per_match_pick_put",
        user_id: userId,
        tournament_id: body.tournament_id,
        match_id: matchId,
        outcome: body.outcome,
        stage,
        bracket_created: created,
        locked_at: lockedAtIso,
      },
      "per-match pick saved",
    );

    return reply.code(200).send({
      pick: newPick,
      bracket_id: bracketId,
      tournament_id: body.tournament_id,
      stage,
      cascade_refresh_hint: isKnockout,
    });
  });

  // --- GET (read single pick) --------------------------------------

  app.get("/v1/picks/:userId/:matchId", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = req.params as { userId?: string; matchId?: string };
    const userId = params.userId ?? "";
    const matchId = params.matchId ?? "";
    if (!validIds(userId, matchId, reply)) return reply;
    if (!requireOwner(req, reply, userId)) return reply;

    const qs = (req.query ?? {}) as Record<string, unknown>;
    const tournamentId = typeof qs.tournament_id === "string" ? qs.tournament_id : null;
    if (!tournamentId) {
      return reply.code(400).send({ error: "missing_tournament_id" });
    }

    const row = deps.store.getBracketForUser(userId, tournamentId);
    if (!row) return reply.code(404).send({ error: "not_found" });
    let bracket: Bracket;
    try {
      bracket = JSON.parse(row.payload_json) as Bracket;
    } catch {
      return reply.code(500).send({ error: "corrupt_payload" });
    }
    const pick =
      bracket.matchPredictions?.[matchId] ??
      bracket.knockoutPredictions?.[matchId] ??
      null;
    if (!pick) return reply.code(404).send({ error: "not_found" });

    const lookup = registry.forTournament(tournamentId);
    return reply.code(200).send({
      pick,
      bracket_id: row.id,
      tournament_id: tournamentId,
      stage: lookup.stageFor(matchId),
      kickoff_utc: lookup.kickoffFor(matchId),
    });
  });

  // --- DELETE (remove a pick) --------------------------------------

  app.delete("/v1/picks/:userId/:matchId", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const params = req.params as { userId?: string; matchId?: string };
    const userId = params.userId ?? "";
    const matchId = params.matchId ?? "";
    if (!validIds(userId, matchId, reply)) return reply;
    if (!requireOwner(req, reply, userId)) return reply;
    if (!limiter.consume(userId, matchId)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const qs = (req.query ?? {}) as Record<string, unknown>;
    const tournamentId = typeof qs.tournament_id === "string" ? qs.tournament_id : null;
    if (!tournamentId) {
      return reply.code(400).send({ error: "missing_tournament_id" });
    }

    const lookup = registry.forTournament(tournamentId);
    const kickoff = lookup.kickoffFor(matchId);
    const nowMs = now();
    const lock = checkLockable({ kickoff_utc: kickoff, lockedAtMs: nowMs });
    if (!lock.lockable) {
      return reply.code(409).send({
        error: "match_already_started",
        match_id: matchId,
        kickoff_utc: lock.kickoff_utc,
        now: new Date(nowMs).toISOString(),
      });
    }

    const row = deps.store.getBracketForUser(userId, tournamentId);
    if (!row) return reply.code(404).send({ error: "not_found" });
    let bracket: Bracket;
    try {
      bracket = JSON.parse(row.payload_json) as Bracket;
    } catch {
      return reply.code(500).send({ error: "corrupt_payload" });
    }
    const hadGroup = !!bracket.matchPredictions?.[matchId];
    const hadKnockout = !!bracket.knockoutPredictions?.[matchId];
    if (!hadGroup && !hadKnockout) {
      return reply.code(404).send({ error: "not_found" });
    }
    const nextGroup = { ...bracket.matchPredictions };
    delete nextGroup[matchId];
    const nextKnockout = { ...bracket.knockoutPredictions };
    delete nextKnockout[matchId];
    const next: Bracket = {
      ...bracket,
      matchPredictions: nextGroup,
      knockoutPredictions: nextKnockout,
    };
    deps.store.upsertBracket({
      bracketId: row.id,
      userId,
      tournamentId,
      bracket: next,
      lockedAt: nowMs,
    });

    req.log.info(
      {
        evt: "per_match_pick_delete",
        user_id: userId,
        tournament_id: tournamentId,
        match_id: matchId,
        deleted_at: new Date(nowMs).toISOString(),
      },
      "per-match pick removed",
    );

    return reply.code(200).send({
      removed: true,
      match_id: matchId,
      bracket_id: row.id,
      tournament_id: tournamentId,
    });
  });
}
