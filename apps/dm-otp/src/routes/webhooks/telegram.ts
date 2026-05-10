/**
 * Telegram inbound webhook.
 *
 * Telegram authenticates webhooks via the secret token configured at
 * setWebhook time, returned in the X-Telegram-Bot-Api-Secret-Token
 * header. We compare it constant-time to our env-configured value.
 *
 * https://core.telegram.org/bots/api#setwebhook
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { timingSafeEqual } from 'node:crypto';

interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
    from?: { id?: number };
  };
}

export async function registerTelegramWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/telegram', async (req, reply) => {
    const expected = ctx.config.telegramWebhookSecret;
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (!expected || typeof got !== 'string') {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(got, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }

    const upd = req.body as TelegramUpdate;
    const chatId = upd?.message?.chat?.id;
    const text = upd?.message?.text;
    if (chatId == null || typeof text !== 'string') {
      return reply.code(200).send({ ok: true, ignored: true });
    }

    const result = await dispatch(
      {
        store: ctx.store,
        senders: ctx.senders,
        magicLinkChannels: ctx.magicLinkChannels,
        log: ctx.log,
      },
      { channel: 'telegram', externalId: String(chatId), text },
    );
    return reply.code(200).send({ ok: result.ok });
  });
}
