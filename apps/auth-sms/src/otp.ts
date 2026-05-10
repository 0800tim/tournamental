/**
 * OTP generation, hashing, and verification.
 *
 * Codes are 6-digit numeric strings (000000–999999) so they fit on a
 * phone keypad and play nicely with the WebOTP API. Hashes use HMAC-
 * SHA-256 with a server-side secret so an attacker who reads the DB
 * cannot brute-force the 1M-entry preimage space; timing-safe compare
 * on verify.
 *
 * TTL: 10 minutes. Tunable via OTP_TTL_SECONDS (defaults below).
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes
export const DEFAULT_MAX_VERIFY_ATTEMPTS = 5;

/** Generate a 6-digit numeric OTP, zero-padded. Cryptographically random. */
export function generateOtp(): string {
  // randomInt is uniform; use a single 0..1_000_000 draw and pad.
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

/**
 * Hash an OTP for storage. We bind to phone + channel so a leaked hash
 * for one phone cannot be replayed against another (mitigates rainbow
 * tables across the entire OTP table).
 */
export function hashOtp(opts: {
  code: string;
  phone: string;
  channel: 'sms' | 'whatsapp';
  secret: string;
}): string {
  const { code, phone, channel, secret } = opts;
  const h = createHmac('sha256', secret);
  h.update(`${phone}|${channel}|${code}`);
  return h.digest('hex');
}

/**
 * Constant-time comparison of two hex hashes of equal length.
 * Returns false (not throws) on length mismatch so the caller can
 * surface a uniform error.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  // Strict hex check before allocating Buffers.
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Format the SMS body for WebOTP autofill on iOS / Android browsers.
 * The trailing `@<host> #<code>` line is the WebOTP API's required
 * format (see https://web.dev/web-otp/). Browsers parse this and
 * surface a one-tap autofill prompt above the keyboard.
 */
export function formatSmsBody(opts: {
  code: string;
  appHost: string; // e.g. "tournamental.com"
  productName?: string; // e.g. "Tournamental"
}): string {
  const product = opts.productName ?? 'Tournamental';
  return (
    `Your ${product} code is ${opts.code}.\n` +
    `\n` +
    `@${opts.appHost} #${opts.code}`
  );
}

/** WhatsApp message body — no WebOTP suffix needed (different surface). */
export function formatWhatsAppBody(opts: {
  code: string;
  productName?: string;
}): string {
  const product = opts.productName ?? 'Tournamental';
  return `Your ${product} code is *${opts.code}*. Expires in 10 minutes.`;
}
