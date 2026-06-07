import Fastify, { type FastifyInstance } from "fastify";

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

/**
 * Status server for the bot node.
 *
 * v0.3.0 (Tim 2026-06-08): per-bot proof endpoint removed.
 *
 * The v0.2.0 server exposed /v1/proof/:match_id/:bot_id which
 * walked the bot_pick table and built a merkle inclusion proof for
 * a single bot. v0.3.0 no longer stores picks; a proof for any bot
 * is regeneratable on demand from the bot index by anyone holding
 * the swarm's master_seed + bot count + the match catalogue. The
 * tournamental-bot-node CLI gains a `proof <swarm_run_seed>
 * <bot_index> <match_id>` subcommand for that (added in cli.ts).
 */
export function createServer(opts: ServerOptions): CreatedServer {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const storage = opts.storage;

  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  app.get("/stats", async () => {
    const creds = storage.loadCredentials();
    const bots = storage.countBots();
    const swarms = storage.listSwarmRuns();
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
    // Still-perfect: take the latest per-swarm match_score_summary
    // row and sum bots_still_perfect across swarms. Pre-kickoff this
    // is zero (no matches scored); after each match it ticks down.
    const perfectRows = storage.db
      .prepare<
        [],
        { c: number }
      >(
        `SELECT COALESCE(SUM(bots_still_perfect), 0) AS c
           FROM match_score_summary s
           WHERE s.scored_at_utc = (
             SELECT MAX(scored_at_utc) FROM match_score_summary
             WHERE run_seed = s.run_seed AND strategy = s.strategy
           )`,
      )
      .get();
    return {
      node_id: creds?.node_id ?? null,
      label: opts.node_label ?? null,
      registered: creds !== null,
      bots,
      swarms: swarms.length,
      swarm_breakdown: swarms.map((s) => ({
        run_seed_prefix: s.run_seed.slice(0, 12),
        strategy: s.strategy,
        total_bots: s.total_bots,
        committed_matches: Object.keys(s.per_match_roots).length,
      })),
      commits: commitRows?.c ?? 0,
      matches_scored: scoredRows?.c ?? 0,
      bots_still_perfect: perfectRows?.c ?? 0,
    };
  });

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
