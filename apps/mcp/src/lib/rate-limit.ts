/**
 * Per-tier rate limiter.
 *
 * Three buckets, all keyed independently:
 *   - public: 60 req/min per IP
 *   - user:   600 req/min per user-key prefix
 *   - admin:  6000 req/min per admin-key prefix
 *
 * Implementation: in-memory token bucket with a 60-second window.
 * TODO: when the game-service's Redis becomes a shared dependency,
 * swap in a `RedisRateLimiter` that uses the same INCR + EXPIRE
 * pattern the game service uses (see @vtorn/affiliate-router for
 * the precedent). Until then the in-memory implementation is fine
 * for a single MCP host.
 */

export type Tier = 'public' | 'user' | 'admin';

export const TIER_LIMITS: Record<Tier, number> = {
  public: 60,
  user: 600,
  admin: 6000,
};

const WINDOW_MS = 60_000;

interface Bucket {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  check(tier: Tier, key: string): RateLimitResult {
    const limit = TIER_LIMITS[tier];
    const now = this.nowMs();
    const bucketKey = `${tier}:${key}`;
    const bucket = this.buckets.get(bucketKey);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      this.buckets.set(bucketKey, { windowStart: now, count: 1 });
      return { allowed: true, remaining: limit - 1, resetMs: WINDOW_MS, limit };
    }
    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    const resetMs = WINDOW_MS - (now - bucket.windowStart);
    return {
      allowed: bucket.count <= limit,
      remaining,
      resetMs,
      limit,
    };
  }

  /** Test helper. */
  reset(): void {
    this.buckets.clear();
  }
}
