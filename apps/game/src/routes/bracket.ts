/**
 * Bracket submission + retrieval routes.
 *
 *   POST /v1/bracket/submit
 *   GET  /v1/bracket/me
 *   POST /v1/predictions/:matchId/check-lockable
 *
 * Both routes require a `user_id` to identify the user. We accept it via
 * either an `X-User-Id` header or a `?user_id=` query param. Real auth
 * comes from the Telegram Bot (doc 13) and SMS (auth-sms) — for now this
 * service trusts the header the way the rest of the dev stack does.
 *
 * Caching: both are user-specific writes/reads, so `Cache-Control:
 * private, no-store` per CLAUDE.md.
 *
 * Server-side kickoff lockout: every `MatchPrediction` in a submitted
 * bracket is validated against the tournament's published `kickoff_utc`.
 * Predictions whose `lockedAt` is at or after kickoff are rejected with a
 * structured error and stripped from the persisted bracket. The remaining
 * predictions still go through. The client (PR #74) does this client-side;
 * this is the server-side backstop.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { submitBracketBodySchema } from "../schemas.js";
import type { GameStore } from "../store/db.js";
import type { LockReceipt, Bracket } from "../types.js";
import {
  buildDefaultKickoffRegistry,
  checkLockable,
  type KickoffRegistry,
} from "../kickoffs.js";
import type { MatchPrediction } from "@tournamental/bracket-engine";
import { resolveUserId as resolveCallerId } from "./identity.js";

/**
 * One-time recovery allowlist + window for the SEC-BRK-02 regression
 * (Tim 2026-06-12). These ten accounts had their match-1 pick destroyed
 * by autosaves that fired after kickoff before the fix landed. Their
 * browser localStorage still carries the original pre-kickoff pick so
 * when they re-open the app on the same device the autosave resubmits
 * it; under this allowlist + a pre-kickoff `lockedAt` check the server
 * accepts it. The window auto-expires 48 hours after the patch so the
 * allowlist becomes inert with no further code change required.
 */
const RECOVERY_ALLOWLIST_MATCH_1: ReadonlySet<string> = new Set([
  "u_c43df586f27c4d668e15f6", // Sam Schuetz
  "u_c9d465f6aa894345bd456a", // Tracey Neilson
  "u_60e467a2710d4d529bcfd3", // Jared Ho
  "u_24bc02b8d166463c8de35a", // Ingrid Proctor
  "u_f651e3bd05c34aa1adc8e1", // Pablo Tumax
  "u_474a7859ae87483c835138", // Gordon Tan
  "u_ad0880ba84904319af7d20", // Priyansh Malik
  "u_d2573924f4574e1090413a", // Zac Metin
  "u_22b42c911cdc4edba48eed", // Holly Parkes (kwitty_kwat)
  "u_e56caeb8c57b4402a65fae", // Hamish Wood (Hamish ADLT)
]);

/** Expiry timestamp for the recovery window. 48h after the patch
 *  landed (2026-06-12 13:30 NZT = 2026-06-12 01:30 UTC). */
const RECOVERY_EXPIRES_MS = Date.UTC(2026, 5, 14, 1, 30, 0);

/**
 * Returns true when `lockedAtRaw` parses to a timestamp that is at
 * least one hour before the match's kickoff. We use the lower bound
 * to narrow the recovery window's tamper surface: a tampered client
 * cannot just claim "I picked one second before kickoff" to slip in
 * a late pick. One hour is generous for users who locked their
 * bracket in the few days before match 1 (the 10 allowlisted
 * accounts all locked their picks days to weeks pre-kickoff).
 */
function isPreKickoffLockedAt(
  lockedAtRaw: string | undefined,
  kickoffMs: number,
): boolean {
  if (!lockedAtRaw) return false;
  const ms = Date.parse(lockedAtRaw);
  if (Number.isNaN(ms)) return false;
  return ms <= kickoffMs - 60 * 60 * 1000;
}

// SEC-BRK-09: the dev-fallback `X-User-Id` header is enabled ONLY
// when `GAME_DEV_AUTH=1`. Production previously also activated it
// via `NODE_ENV !== "production"`, which is footgun-flavoured: a
// missing/misspelled NODE_ENV in any environment (CI, staging, a
// container without an explicit env) would silently re-enable the
// unsigned-header path. Single explicit opt-in only.
function resolveUserId(req: FastifyRequest): string | null {
  return resolveCallerId(req, {
    devAuth: process.env.GAME_DEV_AUTH === "1",
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
    authSmsJwtSecret: process.env.AUTH_JWT_SECRET ?? null,
  });
}

export interface BracketRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /** Override the kickoff registry (tests inject deterministic fixtures). */
  readonly kickoffs?: KickoffRegistry;
}

export interface RejectedPrediction {
  readonly matchId: string;
  readonly error: "match_already_started";
  readonly kickoff_utc: string;
  readonly lockedAt: string;
}

/**
 * Filter a record of MatchPrediction by kickoff. Returns the kept set
 * (still lockable) and a list of rejected ones with structured detail.
 *
 * Rules:
 *   - Predictions whose `lockedAt` parses to a real ms value AND is `>=`
 *     the match's `kickoff_utc` are rejected.
 *   - Predictions whose `lockedAt` doesn't parse are kept (the schema
 *     already validated it's a non-empty string; a malformed timestamp
 *     here is a programmer error, not a kickoff violation).
 *   - Predictions for matches with no known kickoff (knockout slots whose
 *     cascade hasn't resolved, or unknown tournaments) are kept.
 */
function filterPredictionsByKickoff(
  predictions: Record<string, MatchPrediction>,
  kickoffFor: (matchId: string) => string | null,
  // SEC-BRK-02 (Tim 2026-06-08): the lock decision MUST use the server
  // clock, never the client-supplied `pred.lockedAt`. The old code
  // compared `pred.lockedAt >= kickoff`, which a tampered client could
  // bypass by sending a faked early lockedAt for a pick it actually
  // made after kickoff. We now reject any non-imported prediction whose
  // match has already kicked off per `nowMs` (the route's server now()).
  // Browser-clock manipulation is irrelevant: this value comes from the
  // server, not the request.
  nowMs: number,
  // SEC-BRK-02 recovery (Tim 2026-06-12): the operator's user_id is
  // passed in so the filter can apply the one-time post-incident
  // recovery rule below for the ten affected accounts.
  userId: string,
  // SEC-BRK-02 follow-up (Tim 2026-06-12): the server-clock check above
  // also destroyed previously-saved picks. A user who picked Mexico at
  // 06:30 NZT (pre-kickoff) then resumed editing at 11:17 NZT (post-
  // kickoff) would autosave with match 1 still in the payload; the
  // filter saw `nowMs >= kickoffMs` and stripped it from the persist
  // path, deleting their already-saved correct pick. Pass in the
  // previously-persisted predictions for the same field and, when a
  // post-kickoff prediction matches one we already have on file, keep
  // the existing one verbatim instead of rejecting. The anti-tamper
  // intent still holds: NEW picks for past-kickoff matches that the
  // user did not already have are still rejected.
  existing?: Record<string, MatchPrediction>,
): {
  kept: Record<string, MatchPrediction>;
  rejected: RejectedPrediction[];
} {
  const kept: Record<string, MatchPrediction> = {};
  const rejected: RejectedPrediction[] = [];
  for (const [key, pred] of Object.entries(predictions)) {
    const kickoff = kickoffFor(pred.matchId);
    if (!kickoff) {
      kept[key] = pred;
      continue;
    }
    const kickoffMs = Date.parse(kickoff);
    if (Number.isNaN(kickoffMs)) {
      kept[key] = pred;
      continue;
    }
    if (nowMs >= kickoffMs) {
      // Bracket-import bypass (docs/69-bracket-import.md): picks
      // carrying source='imported' come from a rival platform's
      // public bracket page, which already locked them at first-match
      // kickoff. The successful scrape is the proof-of-lock-in, so we
      // accept the pick despite the late submission. Live picks (no
      // source field, or source='live') are rejected once the match has
      // kicked off on the server clock.
      if (pred.source === "imported") {
        kept[key] = pred;
        continue;
      }
      // Preserve previously-saved picks (Tim 2026-06-12). If the
      // existing persisted bracket already carried a prediction for
      // this match (made before kickoff) keep it as-is. This stops
      // the autosave-after-kickoff bug that was overwriting good
      // picks with empty slots. We do not let the client mutate the
      // existing prediction's outcome via this path: the stored one
      // wins regardless of what the incoming pred says.
      const prior = existing?.[key];
      if (prior) {
        kept[key] = prior;
        continue;
      }
      // One-time recovery window for the 10 users whose match-1 pick
      // was destroyed by the SEC-BRK-02 regression before the fix
      // landed (Tim 2026-06-12). Their browser localStorage still
      // carries the original pre-kickoff pick; when they re-open the
      // app on the same device the autosave resubmits it, and we
      // accept it for match 1 only, with `pred.lockedAt` proving the
      // pick predates kickoff by at least an hour. Window expires at
      // RECOVERY_EXPIRES_MS (48h after the fix) after which the
      // allowlist becomes a no-op.
      if (
        nowMs < RECOVERY_EXPIRES_MS &&
        pred.matchId === "1" &&
        RECOVERY_ALLOWLIST_MATCH_1.has(userId) &&
        isPreKickoffLockedAt(pred.lockedAt, kickoffMs)
      ) {
        kept[key] = pred;
        continue;
      }
      rejected.push({
        matchId: pred.matchId,
        error: "match_already_started",
        kickoff_utc: kickoff,
        lockedAt: pred.lockedAt,
      });
      continue;
    }
    kept[key] = pred;
  }
  // Belt and braces: re-include any existing predictions for past-
  // kickoff matches that the submitter omitted entirely (e.g. their
  // client purged the entry after an earlier rejection). The same
  // preserve-priors rule applies. Pre-kickoff existing picks the
  // client dropped are deliberately NOT re-included here; for those
  // matches the user is allowed to unset their pick.
  if (existing) {
    for (const [key, prior] of Object.entries(existing)) {
      if (kept[key]) continue;
      const kickoff = kickoffFor(prior.matchId);
      if (!kickoff) continue;
      const kickoffMs = Date.parse(kickoff);
      if (Number.isNaN(kickoffMs)) continue;
      if (nowMs >= kickoffMs) {
        kept[key] = prior;
      }
    }
  }
  return { kept, rejected };
}

export async function registerBracketRoutes(
  app: FastifyInstance,
  deps: BracketRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const registry = deps.kickoffs ?? buildDefaultKickoffRegistry();

  app.post("/v1/bracket/submit", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    // SEC-BRK-01: resolve the caller's identity BEFORE trusting the
    // body's `user_id`. The route previously upserted whatever
    // `user_id` the body carried, which let any authenticated caller
    // overwrite a victim's bracket. We now require a verified
    // session (tnm_session cookie / Bearer JWT / personal API key —
    // or the dev-header fallback when GAME_DEV_AUTH=1) and 403 if
    // the body claims a different user.
    const callerId = resolveUserId(req);
    if (!callerId) {
      return reply.code(401).send({ error: "missing_user" });
    }

    const parsed = submitBracketBodySchema.safeParse(req.body);
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

    const { tournament_id, user_id, bracket, share_guid } = parsed.data;
    if (user_id !== callerId) {
      return reply.code(403).send({ error: "user_mismatch" });
    }
    const lookup = registry.forTournament(tournament_id);

    // If the client supplied a share_guid, ensure it isn't already
    // taken by a different bracket. Re-using your own guid (on a
    // re-save of your own bracket) is fine — that's the whole point.
    if (
      share_guid &&
      deps.store.isShareGuidTakenByOther(share_guid, user_id, tournament_id)
    ) {
      return reply.code(409).send({
        error: "share_guid_conflict",
        message: "That share guid is already used by another bracket.",
      });
    }

    // Filter every per-match prediction (groups + knockouts) against the
    // tournament's known kickoffs. Rejected predictions are echoed back.
    // We also load the previously-persisted bracket so the filter can
    // preserve picks the user already made before kickoff; without this
    // an autosave after kickoff would strip those picks and lose the
    // user's pre-lock correct pick (Tim 2026-06-12).
    const submitNowMs = now();
    const existingRow = deps.store.getBracketForUser(user_id, tournament_id);
    let existingBracket: Bracket | null = null;
    if (existingRow) {
      try {
        existingBracket = JSON.parse(existingRow.payload_json) as Bracket;
      } catch {
        /* corrupt row — treat as no priors and let the filter behave
         *  the same as a first submit. */
      }
    }
    const groupFiltered = filterPredictionsByKickoff(
      bracket.matchPredictions as Record<string, MatchPrediction>,
      (id) => lookup.kickoffFor(id),
      submitNowMs,
      user_id,
      existingBracket?.matchPredictions as
        | Record<string, MatchPrediction>
        | undefined,
    );
    const knockoutFiltered = filterPredictionsByKickoff(
      bracket.knockoutPredictions as Record<string, MatchPrediction>,
      (id) => lookup.kickoffFor(id),
      submitNowMs,
      user_id,
      existingBracket?.knockoutPredictions as
        | Record<string, MatchPrediction>
        | undefined,
    );
    const rejected: RejectedPrediction[] = [
      ...groupFiltered.rejected,
      ...knockoutFiltered.rejected,
    ];

    const lockedAt = now();
    const persistBracket: Bracket = {
      ...(bracket as Bracket),
      matchPredictions: groupFiltered.kept,
      knockoutPredictions: knockoutFiltered.kept,
    };
    const result = deps.store.upsertBracket({
      bracketId: bracket.bracketId,
      userId: user_id,
      tournamentId: tournament_id,
      bracket: persistBracket,
      lockedAt,
      shareGuid: share_guid ?? null,
    });

    // Verbose audit log of the submit (Tim 2026-06-12). The previous
    // logs only carried request URL + status, so when a regression
    // silently stripped match-1 predictions we had no replay material.
    // Now every full-bracket submit dumps the persisted predictions
    // map AND any rejected predictions inline. The line is structured
    // (pino default) so an ops grep can rebuild a user's bracket at
    // any point in time, and the rejected list flags any anti-tamper
    // or recovery-path action that fired. Field names line up with
    // the per_match_pick_put audit event written by picks.ts.
    req.log.info(
      {
        evt: "bracket_submit",
        user_id,
        tournament_id,
        bracket_id: result.bracketId,
        share_guid: result.shareGuid,
        created: result.created,
        locked_at: new Date(lockedAt).toISOString(),
        kept_match_count: Object.keys(groupFiltered.kept).length,
        kept_knockout_count: Object.keys(knockoutFiltered.kept).length,
        rejected_count: rejected.length,
        match_predictions: groupFiltered.kept,
        knockout_predictions: knockoutFiltered.kept,
        ...(rejected.length ? { rejected } : {}),
      },
      "bracket submitted",
    );

    const receipt: LockReceipt & {
      rejected?: RejectedPrediction[];
      share_guid: string;
    } = {
      bracket_id: result.bracketId,
      user_id,
      tournament_id,
      locked_at: new Date(lockedAt).toISOString(),
      version: bracket.version,
      share_guid: result.shareGuid,
      ...(rejected.length ? { rejected } : {}),
    };
    return reply.code(result.created ? 201 : 200).send(receipt);
  });

  app.get("/v1/bracket/me", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = resolveUserId(req);
    if (!userId) {
      return reply.code(401).send({ error: "missing_user" });
    }
    const qs = (req.query ?? {}) as Record<string, unknown>;
    const tournamentId = typeof qs.tournament_id === "string" ? qs.tournament_id : null;
    if (!tournamentId) {
      return reply.code(400).send({ error: "missing_tournament_id" });
    }
    const row = deps.store.getBracketForUser(userId, tournamentId);
    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }
    let payload: Bracket;
    try {
      payload = JSON.parse(row.payload_json) as Bracket;
    } catch {
      return reply.code(500).send({ error: "corrupt_payload" });
    }
    return {
      bracket_id: row.id,
      user_id: row.user_id,
      tournament_id: row.tournament_id,
      locked_at: new Date(row.locked_at).toISOString(),
      score_total: row.score_total,
      share_guid: row.share_guid,
      bracket: payload,
    };
  });

  // ---------- defence-in-depth check: is this match still lockable? ----------
  //
  // The client calls this just before showing the pick UI so it can surface a
  // "this match has already kicked off" message instead of letting the user
  // pick something the submit handler will reject.
  app.post(
    "/v1/predictions/:matchId/check-lockable",
    async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const params = req.params as { matchId?: string };
      const matchId = params.matchId ?? "";
      if (!matchId || matchId.length > 64) {
        return reply.code(400).send({ error: "invalid_match_id" });
      }
      const body = (req.body ?? {}) as { tournament_id?: string };
      const qs = (req.query ?? {}) as { tournament_id?: string };
      const tournamentId =
        (typeof body.tournament_id === "string" && body.tournament_id) ||
        (typeof qs.tournament_id === "string" && qs.tournament_id) ||
        "";
      if (!tournamentId) {
        return reply.code(400).send({ error: "missing_tournament_id" });
      }
      const lookup = registry.forTournament(tournamentId);
      const kickoff = lookup.kickoffFor(matchId);
      const nowMs = now();
      const { lockable, kickoff_utc } = checkLockable({
        kickoff_utc: kickoff,
        lockedAtMs: nowMs,
      });
      return reply.code(200).send({
        lockable,
        kickoff_utc,
        now: new Date(nowMs).toISOString(),
      });
    },
  );
}
