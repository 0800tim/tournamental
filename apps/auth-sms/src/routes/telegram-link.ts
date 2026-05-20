/**
 * POST /v1/auth/telegram/link — link a Telegram identity to the current user.
 *
 * Verifies the Telegram Login Widget payload, then merges the telegram_id
 * onto the signed-in user. If a stray "telegram-only" user exists for the
 * same telegram_id (no phone, no email), it is absorbed and deleted.
 *
 * Requires an active tnm_session cookie or Bearer JWT.
 *
 * Responses:
 *   200 { ok: true, user }
 *   400 { error: "bad-body" }
 *   401 { error: "unauthorized" | "bad-hash" | "expired" | "future" }
 *   409 { error: "telegram-on-other-user" } // dup has its own phone/email
 *   503 { error: "not-configured" }
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../context.js';
import { verifySessionJwt } from '../jwt.js';
import {
  TelegramLoginVerifyError,
  verifyTelegramLogin,
} from '../telegram-login.js';

const BodySchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(128).optional(),
  last_name: z.string().min(1).max(128).optional(),
  username: z.string().min(1).max(64).optional(),
  photo_url: z.string().url().max(512).optional(),
  auth_date: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

function extractJwt(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) === 'tnm_session') {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

export async function registerTelegramLink(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.post('/v1/auth/telegram/link', async (req, reply) => {
    if (!ctx.config.telegramBotToken) {
      return reply.code(503).send({ error: 'not-configured' });
    }

    // 1. Auth — must already be signed in.
    const token = extractJwt(req);
    if (!token) return reply.code(401).send({ error: 'unauthorized' });
    let claims;
    try {
      claims = await verifySessionJwt({
        secret: ctx.config.jwtSecret,
        token,
      });
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const session = ctx.storage.getSessionByJti(claims.jti);
    if (!session) return reply.code(401).send({ error: 'unauthorized' });

    // 2. Verify Telegram payload.
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad-body' });

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
        const status = err.code === 'bad-payload' ? 400 : 401;
        return reply.code(status).send({ error: err.code });
      }
      throw err;
    }

    // 3. Link / merge.
    const outcome = ctx.storage.linkTelegramToUser({
      userId: claims.sub,
      telegramId: verified.id,
      telegramUsername: verified.username,
      firstName: verified.firstName,
      lastName: verified.lastName,
      now: nowSeconds,
    });

    if (outcome === 'conflict-strong') {
      return reply.code(409).send({ error: 'telegram-on-other-user' });
    }
    if (outcome === 'no-user') {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const user = ctx.storage.getUser(claims.sub);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    ctx.log.info(
      { userId: user.id, telegramId: verified.id, outcome },
      'auth: telegram link ok',
    );

    reply.header('Cache-Control', 'private, no-store');
    return reply.send({
      ok: true,
      outcome,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        displayName: user.display_name,
        telegramId: user.telegram_id,
        telegramUsername: user.telegram_username,
      },
    });
  });
}
