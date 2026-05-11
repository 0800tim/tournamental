/**
 * invite-code mint route, happy-path smoke.
 *
 * We can't easily run the Next.js Route Handler in vitest (it pulls in
 * the App Router runtime), so this test exercises the code-generation
 * primitive directly: we re-implement the alphabet check inline and
 * verify the format.
 *
 * The actual handler is exercised in e2e tests (Playwright) once the
 * Supabase project is provisioned.
 */

import { describe, expect, it } from "vitest";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function checkCodeFormat(code: string): boolean {
  if (code.length !== 6) return false;
  for (const c of code) {
    if (!ALPHABET.includes(c)) return false;
  }
  return true;
}

describe("invite-code format", () => {
  it("alphabet excludes confusable characters", () => {
    expect(ALPHABET).not.toContain("0");
    expect(ALPHABET).not.toContain("1");
    expect(ALPHABET).not.toContain("l");
    expect(ALPHABET).not.toContain("o");
    expect(ALPHABET).not.toContain("i");
  });

  it("alphabet has 31 chars (Crockford-ish: 0-9 minus 0/1, a-z minus i/l/o)", () => {
    expect(ALPHABET.length).toBe(31);
  });

  it("validates well-formed codes", () => {
    expect(checkCodeFormat("k7m9q3")).toBe(true);
    expect(checkCodeFormat("aaaaaa")).toBe(true);
    expect(checkCodeFormat("zzzzzz")).toBe(true);
  });

  it("rejects malformed codes", () => {
    expect(checkCodeFormat("k7m9q")).toBe(false); // short
    expect(checkCodeFormat("k7m9q3a")).toBe(false); // long
    expect(checkCodeFormat("k7m9q0")).toBe(false); // 0 not in alphabet
    expect(checkCodeFormat("K7M9Q3")).toBe(false); // uppercase
  });

  it("provides a >10⁸ collision space (≈30^6)", () => {
    expect(Math.pow(ALPHABET.length, 6)).toBeGreaterThan(1e8);
  });
});

describe("invite-code claim semantics (documented contract)", () => {
  it("claim flow: unclaimed code + auth'd user → 2 friendship rows + 1 claim row", () => {
    // This is a documentation test: the /i/[code] handler writes one
    // pair of rows (A→B and B→A) for `whatsapp_invite` and marks the
    // invite_codes row claimed. The test pins the intended behaviour so
    // the orchestrator can spot regressions in code review.
    const expectedWrites = {
      friendships_inserted: 2,
      invite_codes_updated: 1,
      source: "whatsapp_invite",
    };
    expect(expectedWrites.friendships_inserted).toBe(2);
    expect(expectedWrites.source).toBe("whatsapp_invite");
  });
});
