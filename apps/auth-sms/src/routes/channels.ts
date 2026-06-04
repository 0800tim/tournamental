/**
 * Channel availability routes.
 *
 *   GET  /v1/auth/channels                       , public, what's available
 *   POST /v1/auth/admin/channels/:channel        , admin, flip a channel
 *
 * The public endpoint drives the SignupModal's "show WhatsApp button"
 * decision. It's intentionally short-cached (`s-maxage=10`) so a
 * channel flip propagates to all clients within ~10 seconds without
 * the modal having to poll continuously.
 *
 * The admin endpoint is gated by the same X-Admin-Token header as
 * /v1/auth/whatsapp/pairing-qr; the admin app proxies through it. We
 * deliberately surface this on auth-sms (not the admin app's own
 * Next.js API) so a single source of truth lives next to the state.
 *
 * Tim 2026-06-04.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

import type { AuthContext } from '../context.js';
import {
  getWhatsAppAvailability,
  setWhatsAppEnabledByAdmin,
  WA_CHANNEL,
  WA_THROTTLE_DEFAULTS,
  type WaThrottleDeps,
} from '../wa-throttle.js';

function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function isAdmin(req: FastifyRequest, ctx: AuthContext): boolean {
  const tok = req.headers['x-admin-token'];
  if (!ctx.config.adminToken || typeof tok !== 'string') return false;
  return safeStringEqual(tok, ctx.config.adminToken);
}

function makeThrottleDeps(ctx: AuthContext): WaThrottleDeps {
  return {
    storage: ctx.storage,
    config: WA_THROTTLE_DEFAULTS,
    nowSeconds: () => Math.floor(ctx.now() / 1000),
    log: (msg, meta) => ctx.log.info(meta ?? {}, msg),
  };
}

export async function registerChannels(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  // ---- Public read ------------------------------------------------
  app.get('/v1/auth/channels', async (_req, reply) => {
    const wa = getWhatsAppAvailability(makeThrottleDeps(ctx));
    // Email and SMS aren't auto-throttled today; they appear here so
    // the modal's render logic has a single source. Add per-channel
    // state rows later if either grows its own throttle.
    const payload = {
      whatsapp: {
        available: wa.enabled,
        // Only surface the reason when DISABLED. Surfacing an admin
        // reason like "TV night" while the channel is enabled would
        // be confusing UX.
        reason: wa.enabled ? null : wa.reason,
      },
      email: { available: true, reason: null },
      sms: { available: true, reason: null },
      telegram: { available: true, reason: null },
    };
    // Short-cache: a channel flip needs to reach clients fast, but a
    // 10s edge cache still absorbs a thundering herd of modal opens.
    reply.header(
      'Cache-Control',
      'public, max-age=10, s-maxage=10, stale-while-revalidate=30',
    );
    return reply.send(payload);
  });

  // ---- Admin flip -------------------------------------------------
  app.post<{
    Params: { channel: string };
    Body: { enabled?: boolean; reason?: string };
  }>('/v1/auth/admin/channels/:channel', async (req, reply) => {
    if (!isAdmin(req, ctx)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const channel = (req.params.channel ?? '').trim().toLowerCase();
    if (channel !== WA_CHANNEL) {
      // Today we only support flipping WhatsApp. SMS / email aren't
      // sender-rate-limited the same way and don't need a flag.
      return reply.code(400).send({ error: 'unsupported_channel' });
    }
    const body = req.body ?? {};
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled_required' });
    }
    const reason = (body.reason ?? '').trim() || 'no reason given';
    if (reason.length > 200) {
      return reply.code(400).send({ error: 'reason_too_long' });
    }
    const updated = setWhatsAppEnabledByAdmin(
      makeThrottleDeps(ctx),
      body.enabled,
      reason,
    );
    reply.header('Cache-Control', 'no-store');
    return reply.send({
      ok: true,
      channel: updated.channel,
      enabled: updated.enabled,
      reason: updated.reason,
      source: updated.source,
      changedAt: updated.changedAt,
    });
  });
}
