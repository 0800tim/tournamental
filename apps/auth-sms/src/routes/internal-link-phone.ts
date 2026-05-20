/**
 * POST /v1/internal/telegram-link-phone — bot-only endpoint.
 *
 * The tournament-bot calls this after a user shares their contact via
 * the request_contact button. We don't trust arbitrary callers — the
 * bot proves itself with a shared secret in the Authorization header
 * (TOURNAMENTAL_INTERNAL_SECRET). Phone numbers from this endpoint are
 * trusted because Telegram itself verifies the share_contact action.
 *
 * Body:
 *   { telegramId: number, phone: string (E.164 or local) }
 *
 * Responses:
 *   200 { ok: true, outcome: "ok" | "already-linked", userId }
 *   400 { error: "bad-body" | "bad-phone" }
 *   401 { error: "unauthorized" }
 *   404 { error: "no-user" }
 *   503 { error: "not-configured" }
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { normalisePhone } from '../phone.js';

const BodySchema = z.object({
  telegramId: z.number().int().positive(),
  phone: z.string().min(5).max(32),
});

export async function registerInternalLinkPhone(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/internal/telegram-link-phone', async (req, reply) => {
    const secret = process.env.TOURNAMENTAL_INTERNAL_SECRET ?? '';
    if (!secret) {
      return reply.code(503).send({ error: 'not-configured' });
    }
    const auth = req.headers.authorization ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (presented !== secret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-body' });

    const phoneE164 = normalisePhone(parsed.data.phone);
    if (!phoneE164) return reply.code(400).send({ error: 'bad-phone' });

    const nowSeconds = Math.floor(ctx.now() / 1000);
    const outcome = ctx.storage.linkPhoneToTelegramUser({
      telegramId: parsed.data.telegramId,
      phone: phoneE164,
      now: nowSeconds,
    });

    if (outcome === 'no-user') {
      return reply.code(404).send({ error: 'no-user' });
    }

    ctx.log.info(
      { telegramId: parsed.data.telegramId, outcome },
      'auth: bot phone-link',
    );
    return reply.code(200).send({ ok: true, outcome });
  });
}
