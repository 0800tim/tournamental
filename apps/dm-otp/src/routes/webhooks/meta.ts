/**
 * Meta-family webhooks: Messenger, Instagram, WhatsApp, Threads.
 *
 * All four share the X-Hub-Signature-256 HMAC scheme using the App
 * Secret. We register one route per channel because the inbound JSON
 * shapes differ.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyMetaSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  // Fastify exposes the raw text via req.rawBody when the
  // contentTypeParser is configured for it; otherwise re-stringify.
  // We register a content-type parser at app boot to capture rawBody.
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

function checkSig(req: FastifyRequest, secret: string): boolean {
  const sig = req.headers['x-hub-signature-256'];
  return verifyMetaSignature(secret, rawBodyOf(req), typeof sig === 'string' ? sig : undefined);
}

export async function registerMetaWebhooks(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  // Verification challenge (Messenger, Instagram, Threads, WhatsApp all use it)
  for (const channel of ['messenger', 'instagram', 'whatsapp', 'threads'] as const) {
    app.get(`/v1/auth/dm-otp/webhooks/${channel}`, async (req, reply) => {
      const q = req.query as {
        'hub.mode'?: string;
        'hub.verify_token'?: string;
        'hub.challenge'?: string;
      };
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token']) {
        // We accept the verify token if it matches metaAppSecret (the
        // operator configures this in the Meta dashboard). Tests/dev
        // can override per-channel via env.
        const expected =
          process.env[`META_VERIFY_TOKEN_${channel.toUpperCase()}`] ??
          ctx.config.metaAppSecret;
        if (q['hub.verify_token'] === expected) {
          return reply.code(200).send(q['hub.challenge'] ?? '');
        }
        return reply.code(403).send('forbidden');
      }
      return reply.code(400).send('bad-request');
    });
  }

  // Messenger
  app.post('/v1/auth/dm-otp/webhooks/messenger', async (req, reply) => {
    if (!checkSig(req, ctx.config.metaAppSecret)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as { entry?: Array<{ messaging?: Array<{ sender?: { id?: string }; message?: { text?: string } }> }> };
    for (const entry of body.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        const psid = m.sender?.id;
        const text = m.message?.text;
        if (typeof psid === 'string' && typeof text === 'string') {
          await dispatch(
            {
              store: ctx.store,
              senders: ctx.senders,
              magicLinkChannels: ctx.magicLinkChannels,
              log: ctx.log,
            },
            { channel: 'messenger', externalId: psid, text },
          );
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // Instagram (same shape as Messenger; routed via a different page).
  app.post('/v1/auth/dm-otp/webhooks/instagram', async (req, reply) => {
    if (!checkSig(req, ctx.config.metaAppSecret)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as { entry?: Array<{ messaging?: Array<{ sender?: { id?: string }; message?: { text?: string } }> }> };
    for (const entry of body.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        const igsid = m.sender?.id;
        const text = m.message?.text;
        if (typeof igsid === 'string' && typeof text === 'string') {
          await dispatch(
            {
              store: ctx.store,
              senders: ctx.senders,
              magicLinkChannels: ctx.magicLinkChannels,
              log: ctx.log,
            },
            { channel: 'instagram', externalId: igsid, text },
          );
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // WhatsApp (Cloud API). Inbound shape differs from Messenger.
  app.post('/v1/auth/dm-otp/webhooks/whatsapp', async (req, reply) => {
    if (!checkSig(req, ctx.config.metaAppSecret)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{ from?: string; text?: { body?: string } }>;
          };
        }>;
      }>;
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          const from = m.from;
          const text = m.text?.body;
          if (typeof from === 'string' && typeof text === 'string') {
            await dispatch(
              {
                store: ctx.store,
                senders: ctx.senders,
                magicLinkChannels: ctx.magicLinkChannels,
                log: ctx.log,
              },
              { channel: 'whatsapp', externalId: from, text },
            );
          }
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // Threads. Field name varies in the public docs; we accept the
  // common "messages" shape and a "text" body.
  app.post('/v1/auth/dm-otp/webhooks/threads', async (req, reply) => {
    if (!checkSig(req, ctx.config.metaAppSecret)) {
      return reply.code(401).send({ error: 'bad-signature' });
    }
    const body = req.body as {
      entry?: Array<{
        messaging?: Array<{ sender?: { id?: string }; message?: { text?: string } }>;
      }>;
    };
    for (const entry of body.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        const sid = m.sender?.id;
        const text = m.message?.text;
        if (typeof sid === 'string' && typeof text === 'string') {
          await dispatch(
            {
              store: ctx.store,
              senders: ctx.senders,
              magicLinkChannels: ctx.magicLinkChannels,
              log: ctx.log,
            },
            { channel: 'threads', externalId: sid, text },
          );
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });
}
