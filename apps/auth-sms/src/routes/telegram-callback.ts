/**
 * POST /v1/auth/telegram/callback — Telegram Login Widget verifier.
 *
 * Accepts the Login Widget payload (id, first_name, last_name?, username?,
 * photo_url?, auth_date, hash) and an optional `phone_number` from a
 * follow-up bot request-contact step. Verifies the hash against
 * TELEGRAM_BOT_TOKEN, upserts the user in the same `user` table the
 * SMS-OTP path uses, and mints the same session JWT.
 *
 * Request shape mirrors what `telegram-widget.js` posts back via the
 * `data-onauth` callback — the marketing site simply forwards it as JSON.
 *
 * Responses:
 *   200 { ok: true, jwt, expiresAt, user }
 *   400 { error: "bad-body" }
 *   401 { error: "bad-hash" | "expired" | "future" }
 *   503 { error: "not-configured" }   // bot token not set
 *
 * Tim's BotFather provisioning step (one-off):
 *   1. Open @BotFather, run `/setdomain` for the chosen bot, set
 *      `tournamental.com`. The widget will not load on any other origin.
 *   2. Reuse `TELEGRAM_BOT_TOKEN` from apps/tournament-bot/.env so the
 *      bot whose token signs Login payloads is the same bot whose
 *      username (`TournamentalBot` by default) renders on the widget.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { syncUserToHighLevel } from '../highlevel.js';
import { signSessionJwt } from '../jwt.js';
import {
  TelegramLoginVerifyError,
  verifyTelegramLogin,
} from '../telegram-login.js';
import { normalisePhone } from '../phone.js';
import { buildSessionCookie } from './magic-verify.js';

const BodySchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(128).optional(),
  last_name: z.string().min(1).max(128).optional(),
  username: z.string().min(1).max(64).optional(),
  photo_url: z.string().url().max(512).optional(),
  auth_date: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  phone_number: z.string().min(1).max(32).optional(),
});

export async function registerTelegramCallback(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/telegram/callback', async (req, reply) => {
    if (!ctx.config.telegramBotToken) {
      return reply.code(503).send({ error: 'not-configured' });
    }

    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-body' });
    }

    const nowSeconds = Math.floor(ctx.now() / 1000);
    let verified;
    try {
      verified = verifyTelegramLogin({
        payload: parsed.data,
        botToken: ctx.config.telegramBotToken,
        nowSeconds,
      });
    } catch (err) {
      if (err instanceof TelegramLoginVerifyError) {
        ctx.log.warn(
          { code: err.code, telegramId: parsed.data.id },
          'auth: telegram verify failed',
        );
        // 503 leaks "not configured" only — bad-payload / bad-hash /
        // expired / future are all 401 from the client's POV.
        const status = err.code === 'bad-payload' ? 400 : 401;
        return reply.code(status).send({ error: err.code });
      }
      throw err;
    }

    // Optional phone link. We accept whatever the bot supplied as long as
    // it normalises to E.164; if it doesn't, we just drop it rather than
    // failing the login.
    const linkedPhone =
      verified.phoneNumber !== null
        ? normalisePhone(verified.phoneNumber)
        : null;

    const displayName =
      [verified.firstName, verified.lastName]
        .filter((s): s is string => !!s && s.length > 0)
        .join(' ')
        .trim() || verified.username || null;

    const user = ctx.storage.findOrCreateTelegramUser({
      telegramId: verified.id,
      telegramUsername: verified.username,
      displayName,
      phone: linkedPhone,
      now: nowSeconds,
    });

    // Mirror into HighLevel as a `player` contact (fire-and-forget).
    void syncUserToHighLevel(ctx.storage, user, { now: nowSeconds, log: ctx.log });

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
      created_at: nowSeconds,
      expires_at: signed.expiresAt,
      user_agent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 256)
          : null,
      ip: req.ip || null,
    });

    ctx.log.info(
      { userId: user.id, telegramId: verified.id, jti: signed.jti },
      'auth: telegram verify ok',
    );

    // Set the same apex-domain cookie the WhatsApp/SMS magic-verify path
    // uses, so the play app and marketing site recognise the session
    // immediately without the client having to re-attach the JWT.
    reply.header(
      'Set-Cookie',
      buildSessionCookie({
        jwt: signed.jwt,
        ttlSeconds: ctx.config.sessionTtlSeconds,
        cookieDomain: ctx.config.inboundCookieDomain,
      }),
    );

    return reply.code(200).send({
      ok: true,
      jwt: signed.jwt,
      expiresAt: signed.expiresAt,
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.display_name,
        country: user.country,
        telegramId: user.telegram_id,
        telegramUsername: user.telegram_username,
      },
    });
  });
}
