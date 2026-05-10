/**
 * Logging helpers — masking PII before lines reach pino.
 *
 * Rules:
 *   - Never log full handles, full email addresses, or full phone
 *     numbers. Use maskExternalId() for any inbound platform id.
 *   - Never log plaintext OTP codes. Use maskCode() from ../otp.ts.
 *   - When in doubt, log a SHA-256 prefix instead of the value.
 */

import { createHash } from 'node:crypto';

export function maskExternalId(channel: string, raw: string): string {
  if (!raw) return '';
  if (channel === 'email') return maskEmail(raw);
  if (channel === 'whatsapp' || channel === 'signal') return maskPhone(raw);
  // Default: keep first 2 + last 2 chars only.
  if (raw.length <= 6) return `${raw[0] ?? '?'}***`;
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

export function maskEmail(raw: string): string {
  const at = raw.indexOf('@');
  if (at < 0) return '***';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `+${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

/** Stable, short, non-reversible id for log correlation. */
export function externalIdHash(channel: string, externalId: string): string {
  return createHash('sha256')
    .update(`${channel}|${externalId}`)
    .digest('hex')
    .slice(0, 12);
}
