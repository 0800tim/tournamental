/**
 * Phone number normalisation.
 *
 * We accept international format: a leading "+" plus 8–15 digits
 * (E.164). We do NOT support country-local-only formats (e.g. "021
 * 123 4567" without a leading +) because guessing the user's country
 * from IP and silently mutating their phone is a footgun.
 *
 * If we want to be friendlier in the UI we'll add a country picker
 * client-side and assemble the +CC prefix before submitting. The
 * server stays strict.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalisePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.replace(/[\s\-()]/g, '');
  if (!E164.test(trimmed)) return null;
  return trimmed;
}

/** Mask the middle digits of a phone for display: +6421***4567. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  const cc = phone.slice(0, 3); // "+64"
  const last = phone.slice(-3);
  return `${cc}${'*'.repeat(Math.max(0, phone.length - cc.length - last.length))}${last}`;
}
