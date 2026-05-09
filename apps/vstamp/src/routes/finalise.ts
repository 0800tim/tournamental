/**
 * POST /v1/vstamp/finalise/:tournament_id
 *
 * Closes the day's tree, computes the Merkle root, signs it, and writes the
 * root row. Idempotent: a second call for the same (tournament, day) returns
 * the existing root without re-signing.
 *
 * Auth: requires the bearer token in `Authorization: Bearer <VSTAMP_ADMIN_TOKEN>`.
 * Constant-time comparison; missing/empty token rejects.
 *
 * Phase 2 (out of scope here, see docs/21): also broadcast the signed root
 * to a testnet smart contract.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dayBucketFor, finaliseLeaves, rootSigningMessage } from '../lib/receipts.js';
import { safeCompare } from '../lib/keys.js';
import { bytesToHex } from '../lib/merkle.js';
import type { Context } from '../context.js';

const FinaliseBody = z
  .object({
    day_bucket: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .optional();

export function requireAdmin(ctx: Context, req: FastifyRequest, reply: FastifyReply): boolean {
  if (!ctx.adminToken) {
    reply.code(503);
    reply.send({ error: 'admin_disabled', message: 'VSTAMP_ADMIN_TOKEN is not configured' });
    return false;
  }
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !safeCompare(match[1], ctx.adminToken)) {
    reply.code(401);
    reply.send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export async function registerFinalise(app: FastifyInstance, ctx: Context) {
  app.post<{
    Params: { tournament_id: string };
    Body: z.infer<typeof FinaliseBody>;
  }>('/v1/vstamp/finalise/:tournament_id', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;

    const tournamentId = req.params.tournament_id;
    if (!tournamentId || tournamentId.length > 128) {
      reply.code(400);
      return { error: 'invalid_tournament_id' };
    }

    const parsed = FinaliseBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }
    const dayBucket = parsed.data?.day_bucket ?? dayBucketFor(Date.now());

    const existing = ctx.db.getRoot(tournamentId, dayBucket);
    if (existing) {
      reply.header('Cache-Control', 'no-store');
      return {
        tournament_id: tournamentId,
        day_bucket: dayBucket,
        root_hash: existing.root_hash,
        signature: existing.sig,
        pubkey: existing.pubkey,
        finalised_at: existing.finalised_at,
        leaf_count: existing.leaf_count,
        already_finalised: true,
      };
    }

    const leaves = ctx.db.getLeavesForBucket(tournamentId, dayBucket);
    if (leaves.length === 0) {
      reply.code(409);
      return { error: 'empty_bucket', tournament_id: tournamentId, day_bucket: dayBucket };
    }

    const finalised = finaliseLeaves({ leafHashes: leaves.map((l) => l.leaf_hash) });
    const sig = ctx.signer.sign(rootSigningMessage(finalised.rootHex));

    const row = {
      tournament_id: tournamentId,
      day_bucket: dayBucket,
      root_hash: finalised.rootHex,
      sig: bytesToHex(sig),
      pubkey: ctx.signer.pubkeyHex,
      finalised_at: Date.now(),
      leaf_count: finalised.leafCount,
    };
    ctx.db.insertRoot(row);

    reply.header('Cache-Control', 'no-store');
    return {
      tournament_id: tournamentId,
      day_bucket: dayBucket,
      root_hash: row.root_hash,
      signature: row.sig,
      pubkey: row.pubkey,
      finalised_at: row.finalised_at,
      leaf_count: row.leaf_count,
      already_finalised: false,
    };
  });
}
