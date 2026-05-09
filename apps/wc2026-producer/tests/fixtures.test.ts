/**
 * Tests for the producer's fixture loader.
 */

import { describe, expect, it } from "vitest";
import { findFixture, fixturesByStage, loadFixtures } from "../src/fixtures.js";

describe("loadFixtures", () => {
  it("loads 104 matches from the canonical data file", () => {
    const bundle = loadFixtures();
    expect(bundle.match_count).toBe(104);
    expect(bundle.fixtures).toHaveLength(104);
  });

  it("first match is the Mexico City opener", () => {
    const bundle = loadFixtures();
    const first = bundle.fixtures[0];
    expect(first.match_number).toBe(1);
    expect(first.stage).toBe("group_a");
    expect(first.host_city_id).toBe("mexico_city");
  });

  it("last match is the final at MetLife", () => {
    const bundle = loadFixtures();
    const last = bundle.fixtures[103];
    expect(last.match_number).toBe(104);
    expect(last.stage).toBe("final");
    expect(last.host_city_id).toBe("new_york_new_jersey");
  });
});

describe("findFixture", () => {
  it("returns the fixture for a valid match number", () => {
    const bundle = loadFixtures();
    const f = findFixture(bundle, 1);
    expect(f).toBeDefined();
    expect(f?.match_number).toBe(1);
  });

  it("returns undefined for an invalid match number", () => {
    const bundle = loadFixtures();
    expect(findFixture(bundle, 999)).toBeUndefined();
  });
});

describe("fixturesByStage", () => {
  it("returns 16 R32 matches", () => {
    const bundle = loadFixtures();
    expect(fixturesByStage(bundle, "r32")).toHaveLength(16);
  });

  it("returns 1 final", () => {
    const bundle = loadFixtures();
    expect(fixturesByStage(bundle, "final")).toHaveLength(1);
  });
});
