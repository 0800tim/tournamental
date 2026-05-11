/**
 * Unit tests for the `/s/<guid>` resolver.
 *
 * Covers:
 *   1. syndicate-slug branch, matches an existing sample slug
 *   2. reserved-slug refusal, a reserved name never resolves to a
 *      syndicate even if some imaginary store had it
 *   3. user-guid branch, a valid UUID v4 hits the bracket lookup
 *   4. user-guid branch, a valid 16-char nanoid hits the bracket lookup
 *   5. not-found branch, a random string that's neither slug nor guid
 *
 * These tests prove the contract that `/s/[guid]/page.tsx` relies on
 * to pick which layout to render.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { resolveShareGuid } from "@/lib/share/resolve-guid";
import {
  isReservedSlug,
  isValidSlugShape,
} from "@/lib/syndicate/reserved-slugs";
import {
  isShareGuidShape,
  __unsafe_register_bracket_for_tests,
  __unsafe_clear_bracket_registry_for_tests,
  type BracketByGuid,
} from "@/lib/bracket/by-guid";
import {
  __unsafe_register_syndicate_for_tests,
  type SyndicateRecord,
} from "@/lib/syndicate/store";

const sampleBracket = (guid: string): BracketByGuid => ({
  bracket_id: guid,
  handle: "Anonymous",
  saved_at: "2026-05-11T12:00:00Z",
  tournament_id: "fifa-wc-2026",
  tournament_label: "FIFA World Cup 2026",
  champion: { code: "ARG", name: "Argentina", flag_emoji: "🇦🇷" },
  runner_up: { code: "FRA", name: "France", flag_emoji: "🇫🇷" },
  third_place: { code: "BRA", name: "Brazil", flag_emoji: "🇧🇷" },
  path_to_gold: [
    {
      stage: "r16",
      stage_label: "Round of 16",
      opponent_code: "AUS",
      opponent_name: "Australia",
      opponent_flag_emoji: "🇦🇺",
    },
    {
      stage: "qf",
      stage_label: "Quarter-final",
      opponent_code: "NED",
      opponent_name: "Netherlands",
      opponent_flag_emoji: "🇳🇱",
    },
    {
      stage: "sf",
      stage_label: "Semi-final",
      opponent_code: "CRO",
      opponent_name: "Croatia",
      opponent_flag_emoji: "🇭🇷",
    },
    {
      stage: "final",
      stage_label: "Final",
      opponent_code: "FRA",
      opponent_name: "France",
      opponent_flag_emoji: "🇫🇷",
    },
  ],
});

beforeEach(() => {
  __unsafe_clear_bracket_registry_for_tests();
});

describe("resolveShareGuid", () => {
  it("resolves a known syndicate slug to a 'syndicate' result", async () => {
    const res = await resolveShareGuid("argentina-pool");
    expect(res.kind).toBe("syndicate");
    if (res.kind === "syndicate") {
      expect(res.syndicate.slug).toBe("argentina-pool");
      expect(res.syndicate.name).toBe("Argentina Pool");
    }
  });

  it("refuses reserved slugs and falls through to not_found", async () => {
    for (const slug of ["nba", "world-cup", "admin", "play"]) {
      const res = await resolveShareGuid(slug);
      expect(res.kind, `slug=${slug}`).toBe("not_found");
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it("resolves a valid UUID v4 share guid to a 'user' result", async () => {
    const uuid = "4f5b3c7e-1d2f-4a8b-9c0d-1e2f3a4b5c6d";
    __unsafe_register_bracket_for_tests(uuid, sampleBracket(uuid));
    expect(isShareGuidShape(uuid)).toBe(true);
    const res = await resolveShareGuid(uuid);
    expect(res.kind).toBe("user");
    if (res.kind === "user") {
      expect(res.bracket.bracket_id).toBe(uuid);
      expect(res.bracket.champion.name).toBeTruthy();
      expect(res.bracket.path_to_gold.length).toBe(4);
    }
  });

  it("resolves a valid 16-char nanoid to a 'user' result", async () => {
    const nano = "AbCd1234efGH5678"; // 16 chars, alphanumeric
    __unsafe_register_bracket_for_tests(nano, sampleBracket(nano));
    expect(nano.length).toBe(16);
    expect(isShareGuidShape(nano)).toBe(true);
    const res = await resolveShareGuid(nano);
    expect(res.kind).toBe("user");
  });

  it("returns not_found for a random non-matching string", async () => {
    const res = await resolveShareGuid("hello world!!");
    expect(res.kind).toBe("not_found");
  });

  it("returns not_found when the guid shape is valid but the upstream lookup misses", async () => {
    // No __unsafe_register_bracket_for_tests call → the resolver hits
    // fetch, which in vitest's jsdom env is unimplemented/aborted, so
    // loadBracketFromGuid returns null and the resolver falls through.
    const uuid = "00000000-0000-4000-8000-000000000000";
    expect(isShareGuidShape(uuid)).toBe(true);
    const res = await resolveShareGuid(uuid);
    expect(res.kind).toBe("not_found");
  });

  it("prefers syndicate lookup over user lookup when both could match", async () => {
    // A 16-char slug that's ALSO a valid nanoid shape would normally
    // hit the user-guid branch second. Register a syndicate under that
    // exact slug and assert the syndicate wins.
    const slug = "syndicate-test1"; // 15 chars
    const longerSlug = `${slug}9`; // 16 chars to satisfy nanoid shape
    const record: SyndicateRecord = {
      slug: longerSlug,
      name: "Syndicate Test",
      owner_handle: "tester",
      owner_country_emoji: "🇳🇿",
      tournament_id: "fifa-wc-2026",
      tournament_label: "FIFA World Cup 2026",
      created_at: "2026-05-01T00:00:00Z",
      picks_made: 0,
      members: [],
    };
    __unsafe_register_syndicate_for_tests(record);
    expect(isValidSlugShape(longerSlug)).toBe(true);
    expect(isShareGuidShape(longerSlug)).toBe(true);
    const res = await resolveShareGuid(longerSlug);
    expect(res.kind).toBe("syndicate");
  });
});

describe("isReservedSlug", () => {
  it("matches case-insensitively", () => {
    expect(isReservedSlug("NBA")).toBe(true);
    expect(isReservedSlug("Premier-League")).toBe(true);
    expect(isReservedSlug("not-reserved-name")).toBe(false);
  });
});

describe("isValidSlugShape", () => {
  it("accepts kebab alphanumerics within length bounds", () => {
    expect(isValidSlugShape("tim-friends")).toBe(true);
    expect(isValidSlugShape("a1b")).toBe(true);
  });

  it("rejects leading/trailing hyphens and consecutive hyphens", () => {
    expect(isValidSlugShape("-leading")).toBe(false);
    expect(isValidSlugShape("trailing-")).toBe(false);
    expect(isValidSlugShape("double--hyphen")).toBe(false);
  });

  it("rejects too-short or too-long strings", () => {
    expect(isValidSlugShape("ab")).toBe(false);
    expect(isValidSlugShape("a".repeat(41))).toBe(false);
  });
});

describe("isShareGuidShape", () => {
  it("accepts UUID v4", () => {
    expect(isShareGuidShape("4f5b3c7e-1d2f-4a8b-9c0d-1e2f3a4b5c6d")).toBe(true);
  });

  it("rejects non-v4 UUIDs", () => {
    // UUID with version digit '1', not v4
    expect(isShareGuidShape("4f5b3c7e-1d2f-1a8b-9c0d-1e2f3a4b5c6d")).toBe(false);
  });

  it("accepts 16-char nanoid alphabet", () => {
    expect(isShareGuidShape("AbCd1234efGH5678")).toBe(true);
    expect(isShareGuidShape("a-b_c-d_e-f_g_hI")).toBe(true);
  });

  it("rejects strings of the wrong length", () => {
    expect(isShareGuidShape("short")).toBe(false);
    expect(isShareGuidShape("a".repeat(20))).toBe(false);
  });
});
