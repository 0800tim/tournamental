import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { computeSplits, isValidPeriod } from '../lib/contributors.js';
import { payoutsToWeights } from '../lib/drips-client.js';
import { requireAdmin } from './admin.js';

const CreateBody = z.object({
  period: z.string().refine(isValidPeriod, 'period must be YYYY-MM'),
  totalReceiptsUsd: z.number().positive().finite(),
});

export async function registerDistributions(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/distributions', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parsed.error.issues };
    }
    const contributors = ctx.contributors.list();
    const splits = computeSplits({
      contributors,
      totalReceiptsUsd: parsed.data.totalReceiptsUsd,
    });
    if (splits.length === 0) {
      reply.code(409);
      return {
        error: 'no_eligible_contributors',
        message:
          'no contributors with activeShares > 0 — register and allocate shares before creating distributions',
      };
    }
    const dist = ctx.distributions.create({
      period: parsed.data.period,
      totalReceiptsUsd: parsed.data.totalReceiptsUsd,
      splits,
    });
    reply.code(201).header('Cache-Control', 'no-store');
    return { distribution: dist };
  });

  app.post('/v1/distributions/:id/push', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    const id = (req.params as { id: string }).id;
    const dist = ctx.distributions.get(id);
    if (!dist) {
      reply.code(404);
      return { error: 'not_found', id };
    }
    if (dist.status === 'pushed' || dist.status === 'confirmed') {
      reply.code(409);
      return {
        error: 'already_pushed',
        status: dist.status,
        txHash: dist.txHash,
      };
    }

    // Resolve recipient eth addresses; refuse if any contributor in the splits
    // is missing an address — partial payouts are an explicit follow-up.
    const recipientPayouts: Array<{ recipient: string; payoutUsd: number }> = [];
    for (const s of dist.splits) {
      const contributor = ctx.contributors.get(s.contributorId);
      if (!contributor) {
        reply.code(409);
        return {
          error: 'contributor_missing',
          contributorId: s.contributorId,
        };
      }
      if (!contributor.ethAddress) {
        reply.code(409);
        return {
          error: 'eth_address_missing',
          contributorId: contributor.id,
          githubLogin: contributor.githubLogin,
        };
      }
      recipientPayouts.push({
        recipient: contributor.ethAddress,
        payoutUsd: s.payoutUsd,
      });
    }

    // Push splits, then push payout. Splits update is idempotent at the Drips
    // layer (it's just an overwrite), so pushing both per distribution is fine.
    const weights = payoutsToWeights(recipientPayouts);
    let txHash: string;
    try {
      const setRes = await ctx.drips.setSplits(weights);
      const payoutRes = await ctx.drips.pushPayout(dist.id, dist.totalReceiptsUsd);
      // Use the payout tx as the canonical hash for the distribution; setSplits
      // tx is an internal Drip List update that callers don't need to track.
      txHash = payoutRes.txHash;
      app.log.info(
        {
          distribution: dist.id,
          set_splits_tx: setRes.txHash,
          payout_tx: payoutRes.txHash,
          backend: ctx.drips.backend,
        },
        'drips push complete',
      );
    } catch (err) {
      reply.code(502);
      return {
        error: 'drips_backend_failed',
        message: (err as Error).message,
      };
    }

    // Stamp txHash on each split and bump status to 'pushed'.
    const splitsWithTx = dist.splits.map((s) => ({ ...s, txHash }));
    const updated = ctx.distributions.setStatus(dist.id, 'pushed', {
      txHash,
      splits: splitsWithTx,
    });
    reply.header('Cache-Control', 'no-store');
    return { distribution: updated };
  });

  app.get('/v1/distributions/:id', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    const id = (req.params as { id: string }).id;
    const dist = ctx.distributions.get(id);
    if (!dist) {
      reply.code(404);
      return { error: 'not_found', id };
    }
    reply.header('Cache-Control', 'no-store');
    return { distribution: dist };
  });
}
