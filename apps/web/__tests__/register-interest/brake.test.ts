/**
 * The global brake: env parsing, the ceiling, Retry-After and the
 * throttled operator warning. Buckets are reset between cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBAL_BRAKE_DEFAULT_PER_MINUTE,
  GLOBAL_BRAKE_KEY,
  __resetGlobalBrakeWarn,
  checkGlobalBrake,
  globalCeilingPerMinute,
} from "@/lib/register-interest/brake";
import { resetRateLimitBuckets } from "@/lib/rate-limit/in-memory";

beforeEach(() => {
  resetRateLimitBuckets(GLOBAL_BRAKE_KEY);
  __resetGlobalBrakeWarn();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("globalCeilingPerMinute", () => {
  it("defaults to 60 when unset, blank, non-numeric, zero or negative", () => {
    for (const v of [undefined, "", "  ", "abc", "0", "-5", "1e3", "12.5"]) {
      expect(globalCeilingPerMinute(v), String(v)).toBe(GLOBAL_BRAKE_DEFAULT_PER_MINUTE);
    }
  });
  it("accepts a positive integer, trimmed", () => {
    expect(globalCeilingPerMinute("3")).toBe(3);
    expect(globalCeilingPerMinute(" 250 ")).toBe(250);
  });
});

describe("checkGlobalBrake", () => {
  it("allows the ceiling, then refuses with a Retry-After inside the minute", () => {
    vi.stubEnv("REGISTER_INTEREST_GLOBAL_PER_MINUTE", "3");
    expect(checkGlobalBrake().ok).toBe(true);
    expect(checkGlobalBrake().ok).toBe(true);
    expect(checkGlobalBrake().ok).toBe(true);
    const r = checkGlobalBrake();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ceiling).toBe(3);
      expect(r.retryAfterMs).toBeGreaterThan(0);
      expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("warns an operator at most once a minute while engaged", () => {
    vi.stubEnv("REGISTER_INTEREST_GLOBAL_PER_MINUTE", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let t = 1_000_000;
    const now = () => t;
    expect(checkGlobalBrake(now).ok).toBe(true);
    expect(checkGlobalBrake(now).ok).toBe(false);
    expect(checkGlobalBrake(now).ok).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    t += 61_000;
    // The bucket has not reset (it is keyed on Date.now, not the injected clock),
    // but the warn throttle has, so the next refusal logs again.
    checkGlobalBrake(now);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("uses the default ceiling when the env value is nonsense", () => {
    vi.stubEnv("REGISTER_INTEREST_GLOBAL_PER_MINUTE", "lots");
    for (let i = 0; i < GLOBAL_BRAKE_DEFAULT_PER_MINUTE; i++) expect(checkGlobalBrake().ok).toBe(true);
    expect(checkGlobalBrake().ok).toBe(false);
  });
});
