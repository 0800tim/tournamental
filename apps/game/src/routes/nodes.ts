/**
 * Federation endpoints (Phase 2 forward-compat).
 *
 *   POST /v1/nodes/register     , issue node credentials
 *   POST /v1/nodes/commit       , pre-kickoff merkle commitment
 *   POST /v1/nodes/leaderboard  , post-match aggregate report
 *
 * Auth model:
 *   - /register is gated by an owner API key (Bearer tnm_*). The
 *     owner key is the same kind a developer holds for /v1/picks/bulk.
 *     Registering a node mints a SEPARATE node credential (also
 *     tnm_-prefixed) and binds it to a node_id. The node credential
 *     never has bulk-pick rights, only commit + leaderboard rights.
 *   - /commit and /leaderboard are gated by the node credential. The
 *     auth key must own the supplied node_id; otherwise 403.
 *
 * Phase 1 ships these endpoints empty-data so external node operators
 * can wire their clients and integration-test against the central tier
 * before the Docker image goes public in Phase 2.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.2, §15.3
 */
import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { GameStore } from "../store/db.js";

const HEX_64 = /^[0-9a-f]{64}$/;

const RegisterSchema = z
  .object({
    owner_email: z.string().email().max(254),
    public_url: z.string().url().max(512),
    label: z.string().max(128).optional(),
  })
  .strict();

const CommitSchema = z
  .object({
    node_id: z.string().min(1).max(64),
    match_id: z.string().min(1).max(64),
    merkle_root: z.string().regex(HEX_64),
    bot_count: z.number().int().min(0).max(1_000_000_000_000),
    kickoff_at: z.number().int(),
  })
  .strict();

const LeaderboardReportSchema = z
  .object({
    node_id: z.string().min(1).max(64),
    match_id: z.string().min(1).max(64),
    total_bots: z.number().int().min(0).max(1_000_000_000_000),
    bots_correct: z.number().int().min(0).max(1_000_000_000_000),
    bots_still_perfect: z.number().int().min(0).max(1_000_000_000_000),
    top_1000: z
      .array(z.unknown())
      .max(1_000)
      .default([]),
  })
  .strict();

function authBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  const v = h.slice("Bearer ".length).trim();
  return v.length > 0 ? v : null;
}

function generateNodeId(): string {
  return `node_${randomBytes(8).toString("hex")}`;
}

export interface NodesRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
}

export async function registerNodesRoutes(
  app: FastifyInstance,
  deps: NodesRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());

  app.post("/v1/nodes/register", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const plain = authBearer(req);
    if (!plain) return reply.code(401).send({ error: "missing_api_key" });
    const ownerKey = deps.store.apiKeys.lookupByPlain(plain);
    if (!ownerKey) return reply.code(401).send({ error: "invalid_api_key" });

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    // Mint a fresh node credential. We reuse the api_key table so
    // every key , owner-issued or node-issued , uses the same hash
    // function and revocation surface.
    const nodeCreds = deps.store.apiKeys.issue({
      owner_email: parsed.data.owner_email,
      label: `node:${parsed.data.label ?? parsed.data.public_url}`,
    });
    const node_id = generateNodeId();
    deps.store.federatedNodes.register({
      node_id,
      owner_email: parsed.data.owner_email,
      owner_api_key_hash: nodeCreds.key_hash,
      public_url: parsed.data.public_url,
      label: parsed.data.label,
      now: now(),
    });

    return reply.code(201).send({
      node_id,
      node_key: nodeCreds.api_key,
      owner_email: parsed.data.owner_email,
      public_url: parsed.data.public_url,
      label: parsed.data.label ?? null,
      registered_at: nodeCreds.created_at,
    });
  });

  app.post("/v1/nodes/commit", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const plain = authBearer(req);
    if (!plain) return reply.code(401).send({ error: "missing_api_key" });
    const keyRow = deps.store.apiKeys.lookupByPlain(plain);
    if (!keyRow) return reply.code(401).send({ error: "invalid_api_key" });

    const parsed = CommitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    const node = deps.store.federatedNodes.getByNodeId(parsed.data.node_id);
    if (!node) return reply.code(404).send({ error: "unknown_node" });
    if (node.owner_api_key_hash !== keyRow.key_hash) {
      return reply.code(403).send({ error: "not_node_owner" });
    }

    // Pre-kickoff invariant per §15.3.1: the merkle commitment must
    // land strictly before the match's kickoff timestamp. Late commits
    // are recorded but excluded from leaderboard scoring; we surface
    // that as a 422 so client SDKs can retry-with-different-match
    // before they bother computing a leaderboard report.
    if (parsed.data.kickoff_at <= now()) {
      return reply.code(422).send({ error: "kickoff_passed" });
    }

    deps.store.federatedNodes.commit({
      node_id: parsed.data.node_id,
      match_id: parsed.data.match_id,
      merkle_root: parsed.data.merkle_root,
      kickoff_at: parsed.data.kickoff_at,
      bot_count: parsed.data.bot_count,
      now: now(),
    });
    deps.store.federatedNodes.touch(parsed.data.node_id, now());

    return reply.send({
      node_id: parsed.data.node_id,
      match_id: parsed.data.match_id,
      committed_at: now(),
    });
  });

  app.post("/v1/nodes/leaderboard", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");

    const plain = authBearer(req);
    if (!plain) return reply.code(401).send({ error: "missing_api_key" });
    const keyRow = deps.store.apiKeys.lookupByPlain(plain);
    if (!keyRow) return reply.code(401).send({ error: "invalid_api_key" });

    const parsed = LeaderboardReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_payload",
        detail: parsed.error.flatten(),
      });
    }

    const node = deps.store.federatedNodes.getByNodeId(parsed.data.node_id);
    if (!node) return reply.code(404).send({ error: "unknown_node" });
    if (node.owner_api_key_hash !== keyRow.key_hash) {
      return reply.code(403).send({ error: "not_node_owner" });
    }

    if (parsed.data.bots_correct > parsed.data.total_bots) {
      return reply.code(400).send({ error: "invariant_violation" });
    }
    if (parsed.data.bots_still_perfect > parsed.data.bots_correct) {
      return reply.code(400).send({ error: "invariant_violation" });
    }

    deps.store.federatedNodes.reportLeaderboard({
      node_id: parsed.data.node_id,
      match_id: parsed.data.match_id,
      total_bots: parsed.data.total_bots,
      bots_correct: parsed.data.bots_correct,
      bots_still_perfect: parsed.data.bots_still_perfect,
      top: parsed.data.top_1000,
      now: now(),
    });
    deps.store.federatedNodes.touch(parsed.data.node_id, now());

    return reply.send({
      node_id: parsed.data.node_id,
      match_id: parsed.data.match_id,
      received_at: now(),
    });
  });
}
