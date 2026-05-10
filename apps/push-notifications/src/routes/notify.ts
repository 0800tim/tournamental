/**
 * Notification fan-out endpoints.
 *
 * These are intentionally trust-on-first-use: any caller with network
 * access can post a kickoff/result/leaderboard event. In production we'd
 * gate them behind a shared internal secret (PUSH_INTERNAL_SECRET) so only
 * the Game service and scheduler can trigger sends. v0.1 supports the
 * secret-header check but treats it as optional.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SubscriptionStore } from '../lib/subscriptions.js';
import { Dispatcher } from '../lib/dispatcher.js';

const kickoffBody = z.object({
  matchId: z.string().min(1).max(64),
  minutesUntil: z.number().int().min(0).max(60 * 24),
});

const matchResultBody = z.object({
  matchId: z.string().min(1).max(64),
  scoreboard: z.string().max(64).optional(),
  /** Actual outcome, used to settle picks. */
  outcome: z.enum(['home_win', 'draw', 'away_win']),
  /** Points to award winners. Defaults to 1 if not provided. */
  pointsForWin: z.number().int().min(0).max(10_000).optional(),
});

const leaderboardBody = z.object({
  userId: z.string().min(1).max(128),
  fromRank: z.number().int().min(1),
  toRank: z.number().int().min(1),
  tournamentId: z.string().min(1).max(64),
});

interface RouteCtx {
  store: SubscriptionStore;
  dispatcher: Dispatcher;
  /** Shared secret. If set, requests must include matching `x-push-secret`. */
  internalSecret?: string;
}

export async function registerNotifyRoutes(
  app: FastifyInstance,
  ctx: RouteCtx,
): Promise<void> {
  function checkSecret(req: import('fastify').FastifyRequest): true | string {
    if (!ctx.internalSecret) return true;
    const got = req.headers['x-push-secret'];
    if (typeof got === 'string' && got === ctx.internalSecret) return true;
    return 'invalid_secret';
  }

  app.post('/v1/notify/kickoff_soon', async (req, reply) => {
    const sec = checkSecret(req);
    if (sec !== true) return reply.code(401).send({ ok: false, error: sec });
    const parse = kickoffBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { matchId, minutesUntil } = parse.data;
    const picks = ctx.store.picksForMatch(matchId);
    const content = Dispatcher.renderKickoff(matchId, minutesUntil);
    const fanouts = await Promise.all(
      picks.map((p) => ctx.dispatcher.fanOut(p.userId, 'kickoff_soon', content)),
    );
    return reply.send({ ok: true, recipients: fanouts.length, fanouts });
  });

  app.post('/v1/notify/match_result', async (req, reply) => {
    const sec = checkSecret(req);
    if (sec !== true) return reply.code(401).send({ ok: false, error: sec });
    const parse = matchResultBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { matchId, scoreboard, outcome, pointsForWin } = parse.data;
    const points = pointsForWin ?? 1;
    const picks = ctx.store.picksForMatch(matchId);
    const fanouts = await Promise.all(
      picks.map((p) => {
        if (p.outcome === outcome) {
          const content = Dispatcher.renderMatchResultWin(
            matchId,
            points,
            scoreboard,
          );
          return ctx.dispatcher.fanOut(p.userId, 'match_result', content);
        }
        const content = Dispatcher.renderMatchResultLoss(matchId, scoreboard);
        return ctx.dispatcher.fanOut(p.userId, 'match_result', content);
      }),
    );
    return reply.send({
      ok: true,
      recipients: fanouts.length,
      winners: picks.filter((p) => p.outcome === outcome).length,
      fanouts,
    });
  });

  app.post('/v1/notify/leaderboard_move', async (req, reply) => {
    const sec = checkSecret(req);
    if (sec !== true) return reply.code(401).send({ ok: false, error: sec });
    const parse = leaderboardBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { userId, fromRank, toRank, tournamentId } = parse.data;
    // Threshold rule per spec: only fire if rank improved by >= 5 places.
    const delta = fromRank - toRank;
    if (delta < 5) {
      return reply.send({
        ok: true,
        skipped: true,
        reason: 'delta_below_threshold',
        delta,
      });
    }
    const content = Dispatcher.renderLeaderboardMove(
      fromRank,
      toRank,
      tournamentId,
    );
    const result = await ctx.dispatcher.fanOut(
      userId,
      'leaderboard_move',
      content,
    );
    return reply.send({ ok: true, fanout: result });
  });

  // Internal helper: record a pick. Until the Game service exists, this
  // is the only way to seed who picked what.
  const pickBody = z.object({
    matchId: z.string().min(1).max(64),
    userId: z.string().min(1).max(128),
    outcome: z.enum(['home_win', 'draw', 'away_win']),
  });
  app.post('/v1/picks/record', async (req, reply) => {
    const sec = checkSecret(req);
    if (sec !== true) return reply.code(401).send({ ok: false, error: sec });
    const parse = pickBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { matchId, userId, outcome } = parse.data;
    await ctx.store.recordPick(matchId, userId, outcome);
    return reply.code(201).send({ ok: true });
  });
}
