/**
 * OTP code generation.
 *
 * 6-digit numeric, cryptographically random. Same shape as auth-sms.
 *
 * Email magic-link path uses generateMagicToken() instead of a 6-digit
 * code; the token is embedded in a click URL so the email channel keeps
 * a one-tap UX.
 *
 * TODO(packages/auth-shared): lift the OTP helpers and apps/auth-sms/src/otp.ts
 * into a shared package once we have a third consumer beyond auth-sms +
 * dm-otp. The shared surface is small today so we tolerate the duplication.
 */

import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const MAGIC_TOKEN_BYTES = 24; // 192 bits, base64url ~32 chars

/** Generate a 6-digit numeric OTP, zero-padded. Cryptographically random. */
export function generateOtpCode(): string {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

/** Generate a magic-link click token (base64url, ~32 chars). */
export function generateMagicToken(): string {
  return randomBytes(MAGIC_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mask all but the last digit of a code for audit logs.
 *  "458291" -> "*****1"
 */
export function maskCode(code: string): string {
  if (!code) return '';
  if (code.length <= 1) return code;
  return `${'*'.repeat(code.length - 1)}${code.slice(-1)}`;
}

/**
 * HMAC-SHA256 hash of the OTP, salted by channel + external ID + a server
 * secret. Hash is what we store; we never persist the plaintext code.
 */
export function hashOtp(opts: {
  code: string;
  channel: string;
  externalId: string;
  secret: string;
}): string {
  const { code, channel, externalId, secret } = opts;
  return createHash('sha256')
    .update(`${secret}|${channel}|${externalId}|${code}`)
    .digest('hex');
}

/** Constant-time hex string equality. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
