/**
 * GET /v1/auth/whatsapp/pairing-qr
 *
 * Operator-only endpoint that returns the latest WhatsApp pairing QR
 * as an HTML page so the operator can scan it from their phone.
 *
 * Auth: requires the X-Admin-Token header to match config.adminToken.
 *       This is *not* part of the user session model; it's a bootstrap
 *       channel for first-run pairing of the in-process Baileys client
 *       (or, when using the Aiva gateway transport, a passthrough to
 *       the gateway's QR endpoint).
 *
 * If the session is already paired (or the transport doesn't expose a
 * QR), responds with 204.
 */

import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../context.js';

export async function registerWhatsAppPairing(
  app: FastifyInstance,
  ctx: AuthContext,
): Promise<void> {
  app.get('/v1/auth/whatsapp/pairing-qr', async (req, reply) => {
    const tok = req.headers['x-admin-token'];
    if (
      !ctx.config.adminToken ||
      typeof tok !== 'string' ||
      tok !== ctx.config.adminToken
    ) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const qr = await ctx.waSender.pairingQr();
    if (!qr) return reply.code(204).send();

    // If the QR is already a data URL (Baileys path), inline it.
    // If it's a raw string (gateway path), render to a data URL.
    const dataUrl = qr.startsWith('data:')
      ? qr
      : `data:text/plain;charset=utf-8,${encodeURIComponent(qr)}`;

    reply.header('Cache-Control', 'no-store');
    reply.type('text/html; charset=utf-8');
    return reply.send(
      `<!doctype html><html><head><meta charset="utf-8"><title>VTourn WhatsApp pairing</title>` +
        `<style>body{font-family:system-ui;background:#0b0b0e;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}` +
        `.card{background:#15151a;padding:24px;border-radius:16px;text-align:center;max-width:420px}` +
        `img{width:320px;height:320px;background:#fff;padding:8px;border-radius:8px}</style></head>` +
        `<body><div class="card"><h1>Scan to pair WhatsApp</h1>` +
        `<p>WhatsApp → Settings → Linked Devices → Link a Device</p>` +
        (qr.startsWith('data:image/')
          ? `<img src="${dataUrl}" alt="WhatsApp pairing QR">`
          : `<pre style="white-space:pre-wrap;word-break:break-all;background:#000;padding:8px;border-radius:8px">${qr.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</pre>`) +
        `<p style="opacity:.6;font-size:12px">QR rotates every ~20s. Refresh if it expires.</p>` +
        `</div></body></html>`,
    );
  });
}
