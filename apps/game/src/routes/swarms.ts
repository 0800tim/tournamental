/**
 * Operator-keyed swarm-summary endpoints.
 *
 *   POST /v1/swarms/:operator_id/summary , publish (idempotent) summary
 *   GET  /v1/swarms/:operator_id          , latest summary (edge-cached)
 *   GET  /v1/swarms                       , global top-100 operators
 *
 * Auth model:
 *   POST is gated by a Bearer api_key (the same tnm_-prefixed key
 *   minted by /v1/bots/keys/issue). The operator_id MUST equal the
 *   sha256 hash of that key , i.e. the operator_id IS the api_key_hash.
 *   This is per the A13 brief ("the operator_id IS the api_key_hash for
 *   simplicity"). It avoids inventing a second identity column while
 *   still letting the GET side serve the hash without revealing the
 *   plaintext key.
 *
 *   GET is fully public so Cloudflare's edge cache serves repeat hits
 *   without touching the origin.
 *
 * Edge caching (per CLAUDE.md docs/22):
 *   - GET /v1/swarms/<id>: public, s-maxage=60, stale-while-revalidate=300
 *   - GET /v1/swarms:     public, s-maxage=60, stale-while-revalidate=300
 *   - POST: private, no-store
 *
 * ETag: hash(operator_id, latest generated_at) , cheap revalidation
 * for clients that just want to know if the summary moved on.
 *
 * Spec: A13 task brief.
 */
import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";
import { runPerfectTrackWatch } from "../services/perfect-track-watch.js";

const HEX_64 = /^[0-9a-f]{64}$/;
// operator_id is the api_key_hash (sha256 hex). 64 lower-hex chars.
const OPERATOR_ID_RE = /^[0-9a-f]{64}$/;
// bot_id reuses the same shape as the picks-bulk schema.
const BOT_ID_MAX = 128;

const MAX_TOP_K = 1_000;
const MAX_ALIVE_ROWS = 200;
// Operators routinely cross a billion bots (the billion-bot container
// alone commits 1B+ in a session), so the publish cap sits at a trillion.
// Aggregate reads SUM these across operators; a trillion-per-row ceiling
// keeps even thousands of operators inside JS's safe-integer range.
const MAX_TOTAL_BOTS = 1_000_000_000_000;

const AliveAfterMatchSchema = z
  .object({
    n: z.number().int().min(1).max(1_000),
    alive_count: z.number().int().min(0).max(MAX_TOTAL_BOTS),
  })
  .strict();

const TopKEntrySchema = z
  .object({
    bot_id: z.string().min(1).max(BOT_ID_MAX),
    score: z.number().int().min(0).max(1_000),
    chalk_score: z.number().finite(),
  })
  .strict();

const SummaryBodySchema = z
  .object({
    total_bots: z.number().int().min(0).max(MAX_TOTAL_BOTS),
    bots_alive_after_match_n: z.array(AliveAfterMatchSchema).max(MAX_ALIVE_ROWS),
    best_bot_score: z.number().int().min(0).max(1_000),
    top_k: z.array(TopKEntrySchema).max(MAX_TOP_K),
    merkle_root: z.string().regex(HEX_64),
    kickoff_at: z.number().int(),
    generated_at: z.number().int(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    limit: z
      .union([z.string(), z.number()])
      .transform((v) => Number(v))
      .pipe(z.number().int().min(1).max(1000))
      .optional(),
  })
  .strict();

function authBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const v = h.slice("Bearer ".length).trim();
  return v.length > 0 ? v : null;
}

function buildEtag(operator_id: string, generated_at: number): string {
  return `"${createHash("sha256")
    .update(`${operator_id}:${generated_at}`)
    .digest("hex")
    .slice(0, 16)}"`;
}

export interface SwarmsRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /**
   * When true, after a successful summary insert run the perfect-track
   * watcher inline so the home-page badge refreshes immediately.
   * Defaults to true; tests can disable for isolation.
   */
  readonly runPerfectTrackOnPost?: boolean;
}

export async function registerSwarmsRoutes(
  app: FastifyInstance,
  deps: SwarmsRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  const runWatch = deps.runPerfectTrackOnPost ?? true;

  // POST /v1/swarms/:operator_id/summary
  app.post("/v1/swarms/:operator_id/summary", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const params = req.params as { operator_id?: string };
    const operatorId = (params.operator_id ?? "").toLowerCase();
    if (!OPERATOR_ID_RE.test(operatorId)) {
      return reply.code(400).send({ error: "invalid_operator_id" });
    }

    const plain = authBearer(req);
    if (!plain) {
      return reply.code(401).send({ error: "missing_api_key" });
    }
    const keyRow = deps.store.apiKeys.lookupByPlain(plain);
    if (!keyRow) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }
    // Authorise: the operator_id MUST equal the api_key_hash of the
    // bearer key. Mismatch = 403 so a leaked key cannot be used to
    // post under someone else's operator identity.
    if (keyRow.key_hash !== operatorId) {
      return reply.code(403).send({ error: "not_operator" });
    }

    const parsed = SummaryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    const inserted = deps.store.swarmSummaries.upsert({
      operator_id: operatorId,
      kickoff_at: parsed.data.kickoff_at,
      total_bots: parsed.data.total_bots,
      bots_alive_after_match_n: parsed.data.bots_alive_after_match_n,
      best_bot_score: parsed.data.best_bot_score,
      top_k: parsed.data.top_k,
      merkle_root: parsed.data.merkle_root,
      generated_at: parsed.data.generated_at,
    });

    // Surface a fresh perfect-track signal if this summary crossed
    // the match-80 threshold. We run inline so the leaderboard badge
    // updates without waiting for the next scoring tick.
    if (runWatch) {
      try {
        runPerfectTrackWatch({
          store: deps.store,
          now: now(),
        });
      } catch {
        // Watcher failures must never block a summary publish.
      }
    }

    return reply.code(201).send({
      operator_id: inserted.operator_id,
      kickoff_at: inserted.kickoff_at,
      total_bots: inserted.total_bots,
      best_bot_score: inserted.best_bot_score,
      merkle_root: inserted.merkle_root,
      generated_at: inserted.generated_at,
    });
  });

  // GET /v1/swarms/:operator_id
  app.get("/v1/swarms/:operator_id", async (req, reply) => {
    const params = req.params as { operator_id?: string };
    const operatorId = (params.operator_id ?? "").toLowerCase();
    if (!OPERATOR_ID_RE.test(operatorId)) {
      return reply.code(400).send({ error: "invalid_operator_id" });
    }

    const row = deps.store.swarmSummaries.getLatestForOperator(operatorId);
    if (!row) {
      // Still set edge cache so probes don't hammer the origin.
      reply.header(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      return reply.code(404).send({ error: "not_found" });
    }

    const etag = buildEtag(row.operator_id, row.generated_at);
    const ifNoneMatch = req.headers["if-none-match"];
    if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
      reply.header(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      reply.header("ETag", etag);
      return reply.code(304).send();
    }

    reply.header(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    reply.header("Content-Type", "application/json");
    reply.header("ETag", etag);
    return reply.send(deps.store.swarmSummaries.parse(row));
  });

  // GET /v1/swarms , global aggregate leaderboard.
  app.get("/v1/swarms", async (req, reply) => {
    const parsedQuery = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_query",
        detail: parsedQuery.error.flatten(),
      });
    }
    const limit = parsedQuery.data.limit ?? 100;
    const rows = deps.store.swarmSummaries.topOperators(limit);
    reply.header(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    return {
      operators: rows.map((r) => ({
        operator_id: r.operator_id,
        total_bots: r.total_bots,
        best_bot_score: r.best_bot_score,
        merkle_root: r.merkle_root,
        generated_at: r.generated_at,
        kickoff_at: r.kickoff_at,
      })),
    };
  });
}
