/**
 * Subscription endpoints.
 *
 * Every endpoint validates a `consent: true` flag. We refuse to register a
 * subscription without affirmative consent — even in dev. The same check
 * lives in the request schemas via Zod's literal type so wrong values
 * surface as 400 with a useful message.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SubscriptionStore } from '../lib/subscriptions.js';
import type { AuditLogger } from '../lib/audit.js';

const consentSchema = z.literal(true, {
  errorMap: () => ({
    message: 'consent must be the boolean true',
  }),
});

const webPushBody = z.object({
  userId: z.string().min(1).max(128),
  consent: consentSchema,
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

const telegramBody = z.object({
  userId: z.string().min(1).max(128),
  consent: consentSchema,
  telegramUserId: z.string().min(1).max(128),
});

const smsBody = z.object({
  userId: z.string().min(1).max(128),
  consent: consentSchema,
  phone: z
    .string()
    .min(6)
    .max(20)
    .regex(/^\+?[0-9 ()-]+$/, 'phone must look like an E.164 number'),
});

interface RouteCtx {
  store: SubscriptionStore;
  audit: AuditLogger;
}

export async function registerSubscribeRoutes(
  app: FastifyInstance,
  ctx: RouteCtx,
): Promise<void> {
  app.post('/v1/subscribe/web-push', async (req, reply) => {
    const parse = webPushBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { userId, subscription } = parse.data;
    await ctx.store.upsertWebPush(userId, subscription);
    await ctx.audit.append({
      channel: 'web-push',
      userId,
      event: 'subscribe',
      payload: { endpoint: subscription.endpoint },
      ok: true,
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/v1/subscribe/telegram', async (req, reply) => {
    const parse = telegramBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { userId, telegramUserId } = parse.data;
    await ctx.store.upsertTelegram(userId, telegramUserId);
    await ctx.audit.append({
      channel: 'telegram',
      userId,
      event: 'subscribe',
      payload: { telegramUserId },
      ok: true,
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/v1/subscribe/sms', async (req, reply) => {
    const parse = smsBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({
        ok: false,
        error: 'invalid_body',
        details: parse.error.issues,
      });
    }
    const { userId, phone } = parse.data;
    await ctx.store.upsertSms(userId, phone);
    await ctx.audit.append({
      channel: 'sms',
      userId,
      event: 'subscribe',
      payload: { phone: phone.startsWith('+') ? phone : `+${phone}` },
      ok: true,
    });
    return reply.code(201).send({ ok: true });
  });
}
