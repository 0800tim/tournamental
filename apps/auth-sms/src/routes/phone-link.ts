/**
 * POST /v1/auth/phone-link/verify
 *
 * "Link my phone to my existing account" flow, for users who signed
 * up via email-OTP (or any other path that left them without a
 * phone on file). The product surface is a profile-page button that
 * sends them to WhatsApp with the prefilled message "login"; once
 * the gateway POSTs the inbound-login row and replies to the user
 * with the 6-digit OTP, the user pastes that OTP into a modal and
 * the web app calls this endpoint to attach the verified phone to
 * their signed-in account.
 *
 * The key design point: the user never types their own phone number.
 * Possession is proven exclusively by sending an inbound WhatsApp
 * message to our number, which the Aiva gateway translates into the
 * existing /v1/auth/inbound-login flow. This endpoint just bridges
 * the resulting OTP onto the authed user instead of minting a new
 * session for it (which is what /v1/auth/verify-by-code does).
 *
 * Request body:   { code: string (6 digits) }
 * Auth:           required (tnm_session cookie or Bearer JWT).
 *
 * Responses:
 *   200 { ok: true, user }                  Successful link.
 *   200 { ok: true, alreadyLinked: true,    Phone already this user's;
 *         user }                            idempotent no-op.
 *   400 { error: 'bad-body' }               Code not 6 digits.
 *   401 { error: 'unauthorized' }           No session or revoked.
 *   401 { error: 'unknown-or-expired' }     Code matches no active OTP.
 *   409 { error: 'phone-taken' }            Phone belongs to another
 *                                           account. Refuses hijack.
 *   429 { error: 'ip-throttled',            Too many no-match guesses
 *         retryAfterSeconds }               from this IP.
 *
 * Notes:
 *   - The same OTP can also be consumed by /v1/auth/verify-by-code,
 *     which would mint a sign-in session for the phone's existing
 *     user (or create a fresh one). The choice between the two
 *     endpoints is made by the web client based on whether there is
 *     a signed-in session present at the moment of paste.
 *   - The user-phone UNIQUE index on `user.phone` is the source of
 *     truth for collision protection; the explicit pre-check above
 *     gives a clean 409 before the UPDATE runs.
 *   - Tim 2026-06-04.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { authenticate } from '../auth-middleware.js';
import { syncUserToHighLevel } from '../highlevel.js';
import { hashOtp, safeEqualHex, OTP_LENGTH } from '../otp.js';
import { phoneLogId } from '../storage.js';

const BodySchema = z.object({
  code: z.string().length(OTP_LENGTH).regex(/^\d+$/),
});

/**
 * Hourly bucket key for per-IP "blind-guess" failures. Window matches
 * the OTP TTL so an attacker can't reset their failure budget by
 * waiting. Same shape as verify-by-code's bucket so the configured
 * `inboundCodeIpFailureMax` cap covers both endpoints uniformly.
 */
function ipFailureBucket(
  ip: string,
  now: number,
  windowSeconds: number,
): { key: string; bucketStart: number } {
  const bucketStart = Math.floor(now / windowSeconds) * windowSeconds;
  return { key: `ip:${ip}:phone-link-nomatch`, bucketStart };
}

function clientIp(req: import('fastify').FastifyRequest): string {
  return (req.ip || '').trim() || '0.0.0.0';
}

/**
 * Public-shape user record returned to the web client on success.
 * Mirrors `serialiseUser` in routes/session.ts (intentionally kept
 * in sync; the web client uses the same camelCase fields).
 */
function serialiseUser(user: import('../storage.js').UserRecord) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    displayName: user.display_name,
    firstName: user.first_name,
    lastName: user.last_name,
    country: user.country,
    city: user.city,
    favouriteTeamCode: user.favourite_team_code,
    telegramUsername: user.telegram_username,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
  };
}

export async function registerPhoneLink(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/phone-link/verify', async (req, reply) => {
    const authed = await authenticate(ctx, req);
    if (!authed) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-body' });
    const code = parsed.data.code;

    const ip = clientIp(req);
    const now = Math.floor(ctx.now() / 1000);

    ctx.storage.pruneExpiredOtps(now);

    // Blind-guess defence: per-IP cap on no-match attempts, identical
    // to verify-by-code so brute-forcers can't side-step the cap by
    // alternating endpoints.
    const ttl = ctx.config.otpTtlSeconds;
    const bucket = ipFailureBucket(ip, now, ttl);
    const currentFailures = ctx.storage.getRateBucket(
      bucket.key,
      bucket.bucketStart,
    );
    if (currentFailures >= ctx.config.inboundCodeIpFailureMax) {
      const retryAfter = bucket.bucketStart + ttl - now;
      reply.header('Retry-After', String(retryAfter));
      ctx.audit.write({
        action: 'phone-link.ip-throttled',
        phoneId: '',
        ip,
        ua: undefined,
        reason: String(currentFailures),
      });
      return reply.code(429).send({
        error: 'ip-throttled',
        retryAfterSeconds: retryAfter,
      });
    }

    // Linear scan over active inbound OTP rows; the active set is
    // tiny (tens of rows) so a constant-time walk is fine. We do not
    // break on match so timing doesn't leak which row matched.
    const active = ctx.storage.listActiveInboundOtps(now);
    let match: { phone: string; channel: 'sms' | 'whatsapp' } | null = null;
    for (const row of active) {
      const candidate = hashOtp({
        code,
        phone: row.phone,
        channel: row.channel,
        secret: ctx.config.otpSecret,
      });
      if (safeEqualHex(candidate, row.otp_hash)) {
        match = { phone: row.phone, channel: row.channel };
      }
    }

    if (!match) {
      ctx.storage.bumpRateBucket(bucket.key, bucket.bucketStart);
      ctx.audit.write({
        action: 'phone-link.no-match',
        phoneId: '',
        ip,
        ua: undefined,
        reason: 'no-row',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    // Re-check the row for the per-code attempt ceiling; a concurrent
    // request may have bumped it since the scan.
    const fresh = ctx.storage.getOtp(match.phone);
    if (!fresh || fresh.expires_at < now) {
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }
    if (fresh.magic_attempts >= ctx.config.inboundMagicMaxAttempts) {
      ctx.storage.deleteOtp(fresh.phone);
      ctx.audit.write({
        action: 'phone-link.attempts-exceeded',
        phoneId: phoneLogId(fresh.phone),
        ip,
        ua: undefined,
        reason: 'code',
      });
      return reply.code(401).send({ error: 'unknown-or-expired' });
    }

    // Collision check: is this phone already on another user record?
    // The UNIQUE index on user.phone is the backstop; this pre-check
    // gives a clean 409 before the UPDATE.
    const existing = ctx.storage.getUserByPhone(match.phone);
    const me = ctx.storage.getUser(authed.userId);
    if (!me) return reply.code(401).send({ error: 'unauthorized' });

    if (existing && existing.id !== authed.userId) {
      ctx.audit.write({
        action: 'phone-link.taken',
        phoneId: phoneLogId(match.phone),
        ip,
        ua: undefined,
        reason: existing.id,
      });
      return reply.code(409).send({ error: 'phone-taken' });
    }

    // Idempotent: same phone, same user. Burn the OTP and return ok.
    if (existing && existing.id === authed.userId) {
      ctx.storage.deleteOtp(fresh.phone);
      ctx.audit.write({
        action: 'phone-link.already-linked',
        phoneId: phoneLogId(match.phone),
        ip,
        ua: undefined,
        reason: 'idempotent',
      });
      return reply.code(200).send({
        ok: true,
        alreadyLinked: true,
        user: serialiseUser(me),
      });
    }

    // Attach the verified phone to the authed user.
    let updated;
    try {
      updated = ctx.storage.updateUser(
        authed.userId,
        { phone: match.phone },
        now,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Race: another request linked this phone between our pre-check
      // and the UPDATE. The UNIQUE index fires; we report the same
      // 409 the pre-check would have.
      if (/UNIQUE constraint failed.*phone/.test(msg)) {
        return reply.code(409).send({ error: 'phone-taken' });
      }
      throw err;
    }
    if (!updated) return reply.code(404).send({ error: 'not-found' });

    // Burn the OTP so it can't be reused via verify-by-code to mint a
    // separate session for the same phone.
    ctx.storage.deleteOtp(fresh.phone);

    // Identity changed (phone is a HighLevel identity field); push
    // the update through fire-and-forget.
    void syncUserToHighLevel(ctx.storage, updated, { now, log: ctx.log });

    ctx.audit.write({
      action: 'phone-link.ok',
      phoneId: phoneLogId(match.phone),
      ip,
      ua: undefined,
      reason: authed.userId,
    });

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(200).send({
      ok: true,
      user: serialiseUser(updated),
    });
  });
}
