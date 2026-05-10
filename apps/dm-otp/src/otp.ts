/**
 * OTP code generation.
 *
 * 6-digit numeric, cryptographically random. Same shape as auth-sms.
 *
 * TODO(packages/auth-shared): lift this and apps/auth-sms/src/otp.ts into
 * a shared package once we have a third consumer. Today there are two
 * (auth-sms phone OTP, dm-otp DM OTP) and the shared surface is small.
 */

import { randomInt } from 'node:crypto';

export const OTP_LENGTH = 6;

/** Generate a 6-digit numeric OTP, zero-padded. Cryptographically random. */
export function generateOtpCode(): string {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
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
