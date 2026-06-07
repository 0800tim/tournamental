import Fastify, { type FastifyInstance } from "fastify";

import { merkleProof } from "./merkle.js";
import { pickLeaf } from "./scheduler.js";
import type { Storage } from "./storage.js";

export interface ServerOptions {
  storage: Storage;
  port?: number;
  host?: string;
  /** Operator label surfaced on /stats. */
  node_label?: string;
}

export interface CreatedServer {
  app: FastifyInstance;
  start: () => Promise<string>;
  stop: () => Promise<void>;
}

export function createServer(opts: ServerOptions): CreatedServer {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const storage = opts.storage;

  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  app.get("/stats", async () => {
    const creds = storage.loadCredentials();
    const bots = storage.countBots();
    const commitRows = storage.db
      .prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM commit_log")
      .get();
    const scoredRows = storage.db
      .prepare<
        [],
        { c: number }
      >(
        "SELECT COUNT(*) AS c FROM match_result WHERE scored_at_utc IS NOT NULL",
      )
      .get();
    const stillPerfect = storage.countBotsStillPerfect();
    return {
      node_id: creds?.node_id ?? null,
      label: opts.node_label ?? null,
      registered: creds !== null,
      bots,
      commits: commitRows?.c ?? 0,
      matches_scored: scoredRows?.c ?? 0,
      bots_still_perfect: stillPerfect,
    };
  });

  app.get<{ Params: { match_id: string; bot_id: string } }>(
    "/v1/proof/:match_id/:bot_id",
    async (req, reply) => {
      const { match_id, bot_id } = req.params;
      const picks = storage.listPicksForMatch(match_id);
      if (picks.length === 0) {
        return reply.code(404).send({ error: "match_not_committed" });
      }
      const idx = picks.findIndex((p) => p.bot_id === bot_id);
      if (idx === -1) {
        return reply.code(404).send({ error: "bot_not_found_in_match" });
      }
      const leaves = picks.map((p) =>
        pickLeaf(
          p.bot_id,
          p.match_id,
          p.outcome,
          p.chalk_score,
          p.locked_at_utc,
        ),
      );
      const proof = merkleProof(leaves, idx);
      const commit = storage.db
        .prepare<
          [string],
          { merkle_root: string; bot_count: number; committed_at_utc: number }
        >(
          "SELECT merkle_root, bot_count, committed_at_utc FROM commit_log WHERE match_id = ?",
        )
        .get(match_id);
      return {
        match_id,
        bot_id,
        pick: picks[idx]!,
        proof,
        commit,
      };
    },
  );

  return {
    app,
    start: async () => {
      const port = opts.port ?? Number(process.env.PORT ?? 4080);
      const host = opts.host ?? process.env.HOST ?? "0.0.0.0";
      return app.listen({ port, host });
    },
    stop: async () => {
      await app.close();
    },
  };
}
