/**
 * Syndicate-membership write routes (admin-only).
 *
 *   POST /v1/syndicate/join
 *
 * In production, syndicate membership flows through the Telegram Bot
 * (doc 13) and the auth-sms service. This service exposes a thin admin
 * write so the bot — or an integration test — can register memberships
 * without round-tripping through bot infra. Reads are still served by
 * `/v1/leaderboard/:tournament_id/syndicate/:syndicate_id`.
 */

import type { FastifyInstance } from "fastify";

import { syndicateJoinBodySchema } from "../schemas.js";
import type { GameStore } from "../store/db.js";
import { makeAdminGuard } from "./auth.js";

export interface SyndicateRoutesDeps {
  readonly store: GameStore;
  readonly adminToken: string | null;
}

export async function registerSyndicateRoutes(
  app: FastifyInstance,
  deps: SyndicateRoutesDeps,
): Promise<void> {
  const guard = makeAdminGuard({ token: deps.adminToken });

  app.post("/v1/syndicate/join", { preHandler: guard }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = syndicateJoinBodySchema.safeParse(req.body);
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
    const { user_id, syndicate_id } = parsed.data;
    deps.store.addSyndicateMember(user_id, syndicate_id);
    return reply.code(200).send({ ok: true, user_id, syndicate_id });
  });
}
