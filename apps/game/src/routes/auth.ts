/**
 * Tiny Bearer-token auth for admin routes.
 *
 * The token comes from `GAME_ADMIN_TOKEN` in the env. If the env var is
 * empty/unset we deliberately reject every admin request — admin routes
 * must never be open by default. Tests that need to call admin endpoints
 * pass an explicit token through the test fixture.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

export interface AdminGuardOptions {
  readonly token: string | null;
}

/**
 * SEC-BRK-04 / SEC-ADMIN-05: constant-time string compare. Returns
 * false unless both inputs are the same byte length AND every byte
 * matches. We pre-screen the length so `timingSafeEqual` (which
 * throws on length mismatch) never sees an unequal pair — the boolean
 * length check itself leaks no more than what an attacker already
 * knows from the token format. The plain `!==` previously used here
 * was a timing side channel against admin surfaces (match-result,
 * syndicate writes, tournament settle).
 */
function safeCompareToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function makeAdminGuard(opts: AdminGuardOptions) {
  return async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
    if (!opts.token) {
      return reply.code(503).send({
        error: "admin_disabled",
        message: "GAME_ADMIN_TOKEN is not configured",
      });
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_bearer" });
    }
    const presented = header.slice("Bearer ".length).trim();
    if (!safeCompareToken(presented, opts.token)) {
      return reply.code(403).send({ error: "bad_token" });
    }
  };
}

/** Convenience hook-registration helper. */
export function registerAdminGuard(
  app: FastifyInstance,
  routePrefix: string,
  opts: AdminGuardOptions,
): void {
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith(routePrefix)) {
      const guard = makeAdminGuard(opts);
      await guard(req, reply);
    }
  });
}
