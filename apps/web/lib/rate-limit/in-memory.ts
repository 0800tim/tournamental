/**
 * Tiny in-memory token-bucket rate limiter.
 *
 * Used as a v0.1 brake on hot endpoints (manage-auth OTP, widget-otp
 * request/verify, public handle-check) where a Redis-backed limiter
 * is overkill but a naked endpoint is a denial-of-service / OTP-spam
 * surface.
 *
 * TODO: when Redis is wired into apps/web (see docs/22), swap this
 * for a TTL-keyed INCR + EXPIRE so per-pod state isn't isolated.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets: Map<string, Bucket> = new Map();

/**
 * Increment the counter for `key`. Returns `{ ok: true }` while under
 * the limit, or `{ ok: false, retryAfterMs }` once the bucket is full.
 *
 * The bucket auto-resets after `windowMs` since the FIRST hit, so the
 * "window" is rolling-per-bucket rather than fixed wall-clock.
 *
 * Memory: every distinct key adds a small Map entry; callers should
 * keep keys bounded (per IP + per slug is fine; never use unbounded
 * user input directly as a key without normalisation).
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true };
}

/**
 * Pull a useful client identifier from a Next.js Request. Prefers the
 * Cloudflare connecting IP, then x-forwarded-for, then a stable
 * fallback so the limiter still works in dev where neither is set.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anon"
  );
}

/**
 * Best-effort GC: prune buckets that have already reset. Called
 * opportunistically from `checkRateLimit` is overkill in v0.1 — the
 * map stays small enough in practice — but exported here so tests +
 * higher-traffic endpoints can call it explicitly.
 */
export function gcRateLimitBuckets(): void {
  const now = Date.now();
  for (const [k, b] of buckets.entries()) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}
