/**
 * Smoke tests for the host-city lookup module.
 *
 * Coverage:
 *  - `hostCityById` resolves a known id to the expected record.
 *  - `hostCityById` returns `undefined` for an unknown id (defensive).
 *  - `hostCityByMatchNumber` walks fixtures.json → host_city_id and
 *    surfaces the rich HostCity.
 *  - `kickoffIsoByMatchNumber` returns the canonical kickoff for a
 *    fixture by match_number.
 *
 * The data file is loaded statically at import time, so these tests
 * also act as a guard against accidental schema drift in
 * `data/fifa-wc-2026/host-cities.json` or `fixtures.json`.
 */

import { describe, expect, it } from "vitest";

import {
  hostCityById,
  hostCityByMatchNumber,
  kickoffIsoByMatchNumber,
  allHostCities,
} from "../lib/host-cities";

describe("hostCityById", () => {
  it("resolves a known id to the full record", () => {
    const c = hostCityById("mexico_city");
    expect(c).toBeDefined();
    expect(c?.city).toBe("Mexico City");
    expect(c?.country).toBe("MX");
    expect(c?.stadium).toBe("Estadio Azteca");
    expect(c?.stadium_tournament_name).toBe("Estadio Banorte");
    expect(c?.timezone).toBe("America/Mexico_City");
    expect(typeof c?.capacity).toBe("number");
    expect(c?.capacity).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown id", () => {
    expect(hostCityById("atlantis")).toBeUndefined();
    expect(hostCityById(undefined)).toBeUndefined();
    expect(hostCityById(null)).toBeUndefined();
    expect(hostCityById("")).toBeUndefined();
  });

  it("covers every FIFA-2026 host city", () => {
    expect(allHostCities().length).toBe(16);
  });
});

describe("hostCityByMatchNumber", () => {
  it("resolves match 1 (MEX vs RSA) to Mexico City", () => {
    const c = hostCityByMatchNumber(1);
    expect(c?.id).toBe("mexico_city");
  });

  it("returns undefined for an out-of-range match number", () => {
    expect(hostCityByMatchNumber(999)).toBeUndefined();
  });
});

describe("kickoffIsoByMatchNumber", () => {
  it("returns the canonical kickoff for match 1", () => {
    expect(kickoffIsoByMatchNumber(1)).toBe("2026-06-11T19:00:00Z");
  });

  it("returns undefined for an out-of-range match number", () => {
    expect(kickoffIsoByMatchNumber(999)).toBeUndefined();
  });
});
