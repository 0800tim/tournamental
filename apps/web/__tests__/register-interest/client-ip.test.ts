/**
 * lib/rate-limit/in-memory.ts: the identifier the register-interest
 * limiter keys on, and the window arithmetic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, clientIp, gcRateLimitBuckets } from "@/lib/rate-limit/in-memory";

function req(headers: Record<string, string>) {
  return new Request("https://play.tournamental.com/x", { headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("clientIp", () => {
  it("prefers the Cloudflare connecting IP over anything the client can set", () => {
    expect(
      clientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for hop, then x-real-ip, then anon", () => {
    expect(clientIp(req({ "x-forwarded-for": " 198.51.100.2 , 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIp(req({ "x-real-ip": "198.51.100.3" }))).toBe("198.51.100.3");
    expect(clientIp(req({}))).toBe("anon");
  });

  it("is spoofable without the Cloudflare header (documented in the review)", () => {
    // A direct-to-origin caller can pick its own bucket. Production only
    // listens on loopback behind the tunnel, where cf-connecting-ip is set.
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": "2.2.2.2" }))).toBe("2.2.2.2");
  });
});

describe("checkRateLimit", () => {
  it("allows max hits then refuses with a shrinking retry window, and resets after it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(checkRateLimit(key, 3, 10_000)).toEqual({ ok: true });
    expect(checkRateLimit(key, 3, 10_000)).toEqual({ ok: false, retryAfterMs: 10_000 });
    vi.setSystemTime(1_004_000);
    expect(checkRateLimit(key, 3, 10_000)).toEqual({ ok: false, retryAfterMs: 6_000 });
    vi.setSystemTime(1_010_000);
    expect(checkRateLimit(key, 3, 10_000)).toEqual({ ok: true });
  });

  it("keeps buckets per key", () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    expect(checkRateLimit(a, 1, 10_000).ok).toBe(true);
    expect(checkRateLimit(a, 1, 10_000).ok).toBe(false);
    expect(checkRateLimit(b, 1, 10_000).ok).toBe(true);
  });

  it("gc drops expired buckets so they start fresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const key = `gc:${Math.random()}`;
    checkRateLimit(key, 1, 1_000);
    expect(checkRateLimit(key, 1, 1_000).ok).toBe(false);
    vi.setSystemTime(5_002_000);
    gcRateLimitBuckets();
    expect(checkRateLimit(key, 1, 1_000).ok).toBe(true);
  });
});
