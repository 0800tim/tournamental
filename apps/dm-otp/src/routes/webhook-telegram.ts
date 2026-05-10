/**
 * POST /v1/webhooks/telegram
 *
 * Telegram doesn't HMAC-sign payloads; instead, when we register the
 * webhook we pass `secret_token`, and Telegram echoes it back on every
 * request via `X-Telegram-Bot-Api-Secret-Token`. Constant-time compare.
 *
 * Inbound shape (relevant fields only):
 *   {
 *     update_id: number,
 *     message?: {
 *       chat: { id: number, type: "private" | "group" | ... },
 *       from?: { id, username, first_name, last_name },
 *       text?: string
 *     }
 *   }
 *
 * We only act on private-chat messages whose text matches the login
 * trigger. Everything else is acked with 200 (so Telegram doesn't retry).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { isLoginTrigger, tryIssueOtp } from '../issue.js';
import { verifyTelegramSecret } from '../lib/signatures.js';
import { maskExternalId } from '../audit.js';

const UpdateSchema = z.object({
  update_id: z.number().optional(),
  message: z
    .object({
      chat: z.object({
        id: z.union([z.number(), z.string()]),
        type: z.string().optional(),
      }),
      from: z
        .object({
          id: z.union([z.number(), z.string()]).optional(),
          username: z.string().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
        })
        .optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export async function registerTelegramWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/webhooks/telegram', async (req, reply) => {
    const supplied = req.headers['x-telegram-bot-api-secret-token'];
    const headerVal = Array.isArray(supplied) ? supplied[0] : supplied;
    if (
      !verifyTelegramSecret({
        header: headerVal,
        expected: ctx.config.telegramWebhookSecret,
      })
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(200).send({ ok: true, ignored: 'bad-body' });
    }

    const msg = parsed.data.message;
    if (!msg || !msg.text || !isLoginTrigger(msg.text)) {
      return reply.code(200).send({ ok: true, ignored: 'no-trigger' });
    }
    if (msg.chat.type && msg.chat.type !== 'private') {
      return reply.code(200).send({ ok: true, ignored: 'not-private' });
    }

    const externalId = String(msg.chat.id);
    const displayName =
      [msg.from?.first_name, msg.from?.last_name]
        .filter((s): s is string => Boolean(s))
        .join(' ') || undefined;

    const result = await tryIssueOtp({
      store: ctx.store,
      reply: ctx.replies.telegram,
      audit: ctx.audit,
      channel: 'telegram',
      externalId,
      profile: {
        displayName,
        username: msg.from?.username,
      },
      productName: ctx.config.productName,
    });

    if (!result.ok) {
      ctx.log.warn(
        {
          channel: 'telegram',
          externalIdMask: maskExternalId(externalId),
          errorCode: result.errorCode,
        },
        'dm-otp: issue failed',
      );
      // Still 200 so Telegram doesn't retry; the user simply doesn't
      // get a code and can resend "log in".
      return reply.code(200).send({ ok: false, error: result.errorCode });
    }

    ctx.log.info(
      {
        channel: 'telegram',
        externalIdMask: maskExternalId(externalId),
      },
      'dm-otp: code issued',
    );
    return reply.code(200).send({ ok: true });
  });
}
