/**
 * Email OTP routes.
 *
 *   POST /v1/auth/email/request — body { email }
 *   POST /v1/auth/email/verify  — body { email, code }
 *
 * The shape mirrors the phone OTP flow but with a dedicated `email_otp`
 * table and a separate hash binding (`email|email|<code>` rather than
 * `phone|channel|<code>`). On verify the user is upserted by email and
 * the same apex-domain `tnm_session` cookie is set, so the play app's
 * useUser() recognises the session without any new client plumbing.
 *
 * Rate limits mirror the inbound-login flow:
 *   - per-email 60s cooldown between requests
 *   - per-email hourly cap (5/hour) so a single mailbox can't be flooded
 *   - per-IP hourly cap on /verify failures to bound brute-force across
 *     the whole table
 *
 * The route is gated by EmailSender presence: if SENDGRID_API_KEY is
 * missing the stub sender logs to console and the endpoint still
 * works in dev. In production a 503 would be returned by upstream
 * health if SENDGRID is mis-configured, but we never silently drop a
 * request.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { AuthContext } from '../context.js';
import { syncUserToHighLevel } from '../highlevel.js';
import { generateOtp, OTP_LENGTH } from '../otp.js';
import { signSessionJwt } from '../jwt.js';
import { buildSessionCookie } from './magic-verify.js';
import { truncateUa } from '../audit.js';

// --- Hashing -----------------------------------------------------------

/**
 * HMAC the OTP bound to (email, code) with the service secret. Keeps
 * a leaked hash useless against any other email row.
 */
function hashEmailOtp(opts: {
  code: string;
  email: string;
  secret: string;
}): string {
  const h = createHmac('sha256', opts.secret);
  h.update(`email|${opts.email}|${opts.code}`);
  return h.digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// --- Schemas -----------------------------------------------------------

const RequestSchema = z.object({
  email: z.string().email().max(254),
});

const VerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

// --- Rate-limit windows ------------------------------------------------

const REQUEST_COOLDOWN_SECONDS = 60;        // per-email throttle
const REQUEST_HOURLY_MAX = 5;               // per-email cap
const VERIFY_IP_HOURLY_MAX = 60;            // per-IP no-match cap
const HOUR_SECONDS = 3600;

function emailLogId(email: string): string {
  // Don't log the full address; first 2 chars + domain is enough to
  // disambiguate without leaking. Matches the phone-log redaction.
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'email:*';
  return `email:${user.slice(0, 2)}***@${domain}`;
}

function ipOf(req: FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

// --- Helpers -----------------------------------------------------------

function renderEmail(opts: {
  code: string;
  productName: string;
  ttlMinutes: number;
}): { text: string; html: string } {
  const { code, productName, ttlMinutes } = opts;
  const text =
    `Your ${productName} sign-in code is ${code}.\n` +
    `\n` +
    `It expires in ${ttlMinutes} minutes. If you did not request this,` +
    ` you can safely ignore this email.\n` +
    `\n` +
    `, ${productName}`;
  const html =
    `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#f3f4f8;padding:32px">` +
    `<div style="max-width:480px;margin:0 auto;background:#141a2d;border-radius:16px;padding:28px;border:1px solid rgba(255,255,255,0.08)">` +
    `<h2 style="margin:0 0 12px 0;font-size:20px;color:#fff">Your ${productName} sign-in code</h2>` +
    `<p style="margin:0 0 16px 0;color:#a0a8c0;font-size:14px">Tap or paste this code in the sign-in window:</p>` +
    `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.32em;text-align:center;padding:18px;border-radius:12px;background:#0b1020;border:1px solid rgba(126,182,232,0.4);color:#fde68a">` +
    `${code}` +
    `</div>` +
    `<p style="margin:18px 0 0 0;color:#a0a8c0;font-size:13px">It expires in ${ttlMinutes} minutes. If you did not request this, you can safely ignore this email.</p>` +
    `</div></body></html>`;
  return { text, html };
}

// --- Routes ------------------------------------------------------------

export async function registerEmailOtp(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/email/request', async (req, reply) => {
    if (!ctx.emailSender) {
      return reply.code(503).send({ error: 'not-configured' });
    }
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const ip = ipOf(req);
    const now = Math.floor(ctx.now() / 1000);

    // Per-email cooldown to stop "send me 100 codes" abuse.
    const cooldownKey = `email:${email}:cooldown`;
    const cooldownBucket =
      Math.floor(now / REQUEST_COOLDOWN_SECONDS) * REQUEST_COOLDOWN_SECONDS;
    if (ctx.storage.getRateBucket(cooldownKey, cooldownBucket) > 0) {
      const retryAfter = cooldownBucket + REQUEST_COOLDOWN_SECONDS - now;
      reply.header('Retry-After', String(retryAfter));
      ctx.audit.write({
        action: 'email.request.cooldown',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: 'within-window',
      });
      return reply.code(429).send({ error: 'cooldown', retryAfterSeconds: retryAfter });
    }

    // Per-email hourly cap (longer-window flood protection).
    const hourlyKey = `email:${email}:request`;
    const hourlyBucket = Math.floor(now / HOUR_SECONDS) * HOUR_SECONDS;
    if (ctx.storage.getRateBucket(hourlyKey, hourlyBucket) >= REQUEST_HOURLY_MAX) {
      const retryAfter = hourlyBucket + HOUR_SECONDS - now;
      reply.header('Retry-After', String(retryAfter));
      ctx.audit.write({
        action: 'email.request.hourly-cap',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: 'cap',
      });
      return reply.code(429).send({
        error: 'hourly-cap',
        retryAfterSeconds: retryAfter,
      });
    }

    ctx.storage.pruneExpiredEmailOtps(now);

    const code = generateOtp();
    const hash = hashEmailOtp({ code, email, secret: ctx.config.otpSecret });
    const ttlMinutes = Math.max(1, Math.round(ctx.config.otpTtlSeconds / 60));

    ctx.storage.upsertEmailOtp({
      email,
      otp_hash: hash,
      expires_at: now + ctx.config.otpTtlSeconds,
      created_at: now,
    });

    const { text, html } = renderEmail({
      code,
      productName: ctx.config.productName,
      ttlMinutes,
    });
    const result = await ctx.emailSender.send({
      to: email,
      subject:
        process.env.SENDGRID_SUBJECT ??
        `Your ${ctx.config.productName} sign-in code`,
      text,
      html,
    });

    if (!result.ok) {
      ctx.log.error(
        { code: result.status, err: result.error, emailId: emailLogId(email) },
        'auth: sendgrid send failed',
      );
      ctx.audit.write({
        action: 'email.request.send-failed',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: String(result.status),
      });
      // Don't 500 the caller; the OTP row will simply expire unused.
      // Surface a structured error so the modal can prompt a retry.
      return reply.code(502).send({ error: 'send-failed' });
    }

    ctx.storage.bumpRateBucket(cooldownKey, cooldownBucket);
    ctx.storage.bumpRateBucket(hourlyKey, hourlyBucket);
    ctx.audit.write({
      action: 'email.request.ok',
      phoneId: emailLogId(email),
      ip,
      ua: undefined,
      reason: result.messageId ?? '',
    });

    return reply.code(200).send({
      ok: true,
      expiresInSeconds: ctx.config.otpTtlSeconds,
    });
  });

  app.post('/v1/auth/email/verify', async (req, reply) => {
    const ip = ipOf(req);
    const now = Math.floor(ctx.now() / 1000);

    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const code = parsed.data.code;

    // Per-IP hourly cap on no-match attempts. Successful verifies do
    // NOT count against this bucket so a shared NAT is safe.
    const ipBucketKey = `ip:${ip}:email-verify-nomatch`;
    const ipBucket = Math.floor(now / HOUR_SECONDS) * HOUR_SECONDS;
    if (
      ctx.storage.getRateBucket(ipBucketKey, ipBucket) >= VERIFY_IP_HOURLY_MAX
    ) {
      const retryAfter = ipBucket + HOUR_SECONDS - now;
      reply.header('Retry-After', String(retryAfter));
      ctx.audit.write({
        action: 'email.verify.ip-throttled',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: 'cap',
      });
      return reply.code(429).send({
        error: 'ip-throttled',
        retryAfterSeconds: retryAfter,
      });
    }

    ctx.storage.pruneExpiredEmailOtps(now);
    const row = ctx.storage.getEmailOtp(email);
    if (!row || row.expires_at < now) {
      ctx.storage.bumpRateBucket(ipBucketKey, ipBucket);
      ctx.audit.write({
        action: 'email.verify.unknown',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: row ? 'expired' : 'no-row',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    if (row.attempts >= ctx.config.maxVerifyAttempts) {
      ctx.storage.deleteEmailOtp(email);
      ctx.audit.write({
        action: 'email.verify.attempts-exceeded',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: String(row.attempts),
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    const candidate = hashEmailOtp({
      code,
      email,
      secret: ctx.config.otpSecret,
    });
    if (!safeEqualHex(candidate, row.otp_hash)) {
      const attempts = ctx.storage.incrementEmailOtpAttempts(email);
      ctx.storage.bumpRateBucket(ipBucketKey, ipBucket);
      ctx.audit.write({
        action: 'email.verify.bad-code',
        phoneId: emailLogId(email),
        ip,
        ua: undefined,
        reason: String(attempts),
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    // Match! Upsert the user, mint session, set cookie, delete OTP.
    const user = ctx.storage.findOrCreateEmailUser(email, now);
    // Mirror into HighLevel as a `player` contact (fire-and-forget).
    void syncUserToHighLevel(ctx.storage, user, { now, log: ctx.log });
    const signed = await signSessionJwt({
      secret: ctx.config.jwtSecret,
      userId: user.id,
      phone: user.phone ?? '',
      ttlSeconds: ctx.config.sessionTtlSeconds,
    });
    ctx.storage.insertSession({
      id: signed.jti,
      user_id: user.id,
      jwt_jti: signed.jti,
      created_at: now,
      expires_at: signed.expiresAt,
      user_agent: truncateUa(
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent']
          : undefined,
      ) ?? null,
      ip,
    });
    ctx.storage.deleteEmailOtp(email);

    reply.header(
      'Set-Cookie',
      buildSessionCookie({
        jwt: signed.jwt,
        ttlSeconds: ctx.config.sessionTtlSeconds,
        cookieDomain: ctx.config.inboundCookieDomain,
      }),
    );
    ctx.audit.write({
      action: 'email.verify.ok',
      phoneId: emailLogId(email),
      ip,
      ua: undefined,
      reason: 'minted',
    });

    return reply.code(200).send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        displayName: user.display_name,
        country: user.country,
      },
    });
  });
}
