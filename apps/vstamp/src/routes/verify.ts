/**
 * POST /v1/vstamp/verify
 *
 * Pure stateless verification. Clients that don't want to implement Merkle
 * + Ed25519 themselves can call this. The server holds no opinion about
 * whether the (root, signature) pair was actually issued by us — it only
 * checks the maths.
 *
 * For the strongest guarantee, a client should compare the returned
 * `pubkey` against a known good value (e.g. one fetched from a CDN-pinned
 * `/v1/vstamp/keys` endpoint, future work) before trusting the output.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeRootFromProof, hexToBytes, constantTimeEqual } from '../lib/merkle.js';
import { verifyHex } from '../lib/keys.js';
import { rootSigningMessage } from '../lib/receipts.js';

const ProofStepSchema = z.object({
  sibling: z.string().regex(/^[0-9a-fA-F]{64}$/),
  position: z.enum(['left', 'right']),
});

const VerifyBody = z.object({
  leaf_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  proof: z.array(ProofStepSchema).max(64), // 64 levels => 2^64 leaves; absurd upper bound
  claimed_root: z.string().regex(/^[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
  pubkey: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export async function registerVerify(app: FastifyInstance) {
  app.post('/v1/vstamp/verify', async (req, reply) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { valid: false, reason: 'invalid_request', details: parsed.error.flatten() };
    }

    const { leaf_hash, proof, claimed_root, signature, pubkey } = parsed.data;

    let computed: Uint8Array;
    try {
      computed = computeRootFromProof(leaf_hash.toLowerCase(), proof);
    } catch (err) {
      reply.header('Cache-Control', 'no-store');
      return { valid: false, reason: 'proof_malformed', message: (err as Error).message };
    }

    const expected = hexToBytes(claimed_root);
    if (!constantTimeEqual(computed, expected)) {
      reply.header('Cache-Control', 'no-store');
      return { valid: false, reason: 'root_mismatch' };
    }

    if (!verifyHex(pubkey, rootSigningMessage(claimed_root), signature)) {
      reply.header('Cache-Control', 'no-store');
      return { valid: false, reason: 'signature_invalid' };
    }

    reply.header('Cache-Control', 'no-store');
    return { valid: true };
  });
}
