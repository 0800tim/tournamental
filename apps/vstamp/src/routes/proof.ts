/**
 * GET /v1/vstamp/proof/:leaf_hash
 *
 * Returns the inclusion proof for a finalised leaf. Includes the signed root
 * and a verification recipe so a client (or any independent verifier) can:
 *   1. Recompute the root from (leaf_hash, proof).
 *   2. Verify the Ed25519 signature over the recomputed root using the
 *      attached public key.
 *
 * If the leaf exists but its bucket has not been finalised yet, the response
 * is 202 Accepted with `{ proof_pending: true }` so the client can poll.
 */

import type { FastifyInstance } from 'fastify';
import { finaliseLeaves } from '../lib/receipts.js';
import type { Context } from '../context.js';

export const VERIFICATION_RECIPE = {
  hash: 'sha256',
  curve: 'ed25519',
  leaf_prefix: '0x00',
  node_prefix: '0x01',
  // Verifier algorithm in plain language. Clients with a reference impl
  // (`/v1/vstamp/verify`) can ignore this; clients that re-implement should
  // follow it byte-for-byte.
  algorithm: [
    'acc = hexToBytes(leaf_hash)',
    'for each step in proof:',
    "  if step.position === 'left':  acc = sha256(0x01 || hexToBytes(step.sibling) || acc)",
    "  if step.position === 'right': acc = sha256(0x01 || acc || hexToBytes(step.sibling))",
    'assert constant_time_equal(acc, hexToBytes(claimed_root))',
    'assert ed25519.verify(signature, hexToBytes(claimed_root), pubkey)',
  ],
} as const;

export async function registerProof(app: FastifyInstance, ctx: Context) {
  app.get<{ Params: { leaf_hash: string } }>(
    '/v1/vstamp/proof/:leaf_hash',
    async (req, reply) => {
      const leafHash = req.params.leaf_hash;
      if (!/^[0-9a-fA-F]{64}$/.test(leafHash)) {
        reply.code(400);
        return { error: 'invalid_leaf_hash' };
      }
      const leafLower = leafHash.toLowerCase();

      const leaf = ctx.db.getLeafByHash(leafLower);
      if (!leaf) {
        reply.code(404);
        return { error: 'leaf_not_found' };
      }

      const root = ctx.db.getRootContainingLeaf(leafLower);
      if (!root) {
        reply.code(202);
        return {
          leaf_hash: leafLower,
          tournament_id: leaf.tournament_id,
          day_bucket: leaf.day_bucket,
          proof_pending: true,
        };
      }

      const leaves = ctx.db.getLeavesForBucket(leaf.tournament_id, leaf.day_bucket);
      const finalised = finaliseLeaves({ leafHashes: leaves.map((l) => l.leaf_hash) });
      const proof = finalised.proofs.get(leafLower);
      if (!proof) {
        reply.code(500);
        return { error: 'proof_inconsistent' };
      }

      // Once a tree is sealed the proof never changes; safe to cache aggressively
      // at the edge. Use a high s-maxage with SWR per docs/22.
      reply.header(
        'Cache-Control',
        'public, max-age=60, s-maxage=86400, stale-while-revalidate=604800',
      );
      return {
        leaf_hash: leafLower,
        tournament_id: leaf.tournament_id,
        day_bucket: leaf.day_bucket,
        proof,
        root_hash: root.root_hash,
        signature: root.sig,
        pubkey: root.pubkey,
        finalised_at: root.finalised_at,
        leaf_count: root.leaf_count,
        verification: VERIFICATION_RECIPE,
      };
    },
  );
}
