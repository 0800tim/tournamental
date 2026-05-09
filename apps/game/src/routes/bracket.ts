/**
 * Bracket submission + retrieval routes.
 *
 *   POST /v1/bracket/submit
 *   GET  /v1/bracket/me
 *
 * Both routes require a `user_id` to identify the user. We accept it via
 * either an `X-User-Id` header or a `?user_id=` query param. Real auth
 * comes from the Telegram Bot (doc 13) and SMS (auth-sms) — for now this
 * service trusts the header the way the rest of the dev stack does.
 *
 * Caching: both are user-specific writes/reads, so `Cache-Control:
 * private, no-store` per CLAUDE.md.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { submitBracketBodySchema } from "../schemas.js";
import type { GameStore } from "../store/db.js";
import type { LockReceipt, Bracket } from "../types.js";

function resolveUserId(req: FastifyRequest): string | null {
  const headerUser = req.headers["x-user-id"];
  if (typeof headerUser === "string" && headerUser.length > 0) return headerUser;
  if (Array.isArray(headerUser) && headerUser[0]) return headerUser[0];
  const qs = req.query as Record<string, unknown> | undefined;
  if (qs && typeof qs.user_id === "string" && qs.user_id.length > 0) {
    return qs.user_id;
  }
  return null;
}

export interface BracketRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
}

export async function registerBracketRoutes(
  app: FastifyInstance,
  deps: BracketRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());

  app.post("/v1/bracket/submit", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
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

    const { tournament_id, user_id, bracket } = parsed.data;
    const lockedAt = now();
    const result = deps.store.upsertBracket({
      bracketId: bracket.bracketId,
      userId: user_id,
      tournamentId: tournament_id,
      bracket: bracket as Bracket,
      lockedAt,
    });

    const receipt: LockReceipt = {
      bracket_id: result.bracketId,
      user_id,
      tournament_id,
      locked_at: new Date(lockedAt).toISOString(),
      version: bracket.version,
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
      bracket: payload,
    };
  });
}
