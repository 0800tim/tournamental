/**
 * phone-hash, deterministic hashing for friend matching.
 *
 * Coverage:
 *   - canonicaliseE164 trims, drops spaces, requires + or 8-15 digits.
 *   - hashPhone produces a stable 64-hex string.
 *   - The same salt+phone always produces the same hash (essential
 *     for the matching protocol).
 *   - Different salts produce different hashes (no global rainbow table).
 *   - hashPhones dedups within the input list.
 *   - hashPhone throws when the salt is empty (fail closed).
 */

import { describe, expect, it } from "vitest";

import {
  canonicaliseE164,
  hashPhone,
  hashPhones,
} from "@/lib/auth/phone-hash";

describe("canonicaliseE164", () => {
  it("strips spaces, dashes, parens", () => {
    expect(canonicaliseE164("+64 21 (999) 000")).toBe("+6421999000");
    expect(canonicaliseE164("+64-21-999-000")).toBe("+6421999000");
  });
  it("accepts bare digits if they look like E.164", () => {
    expect(canonicaliseE164("6421999000")).toBe("+6421999000");
  });
  it("rejects too-short or non-numeric inputs", () => {
    expect(canonicaliseE164("abc123")).toBe("");
    expect(canonicaliseE164("12345")).toBe("");
    expect(canonicaliseE164("")).toBe("");
  });
});

describe("hashPhone", () => {
  it("is deterministic for the same salt + phone", () => {
    const a = hashPhone("+6421999000", "salt-abc");
    const b = hashPhone("+6421999000", "salt-abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes with the salt", () => {
    const a = hashPhone("+6421999000", "salt-abc");
    const b = hashPhone("+6421999000", "salt-xyz");
    expect(a).not.toBe(b);
  });

  it("changes with the phone", () => {
    const a = hashPhone("+6421999000", "salt-abc");
    const b = hashPhone("+6421999001", "salt-abc");
    expect(a).not.toBe(b);
  });

  it("throws when the salt is empty", () => {
    expect(() => hashPhone("+6421999000", "")).toThrow();
  });

  it("returns empty for empty phone (no salt-only hash leak)", () => {
    expect(hashPhone("", "salt-abc")).toBe("");
  });
});

describe("hashPhones", () => {
  it("dedups identical canonical phones", () => {
    const out = hashPhones(
      ["+6421999000", "+64 21 999 000", "6421999000", "+6421999001"],
      "salt-abc",
    );
    expect(out.length).toBe(2);
  });

  it("skips invalid inputs without crashing", () => {
    const out = hashPhones(["abc", "", "+6421999000"], "salt-abc");
    expect(out.length).toBe(1);
  });

  it("produces the same hashes the server would", () => {
    const out = hashPhones(["+6421999000"], "salt-abc");
    expect(out[0]).toBe(hashPhone("+6421999000", "salt-abc"));
  });
});
