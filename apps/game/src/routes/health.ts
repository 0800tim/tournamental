import type { FastifyInstance } from "fastify";

import type { GameStore } from "../store/db.js";

export async function registerHealth(
  app: FastifyInstance,
  store: GameStore,
): Promise<void> {
  app.get("/healthz", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const dbUp = store.isHealthy();
    return { ok: dbUp, db: dbUp ? "up" : "down" };
  });
}
