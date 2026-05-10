/**
 * Email inbound webhook — Mailgun routes.
 *
 * Mailgun POSTs an inbound mail to our webhook with timestamp/token/
 * signature triplet. We verify with the Mailgun signing key and only
 * accept emails to the configured login address with a recognised
 * subject.
 *
 * https://documentation.mailgun.com/en/latest/api-webhooks.html
 */

import type { FastifyInstance } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyMailgunSignature } from '../../lib/signatures.js';

interface MailgunInbound {
  signature?: { timestamp?: string; token?: string; signature?: string };
  // Mailgun also supports a flat shape (form-data); accept both.
  timestamp?: string;
  token?: string;
  // store events use a top-level "signature" field too in some configs.
  sig?: string;
  'event-data'?: { 'message-id'?: string };
  // Common parsed-fields:
  sender?: string;
  from?: string;
  recipient?: string;
  subject?: string;
  'body-plain'?: string;
}

function extractSig(body: MailgunInbound): {
  ts: string;
  token: string;
  sig: string;
} | null {
  if (body.signature?.timestamp && body.signature?.token && body.signature?.signature) {
    return {
      ts: body.signature.timestamp,
      token: body.signature.token,
      sig: body.signature.signature,
    };
  }
  if (body.timestamp && body.token && body.sig) {
    return { ts: body.timestamp, token: body.token, sig: body.sig };
  }
  return null;
}

export async function registerEmailWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/email', async (req, reply) => {
    const body = req.body as MailgunInbound;
    const sig = extractSig(body);
    if (!sig) return reply.code(401).send({ error: 'bad-signature' });
    const ok = verifyMailgunSignature({
      signingKey: ctx.config.mailgunSigningKey,
      timestamp: sig.ts,
      token: sig.token,
      signature: sig.sig,
      now: Math.floor(ctx.now() / 1000),
    });
    if (!ok) return reply.code(401).send({ error: 'bad-signature' });

    const sender = body.sender ?? body.from ?? '';
    const subject = body.subject ?? '';
    const text = body['body-plain'] ?? '';
    // Use subject when it matches the login phrase; fall back to body.
    const phrase = ['log in', 'login'].includes(subject.trim().toLowerCase())
      ? 'log in'
      : text.trim();

    if (typeof sender === 'string' && sender) {
      await dispatch(
        {
          store: ctx.store,
          senders: ctx.senders,
          magicLinkChannels: ctx.magicLinkChannels,
          log: ctx.log,
        },
        { channel: 'email', externalId: sender, text: phrase },
      );
    }
    return reply.code(200).send({ ok: true });
  });
}
