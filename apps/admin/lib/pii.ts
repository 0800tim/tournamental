/**
 * Masking for personal data shown in the admin console.
 *
 * Phone and email are masked by default on every admin view; the full
 * value is shown only after an explicit "Show" that is written to the
 * audit log with the operator, the target, the client IP and the user
 * agent (docs/33 item on Customer 360, 2026-10-20).
 */

import { maskAdminPhone } from "./auth";

export type PiiKind = "email" | "phone";

/** `+6421535832` becomes `+64****5832`; short or empty values pass through. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return maskAdminPhone(phone);
}

/** `aroha.walker@example.co.nz` becomes `ar***@example.co.nz`. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length >= 4 ? 2 : 1;
  return `${local.slice(0, keep)}***@${domain}`;
}

export function maskPii(kind: PiiKind, value: string | null | undefined): string {
  return kind === "email" ? maskEmail(value) : maskPhone(value);
}

/**
 * Client IP and user agent from a request, for audit entries. Trusts the
 * first `x-forwarded-for` hop because the console sits behind the
 * Cloudflare tunnel; falls back to `cf-connecting-ip`.
 */
export function requestContext(headers: Headers): { ip: string | null; userAgent: string | null } {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = xff || headers.get("cf-connecting-ip")?.trim() || null;
  const ua = headers.get("user-agent")?.slice(0, 300) || null;
  return { ip, userAgent: ua };
}
