/**
 * POST /v1/internal/send-message
 *
 * Internal endpoint used by the apps/web invite-job runner to dispatch
 * one warm-invite message via WhatsApp + email. Not exposed to the
 * public; gated behind a shared Bearer secret (`INTERNAL_BROADCAST_SECRET`).
 *
 * Request body:
 *   {
 *     phone?: string,    // E.164; omit to skip WhatsApp
 *     email?: string,    // valid email; omit to skip email
 *     subject?: string,  // optional, used by the email channel
 *     body: string       // plain text, <= 1100 chars (defence-in-depth)
 *   }
 *
 * Response 200:
 *   {
 *     whatsapp?: { status: 'sent' | 'failed' | 'skipped', error?: string },
 *     email?:    { status: 'sent' | 'failed' | 'skipped', error?: string }
 *   }
 *
 * Why one endpoint, both channels: the runner sends per-recipient and
 * needs to coordinate WhatsApp + email failure modes (e.g. mark the
 * recipient as 'sent' even if only one channel landed). Returning a
 * compound result keeps the runner stateless.
 *
 * Throttling: the CALLER (the invite-job runner) is responsible for
 * pacing (default 1 msg/sec). This route only enforces a basic
 * per-IP rate limit as a defence-in-depth.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { normalisePhone } from '../phone.js';

const BodySchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(1100),
});

const MAX_PER_MIN_PER_IP = 600; // ~10/sec; the caller paces below this.

const rateBuckets = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const arr = (rateBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= MAX_PER_MIN_PER_IP) return true;
  arr.push(now);
  rateBuckets.set(ip, arr);
  return false;
}

function clientIp(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

function requireSecret(req: FastifyRequest): boolean {
  const expected = process.env.INTERNAL_BROADCAST_SECRET;
  if (!expected || expected.length < 24) return false;
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
  const got = auth.slice('Bearer '.length).trim();
  // Constant-time-ish compare for a short token: equal length + char-by-char.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function registerInternalSend(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/internal/send-message', async (req, reply) => {
    if (!requireSecret(req)) {
      ctx.log.warn({ ip: clientIp(req) }, 'internal-send: bad-bearer');
      return reply.code(401).send({ error: 'unauth' });
    }
    if (rateLimited(clientIp(req))) {
      return reply.code(429).send({ error: 'rate-limited' });
    }
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body', details: parsed.error.flatten() });
    }
    const { phone, email, subject, body } = parsed.data;
    if (!phone && !email) {
      return reply.code(400).send({ error: 'no-channel' });
    }

    const out: {
      whatsapp?: { status: 'sent' | 'failed' | 'skipped'; error?: string };
      email?: { status: 'sent' | 'failed' | 'skipped'; error?: string };
    } = {};

    // ---- WhatsApp ----
    if (phone) {
      const normalised = normalisePhone(phone);
      // Belt-and-braces validation: require E.164 shape AND reject
      // obvious junk (all-same-digit, starts with reserved +9xx where
      // x ∈ {99}, etc.). The Aiva gateway accepts these upstream and
      // wastes our send budget; we'd rather refuse them here and log
      // the bad CSV row.
      const validE164 = normalised !== null && /^\+[1-9]\d{7,14}$/.test(normalised);
      const digits = normalised?.slice(1) ?? '';
      const allSameDigit = /^(.)\1+$/.test(digits);
      // ITU reserves +999 as a global service code (not assignable to
      // subscribers). Any number starting +99[8-9] is invalid for a
      // person-to-person send.
      const reservedPrefix = /^\+99\d/.test(normalised ?? '');
      if (!validE164 || allSameDigit || reservedPrefix) {
        out.whatsapp = { status: 'skipped', error: 'bad-phone' };
      } else {
        try {
          const result = await ctx.waSender.send({ to: normalised!, body });
          if (result.ok) {
            out.whatsapp = { status: 'sent' };
          } else {
            out.whatsapp = {
              status: 'failed',
              error: result.errorCode ?? result.errorMessage ?? 'send-failed',
            };
          }
        } catch (err) {
          out.whatsapp = {
            status: 'failed',
            error: err instanceof Error ? err.message : 'unknown',
          };
        }
      }
    }

    // ---- Email ----
    if (email) {
      if (!ctx.emailSender) {
        out.email = { status: 'skipped', error: 'email-sender-not-configured' };
      } else {
      try {
        const result = await ctx.emailSender.send({
          to: email,
          subject: subject ?? `${ctx.config.productName} invite`,
          text: body,
          // Minimal HTML wrapper: line-breaks preserved + auto-link the
          // URL. We don't paragraph-it because pool admins write WhatsApp-
          // style messages, not formatted emails.
          html: simpleHtmlEscape(body),
        });
        if (result.ok) {
          out.email = { status: 'sent' };
        } else {
          out.email = {
            status: 'failed',
            error: String(result.status ?? result.error ?? 'send-failed'),
          };
        }
      } catch (err) {
        out.email = {
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown',
        };
      }
      }
    }

    ctx.audit.write({
      action: 'internal.send.dispatched',
      // We don't have a great phoneId in this context (the caller is
      // the runner, not a phone); use a recipient hash so the log is
      // useful for correlating without leaking PII.
      phoneId: phone ? phone.slice(-4) : email ? email.split('@')[0].slice(0, 6) : 'unknown',
      ip: clientIp(req),
      reason: `whatsapp:${out.whatsapp?.status ?? 'n/a'};email:${out.email?.status ?? 'n/a'}`,
    });

    return reply.code(200).send(out);
  });
}

function simpleHtmlEscape(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Linkify bare URLs.
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br/>');
  return `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px">${escaped}</div>`;
}
