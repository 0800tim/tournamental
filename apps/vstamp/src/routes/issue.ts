/**
 * POST /v1/vstamp/issue
 *
 * Adds a leaf to the active tournament tree. Returns the leaf hash, the
 * per-receipt salt (which the client must store — without it the receipt is
 * not verifiable), and the day-bucket the leaf was binned into.
 *
 * The bracket payload itself is NOT persisted server-side: only its hash.
 * That keeps the privacy story simple — VTourn cannot reveal a user's
 * pre-lock prediction even under subpoena because we never have it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildIssue } from '../lib/receipts.js';
import type { Context } from '../context.js';

const IssueBody = z.object({
  bracket_canonical_json: z.unknown(),
  user_id: z.string().min(1).max(256),
  tournament_id: z.string().min(1).max(128),
});

export async function registerIssue(app: FastifyInstance, ctx: Context) {
  app.post('/v1/vstamp/issue', async (req, reply) => {
    const parsed = IssueBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }

    const { bracket_canonical_json, user_id, tournament_id } = parsed.data;

    let issued;
    try {
      issued = buildIssue({
        bracketCanonicalJson: bracket_canonical_json,
        userId: user_id,
        tournamentId: tournament_id,
      });
    } catch (err) {
      reply.code(400);
      return { error: 'invalid_bracket', message: (err as Error).message };
    }

    // Check whether an existing finalised root would already cover this bucket;
    // if so we reject the issue so we don't end up with leaves that can never
    // be proved (their tree is sealed).
    const existingRoot = ctx.db.getRoot(tournament_id, issued.dayBucket);
    if (existingRoot) {
      reply.code(409);
      return {
        error: 'bucket_already_finalised',
        tournament_id,
        day_bucket: issued.dayBucket,
      };
    }

    const inserted = ctx.db.insertLeaf({
      leaf_hash: issued.leafHash,
      tournament_id,
      user_id_hash: issued.userIdHash,
      locked_at: issued.lockedAt,
      day_bucket: issued.dayBucket,
    });

    if (!inserted) {
      // Collision is essentially impossible (256-bit secret salt) but we
      // still handle it: the caller should retry with a fresh salt.
      reply.code(409);
      return { error: 'leaf_collision', message: 'leaf already exists; retry' };
    }

    reply.header('Cache-Control', 'no-store');
    return {
      leaf_hash: issued.leafHash,
      salt: issued.salt,
      locked_at: issued.lockedAt,
      day_bucket: issued.dayBucket,
      tournament_id,
      proof_pending: true,
    };
  });
}
