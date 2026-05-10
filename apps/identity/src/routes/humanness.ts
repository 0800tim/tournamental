/**
 * Humanness routes:
 *   GET  /v1/users/:userId/humanness          — current score + breakdown
 *   POST /v1/users/:userId/recompute (admin)  — recompute & persist
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { IdentityContext } from '../context.js';
import { computeHumanness, type BehaviouralSignals } from '../lib/humanness.js';

const recomputeSchema = z.object({
  signals: z
    .object({
      cadenceConsistency: z.number().min(0).max(1).optional(),
      deviceStability: z.number().min(0).max(1).optional(),
      captchaPassRate: z.number().min(0).max(1).optional(),
      botLikelihood: z.number().min(0).max(1).optional(),
      telegramPremium: z.boolean().optional(),
      xVerified: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

function isAdmin(ctx: IdentityContext, req: FastifyRequest): boolean {
  const expected = ctx.config.adminToken;
  if (!expected) return false;
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice('Bearer '.length).trim() === expected;
}

export async function registerHumanness(
  app: FastifyInstance,
  ctx: IdentityContext,
): Promise<void> {
  app.get<{ Params: { userId: string } }>(
    '/v1/users/:userId/humanness',
    async (req, reply) => {
      const { userId } = req.params;
      let snap = ctx.storage.getScore(userId);
      if (!snap) {
        // Compute on-demand from current links so the admin customer-360
        // page never sees an empty value for a known user.
        const links = ctx.storage.listLinks(userId);
        snap = computeHumanness({ userId, links, now: ctx.now() });
        ctx.storage.saveScore(snap);
      }
      reply.header('Cache-Control', 'private, max-age=30');
      return snap;
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/v1/users/:userId/recompute',
    async (req, reply) => {
      if (!isAdmin(ctx, req)) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const parsed = recomputeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_request', details: parsed.error.flatten() };
      }
      const { userId } = req.params;
      const links = ctx.storage.listLinks(userId);
      const signals: BehaviouralSignals = parsed.data.signals ?? {};
      const snap = computeHumanness({
        userId,
        links,
        signals,
        now: ctx.now(),
      });
      ctx.storage.saveScore(snap);
      reply.header('Cache-Control', 'no-store');
      return snap;
    },
  );
}
