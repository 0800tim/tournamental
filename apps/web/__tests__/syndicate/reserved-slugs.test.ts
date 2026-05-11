/**
 * Reserved-slug coverage: every entry on the launch list must be
 * detected by `isReservedSlug`, plain names must not be falsely
 * detected.
 */
import { describe, expect, it } from "vitest";

import { RESERVED_SLUGS, isReservedSlug } from "@/lib/syndicate/reserved-slugs";

describe("RESERVED_SLUGS", () => {
  it("includes the agreed launch list", () => {
    const launchList = [
      "nba",
      "ufc",
      "world-cup",
      "nfl",
      "nrl",
      "mlb",
      "nhl",
      "t20",
      "ipl",
      "six-nations",
      "super-bowl",
      "premier-league",
      "play",
      "s",
      "api",
      "admin",
      "signup",
      "login",
      "auth",
      "home",
      "app",
      "www",
      "mail",
      "email",
      "support",
      "help",
      "about",
      "terms",
      "privacy",
      "legal",
      "tournamental",
    ];
    const reservedSet = new Set(RESERVED_SLUGS);
    for (const s of launchList) {
      expect(reservedSet.has(s)).toBe(true);
    }
  });

  it("does not flag plain user-chosen names", () => {
    expect(isReservedSlug("daves-mates")).toBe(false);
    expect(isReservedSlug("office-pool-2026")).toBe(false);
    expect(isReservedSlug("the-bookies")).toBe(false);
  });

  it("is case-insensitive on lookup", () => {
    expect(isReservedSlug("NBA")).toBe(true);
    expect(isReservedSlug("Admin")).toBe(true);
    expect(isReservedSlug("WORLD-CUP")).toBe(true);
  });
});
