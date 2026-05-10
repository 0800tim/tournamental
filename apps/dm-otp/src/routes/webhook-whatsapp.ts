/**
 * POST /v1/webhooks/whatsapp
 *
 * Aiva gateway → us. The gateway forwards inbound messages from the
 * paired Baileys session. Signature: X-Aiva-Signature: sha256=<hex>
 * over the raw request body, keyed with AIVA_WEBHOOK_SECRET.
 *
 * Inbound shape (Aiva contract; tolerant parser):
 *   {
 *     event: "message.received",
 *     sessionId: string,
 *     from: string,        // E.164 with leading + or jid
 *     text?: string,
 *     pushName?: string
 *   }
 *
 * We only act on messages whose text matches the login trigger.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { isLoginTrigger, tryIssueOtp } from '../issue.js';
import { verifyHmacSha256Header } from '../lib/signatures.js';
import { maskExternalId } from '../audit.js';

const PayloadSchema = z.object({
  event: z.string().optional(),
  sessionId: z.string().optional(),
  from: z.string().min(1),
  text: z.string().optional(),
  message: z.string().optional(),
  body: z.string().optional(),
  pushName: z.string().optional(),
});

export async function registerWhatsAppWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/webhooks/whatsapp', async (req, reply) => {
    const headerRaw = req.headers['x-aiva-signature'];
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    const rawBody =
      typeof (req as { rawBody?: unknown }).rawBody === 'string'
        ? ((req as { rawBody?: string }).rawBody as string)
        : JSON.stringify(req.body ?? {});
    if (
      !verifyHmacSha256Header({
        header,
        rawBody,
        secret: ctx.config.aivaWebhookSecret,
      })
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }

    const parsed = PayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(200).send({ ok: true, ignored: 'bad-body' });
    }
    const text = parsed.data.text ?? parsed.data.message ?? parsed.data.body;
    if (!isLoginTrigger(text)) {
      return reply.code(200).send({ ok: true, ignored: 'no-trigger' });
    }

    // Normalise the WA "from" — strip "@s.whatsapp.net" if present so
    // downstream replies use the plain phone-style id.
    const externalId = parsed.data.from.replace(/@.*$/, '');

    const result = await tryIssueOtp({
      store: ctx.store,
      reply: ctx.replies.whatsapp,
      audit: ctx.audit,
      channel: 'whatsapp',
      externalId,
      profile: {
        displayName: parsed.data.pushName,
        phone: externalId.startsWith('+') ? externalId : `+${externalId}`,
      },
      productName: ctx.config.productName,
    });

    if (!result.ok) {
      ctx.log.warn(
        {
          channel: 'whatsapp',
          externalIdMask: maskExternalId(externalId),
          errorCode: result.errorCode,
        },
        'dm-otp: issue failed',
      );
      return reply.code(200).send({ ok: false, error: result.errorCode });
    }
    ctx.log.info(
      { channel: 'whatsapp', externalIdMask: maskExternalId(externalId) },
      'dm-otp: code issued',
    );
    return reply.code(200).send({ ok: true });
  });
}
