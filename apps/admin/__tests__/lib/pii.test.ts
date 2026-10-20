import { describe, expect, it } from "vitest";

import { maskEmail, maskPhone, maskPii, requestContext } from "@/lib/pii";

describe("maskEmail", () => {
  it("keeps two characters of a normal local part and the whole domain", () => {
    expect(maskEmail("aroha.walker@example.co.nz")).toBe("ar***@example.co.nz");
  });
  it("keeps one character of a short local part", () => {
    expect(maskEmail("tim@x.nz")).toBe("t***@x.nz");
  });
  it("handles empty, missing and malformed values without throwing", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail(undefined)).toBe("");
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("@lead")).toBe("***");
  });
  it("is idempotent, so masking twice (page then component) changes nothing", () => {
    const once = maskEmail("aroha.walker@example.co.nz");
    expect(maskEmail(once)).toBe(once);
  });
});

describe("maskPhone", () => {
  it("masks the middle of an E.164 number", () => {
    expect(maskPhone("+6421535832")).toBe("+64****5832");
  });
  it("passes short values through and empties null", () => {
    expect(maskPhone("1234")).toBe("1234");
    expect(maskPhone(null)).toBe("");
  });
  it("is idempotent", () => {
    const once = maskPhone("+6421535832");
    expect(maskPhone(once)).toBe(once);
  });
});

describe("maskPii", () => {
  it("dispatches on kind", () => {
    expect(maskPii("email", "a.b@c.nz")).toBe("a***@c.nz");
    expect(maskPii("phone", "+6421535832")).toBe("+64****5832");
  });
});

describe("requestContext", () => {
  it("takes the first forwarded hop and the user agent", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Mozilla/5.0 test" });
    expect(requestContext(h)).toEqual({ ip: "203.0.113.9", userAgent: "Mozilla/5.0 test" });
  });
  it("falls back to cf-connecting-ip and nulls when nothing is present", () => {
    expect(requestContext(new Headers({ "cf-connecting-ip": "198.51.100.4" }))).toEqual({ ip: "198.51.100.4", userAgent: null });
    expect(requestContext(new Headers())).toEqual({ ip: null, userAgent: null });
  });
  it("truncates a very long user agent", () => {
    const h = new Headers({ "user-agent": "x".repeat(1000) });
    expect(requestContext(h).userAgent).toHaveLength(300);
  });
});
