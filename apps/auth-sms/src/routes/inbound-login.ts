/**
 * POST /v1/auth/inbound-login
 *
 * Gateway-callable endpoint. The Aiva SMS gateway POSTs to this when
 * an inbound message (WhatsApp or SMS) matching the `login` keyword
 * arrives from a phone number, and we reply with a fresh 6-digit code
 * plus a one-tap magic-link the gateway pastes into the user's
 * outbound reply.
 *
 * This is the INBOUND flow, distinct from the legacy OUTBOUND flow at
 * POST /v1/auth/request where the website asks us to send a code to a
 * phone. The two flows share storage (phone_otp) so they cannot be
 * used simultaneously against the same phone without overwriting each
 * other; in practice they're never both active.
 *
 * Auth: shared secret header `x-inbound-secret` matching the
 * `INBOUND_LOGIN_SECRET` env var. The gateway is the only legitimate
 * caller; the public web never hits this route.
 *
 * Request body:  { phone: string (E.164), channel: 'sms' | 'whatsapp' }
 * Response 200:  { success: true, code: string, magicToken: string, magicLinkUrl: string }
 * Response 400:  { error: 'bad-body' | 'bad-phone' | 'bad-channel' }
 * Response 401:  { error: 'bad-secret' }
 * Response 429:  { error: 'rate-limited', retryAfterSeconds, reason }
 *
 * Why we return both `magicToken` and the full `magicLinkUrl`: the
 * Aiva gateway pastes `magicLinkUrl` verbatim into the user's
 * outbound reply, so the destination is controlled here (env var
 * MAGIC_LINK_BASE_URL, default https://play.tournamental.com/) rather
 * than hardcoded gateway-side. `magicToken` is still surfaced for
 * gateways that want to compose their own URL or build a deep-link
 * into a native app. The token is single-use, expires in 5 minutes,
 * and binds to the first device that uses it via `magic-verify` /
 * `verify-by-code`.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { normalisePhone } from '../phone.js';
import { generateOtp, hashOtp } from '../otp.js';
import { phoneLogId } from '../storage.js';
import { checkOtpRequestLimit } from '../rate-limit.js';

const BodySchema = z.object({
  phone: z.string().min(1).max(32),
  channel: z.enum(['sms', 'whatsapp']),
});

function clientIp(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

/**
 * Constant-time string comparison for the inbound secret header.
 * Returns false on length mismatch (cheap path) without leaking length.
 */
function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export async function registerInboundLogin(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/inbound-login', async (req, reply) => {
    // Header-based authentication. The gateway holds the shared secret;
    // public web is firewalled out by it. Returning 401 here is the
    // only path that doesn't write to storage, so a brute-force on
    // the secret can't pollute the OTP table.
    const provided = req.headers['x-inbound-secret'];
    const expected = ctx.config.inboundLoginSecret;
    if (!expected || typeof provided !== 'string' || !safeStringEqual(provided, expected)) {
      ctx.audit.write({
        action: 'inbound.login.bad-secret',
        phoneId: '',
        ip: clientIp(req),
        ua: undefined,
        reason: typeof provided === 'string' ? 'mismatch' : 'absent',
      });
      return reply.code(401).send({ error: 'bad-secret' });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const phone = normalisePhone(parsed.data.phone);
    if (!phone) return reply.code(400).send({ error: 'bad-phone' });
    const channel = parsed.data.channel;

    const now = Math.floor(ctx.now() / 1000);
    const ip = clientIp(req);
    const pid = phoneLogId(phone);

    ctx.storage.pruneExpiredOtps(now);

    // Per-phone rate limits prevent SMS/WhatsApp flooding of any one
    // number: 60-second cooldown between requests + 5 requests per
    // phone per hour. We deliberately disable the per-IP cap on this
    // endpoint — the gateway is the only legitimate caller (proven by
    // the shared-secret header above) and every legitimate inbound
    // request arrives from the same IP, so a per-IP cap would
    // throttle the gateway itself. Public IPs hit /v1/auth/request
    // (the outbound flow) instead, which keeps its own per-IP cap.
    const limit = checkOtpRequestLimit({
      storage: ctx.storage,
      phone,
      ip,
      now,
      config: { ipHourlyMax: Number.POSITIVE_INFINITY },
    });
    if (!limit.ok) {
      reply.header('Retry-After', String(limit.retryAfterSeconds));
      ctx.audit.write({
        action: 'inbound.login.rate-limited',
        phoneId: pid,
        channel,
        ip,
        ua: undefined,
        reason: limit.reason,
      });
      return reply.code(429).send({
        error: 'rate-limited',
        retryAfterSeconds: limit.retryAfterSeconds,
        reason: limit.reason,
      });
    }

    // 6-digit code (HMAC-hashed at rest, bound to phone+channel).
    const code = generateOtp();
    const otpHash = hashOtp({
      code,
      phone,
      channel,
      secret: ctx.config.otpSecret,
    });
    // 32 bytes (64 hex chars) of CSPRNG entropy for the magic link.
    // Plenty against brute-force on the public verify endpoint, even
    // with no per-IP limit; the per-code attempt counter caps it
    // independently.
    const magicToken = randomBytes(32).toString('hex');

    ctx.storage.upsertOtp({
      phone,
      otp_hash: otpHash,
      channel,
      attempts: 0,
      expires_at: now + ctx.config.otpTtlSeconds,
      created_at: now,
      challenge: magicToken,
      bound_ip: null,
      bound_ua_fp: null,
      magic_attempts: 0,
    });

    ctx.audit.write({
      action: 'inbound.login.issued',
      phoneId: pid,
      channel,
      ip,
      ua: undefined,
      reason: 'ok',
    });

    // Build the full magic-link URL the gateway should paste into the
    // outbound reply. Single source of truth — change MAGIC_LINK_BASE_URL
    // here and every channel picks it up on next request.
    const magicLinkUrl = buildMagicLinkUrl(
      ctx.config.magicLinkBaseUrl,
      magicToken,
    );

    return reply.code(200).send({
      success: true,
      code,
      magicToken,
      magicLinkUrl,
    });
  });
}

/**
 * Append `?v=<token>` to the configured base URL. Preserves any
 * existing path/query on the base so operators can point it at e.g.
 * `https://play.tournamental.com/world-cup-2026?utm_source=otp` if
 * they want UTM tracking on every magic-link tap. Falls back to a
 * safe string concatenation if URL parsing fails (very rare, only
 * with a totally malformed env var).
 */
export function buildMagicLinkUrl(baseUrl: string, token: string): string {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('v', token);
    return u.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}v=${encodeURIComponent(token)}`;
  }
}
