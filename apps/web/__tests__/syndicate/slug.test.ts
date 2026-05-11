/**
 * Slug validator unit tests.
 */
import { describe, expect, it } from "vitest";

import { SLUG_MAX_LEN, deriveSlug, validateSlug } from "@/lib/syndicate/slug";
import { isValidSlugShape } from "@/lib/syndicate/reserved-slugs";

describe("isValidSlugShape (used by the signup form)", () => {
  it("accepts simple slugs", () => {
    expect(isValidSlugShape("daves-mates")).toBe(true);
    expect(isValidSlugShape("abc")).toBe(true);
    expect(isValidSlugShape("a1b2c3")).toBe(true);
    expect(isValidSlugShape("dave-and-tim-and-the-lads")).toBe(true);
  });

  it("rejects slugs shorter than 3 chars", () => {
    expect(isValidSlugShape("ab")).toBe(false);
    expect(isValidSlugShape("")).toBe(false);
  });

  it("rejects slugs longer than 40 chars", () => {
    const tooLong = "x".repeat(41);
    expect(isValidSlugShape(tooLong)).toBe(false);
    const justOk = "x".repeat(40);
    expect(isValidSlugShape(justOk)).toBe(true);
  });

  it("rejects leading or trailing hyphens", () => {
    expect(isValidSlugShape("-daves")).toBe(false);
    expect(isValidSlugShape("daves-")).toBe(false);
    expect(isValidSlugShape("-")).toBe(false);
  });

  it("rejects consecutive hyphens (shape contract)", () => {
    expect(isValidSlugShape("daves--mates")).toBe(false);
  });

  it("rejects upper case, spaces, special chars", () => {
    expect(isValidSlugShape("Daves-Mates")).toBe(false);
    expect(isValidSlugShape("daves mates")).toBe(false);
    expect(isValidSlugShape("daves_mates")).toBe(false);
    expect(isValidSlugShape("daves.mates")).toBe(false);
    expect(isValidSlugShape("daves@mates")).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — guarding runtime behaviour.
    expect(isValidSlugShape(null)).toBe(false);
    // @ts-expect-error
    expect(isValidSlugShape(undefined)).toBe(false);
    // @ts-expect-error
    expect(isValidSlugShape(123)).toBe(false);
  });
});

describe("validateSlug", () => {
  it("returns invalid for malformed", () => {
    expect(validateSlug("X")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("a")).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns reserved for reserved names", () => {
    expect(validateSlug("nba")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("world-cup")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("admin")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("tournamental")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("terms")).toEqual({ ok: false, reason: "reserved" });
    expect(validateSlug("privacy")).toEqual({ ok: false, reason: "reserved" });
  });

  it("returns ok for a legitimate slug", () => {
    expect(validateSlug("daves-mates")).toEqual({ ok: true });
    expect(validateSlug("office-pool-2026")).toEqual({ ok: true });
  });
});

describe("deriveSlug", () => {
  it("kebab-cases a plain phrase", () => {
    expect(deriveSlug("Dave's Mates")).toBe("dave-s-mates");
    expect(deriveSlug("Office Pool 2026")).toBe("office-pool-2026");
  });

  it("strips diacritics", () => {
    expect(deriveSlug("Café Crew")).toBe("cafe-crew");
    expect(deriveSlug("Olé olé")).toBe("ole-ole");
  });

  it("collapses runs of separators", () => {
    expect(deriveSlug("dave   and   tim")).toBe("dave-and-tim");
    expect(deriveSlug("dave---tim")).toBe("dave-tim");
  });

  it("trims leading/trailing hyphens", () => {
    expect(deriveSlug("!!! party !!!")).toBe("party");
    expect(deriveSlug("--dave--")).toBe("dave");
  });

  it("returns empty string for slug-incompatible input", () => {
    expect(deriveSlug("!!!")).toBe("");
    expect(deriveSlug("   ")).toBe("");
    expect(deriveSlug("")).toBe("");
  });

  it("truncates to SLUG_MAX_LEN without leaving a trailing hyphen", () => {
    const input = "the-very-long-name-of-our-amazing-pool-of-mates-for-the-cup";
    const out = deriveSlug(input);
    expect(out.length).toBeLessThanOrEqual(SLUG_MAX_LEN);
    expect(out.endsWith("-")).toBe(false);
  });
});
