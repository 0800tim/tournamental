/**
 * Meta Messenger + Instagram webhooks.
 *
 * Meta delivers the same entry/messaging structure for both products,
 * just under different `object` values ("page" for Messenger, "instagram"
 * for IG). We register one handler factory and bind it at two paths.
 *
 * Subscription verification: GET endpoint returns hub.challenge if
 * hub.verify_token matches METApr config. (Standard Meta dance — without
 * this they won't enable the subscription.)
 *
 * Signature verification: X-Hub-Signature-256: sha256=<hex> over the raw
 * request body, keyed with META_APP_SECRET.
 *
 * Reference: https://developers.facebook.com/docs/messenger-platform/reference/webhook-events
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';
import { isLoginTrigger, tryIssueOtp } from '../issue.js';
import { verifyHmacSha256Header } from '../lib/signatures.js';
import { maskExternalId } from '../audit.js';
import type { DmChannel } from '../jwt.js';
import type { ReplyAdapter } from '../lib/replies/types.js';

const MessagingEntry = z.object({
  sender: z.object({ id: z.string().min(1) }),
  recipient: z.object({ id: z.string().min(1) }).optional(),
  timestamp: z.number().optional(),
  message: z
    .object({
      mid: z.string().optional(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
    })
    .optional(),
});

const PayloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        id: z.string().optional(),
        time: z.number().optional(),
        messaging: z.array(MessagingEntry).optional(),
      }),
    )
    .optional(),
});

interface MetaWebhookOptions {
  path: string;
  channel: DmChannel; // 'messenger' | 'instagram'
  expectedObject: string; // "page" or "instagram"
  resolveReply: (ctx: DmOtpContext) => ReplyAdapter;
}

function registerOne(
  app: FastifyInstance,
  ctx: DmOtpContext,
  opts: MetaWebhookOptions,
): void {
  // Subscription verification (Meta only does this once at setup).
  app.get(opts.path, async (req, reply) => {
    const q = req.query as Record<string, string | string[] | undefined>;
    const mode = typeof q['hub.mode'] === 'string' ? q['hub.mode'] : '';
    const token =
      typeof q['hub.verify_token'] === 'string' ? q['hub.verify_token'] : '';
    const challenge =
      typeof q['hub.challenge'] === 'string' ? q['hub.challenge'] : '';
    if (
      mode === 'subscribe' &&
      ctx.config.metaVerifyToken &&
      token === ctx.config.metaVerifyToken
    ) {
      reply.header('Content-Type', 'text/plain');
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: 'bad-verify-token' });
  });

  app.post(opts.path, async (req, reply) => {
    const headerRaw = req.headers['x-hub-signature-256'];
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    const rawBody =
      typeof (req as { rawBody?: unknown }).rawBody === 'string'
        ? ((req as { rawBody?: string }).rawBody as string)
        : JSON.stringify(req.body ?? {});
    if (
      !verifyHmacSha256Header({
        header,
        rawBody,
        secret: ctx.config.metaAppSecret,
      })
    ) {
      return reply.code(401).send({ error: 'bad-signature' });
    }

    const parsed = PayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(200).send({ ok: true, ignored: 'bad-body' });
    }
    if (parsed.data.object && parsed.data.object !== opts.expectedObject) {
      return reply.code(200).send({ ok: true, ignored: 'wrong-object' });
    }

    const adapter = opts.resolveReply(ctx);
    let issuedCount = 0;
    let failed = 0;

    for (const entry of parsed.data.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        if (!m.message || m.message.is_echo) continue;
        const text = m.message.text;
        if (!isLoginTrigger(text)) continue;
        const externalId = m.sender.id;

        const result = await tryIssueOtp({
          store: ctx.store,
          reply: adapter,
          audit: ctx.audit,
          channel: opts.channel,
          externalId,
          profile: {},
          productName: ctx.config.productName,
        });

        if (result.ok) {
          issuedCount++;
          ctx.log.info(
            {
              channel: opts.channel,
              externalIdMask: maskExternalId(externalId),
            },
            'dm-otp: code issued',
          );
        } else {
          failed++;
          ctx.log.warn(
            {
              channel: opts.channel,
              externalIdMask: maskExternalId(externalId),
              errorCode: result.errorCode,
            },
            'dm-otp: issue failed',
          );
        }
      }
    }

    return reply.code(200).send({ ok: true, issued: issuedCount, failed });
  });
}

export async function registerMessengerWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  registerOne(app, ctx, {
    path: '/v1/webhooks/messenger',
    channel: 'messenger',
    expectedObject: 'page',
    resolveReply: (c) => c.replies.messenger,
  });
}

export async function registerInstagramWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  registerOne(app, ctx, {
    path: '/v1/webhooks/instagram',
    channel: 'instagram',
    expectedObject: 'instagram',
    resolveReply: (c) => c.replies.instagram,
  });
}
