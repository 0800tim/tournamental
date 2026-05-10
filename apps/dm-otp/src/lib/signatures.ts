/**
 * Webhook signature verification helpers.
 *
 * The contract: every webhook authenticator runs BEFORE we touch the
 * code generator. If the signature fails, we 401 — no further work, no
 * audit row, no observable side-effect to an unauthenticated caller.
 *
 * Three flavours of signature here:
 *   - Telegram: header `X-Telegram-Bot-Api-Secret-Token` is a literal
 *     shared secret; constant-time string compare.
 *   - Aiva (WhatsApp): `X-Aiva-Signature: sha256=<hex>` over the raw
 *     request body using AIVA_WEBHOOK_SECRET as the HMAC key.
 *   - Meta (Messenger + Instagram): `X-Hub-Signature-256: sha256=<hex>`
 *     over the raw body using META_APP_SECRET.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyTelegramSecret(opts: {
  header: string | undefined;
  expected: string;
}): boolean {
  if (!opts.expected) return false;
  if (typeof opts.header !== 'string' || !opts.header) return false;
  return timingSafeStringEqual(opts.header, opts.expected);
}

/** Compute hex HMAC-SHA256 of the raw body. */
export function hmacSha256Hex(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify an `<scheme>=<hex>` style header (used by both Aiva and Meta).
 * The expected scheme is `sha256`.
 */
export function verifyHmacSha256Header(opts: {
  header: string | undefined;
  rawBody: string;
  secret: string;
}): boolean {
  if (!opts.secret) return false;
  if (typeof opts.header !== 'string' || !opts.header) return false;
  const idx = opts.header.indexOf('=');
  if (idx <= 0) return false;
  const scheme = opts.header.slice(0, idx).toLowerCase().trim();
  const provided = opts.header.slice(idx + 1).trim();
  if (scheme !== 'sha256') return false;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
  const expected = hmacSha256Hex(opts.secret, opts.rawBody);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided.toLowerCase(), 'hex'),
    );
  } catch {
    return false;
  }
}
