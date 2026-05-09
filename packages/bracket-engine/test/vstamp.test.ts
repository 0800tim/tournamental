/**
 * VStamp tests. Hash determinism, signature verification, key separation,
 * canonical-JSON ordering robustness.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJSON,
  hashBracket,
  signBracket,
  verifyBracket,
} from "../src/vstamp.js";
import type { SignerKey } from "../src/vstamp.js";
import type { BracketPrediction } from "../src/index.js";

const KEY: SignerKey = {
  key_id: "vt-2026",
  bytes: new Uint8Array(32).fill(7), // deterministic for tests
};

const KEY_ALT: SignerKey = {
  key_id: "vt-2026-alt",
  bytes: new Uint8Array(32).fill(9),
};

function basePrediction(): BracketPrediction {
  return {
    tournament_id: "fifa-wc-2026",
    user_id: "u_alice",
    groups: [
      { group_id: "A", order: ["FRA", "ARG", "BRA", "ENG", "USA", "MAR"] },
      { group_id: "B", order: ["GER", "ESP", "POR", "NLD", "JPN", "URU"] },
    ],
    best_thirds: ["BRA"],
    best_fourths: ["ENG"],
    knockouts: [
      { match_id: "r32_01", winner: "FRA" },
      { match_id: "r32_02", winner: "GER" },
    ],
    locks: [
      {
        key: "knockout:r32_01",
        locked_at_utc: "2026-06-10T12:00:00Z",
        market_implied_at_lock: 0.42,
      },
    ],
    updated_at_utc: "2026-06-10T12:00:00Z",
  };
}

describe("vstamp — canonicalJSON", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalJSON({ b: 2, a: 1 })).toBe(`{"a":1,"b":2}`);
    expect(canonicalJSON({ x: { z: 3, y: 2 } })).toBe(`{"x":{"y":2,"z":3}}`);
  });

  it("preserves array order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe(`[3,1,2]`);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJSON(NaN)).toThrow();
    expect(() => canonicalJSON(Infinity)).toThrow();
  });
});

describe("vstamp — hash determinism", () => {
  it("same content → same hash", () => {
    const p = basePrediction();
    expect(hashBracket(p)).toBe(hashBracket(p));
  });

  it("changing knockout pick changes hash", () => {
    const p1 = basePrediction();
    const p2 = { ...p1, knockouts: [{ match_id: "r32_01", winner: "ENG" }, p1.knockouts[1]] };
    expect(hashBracket(p1)).not.toBe(hashBracket(p2));
  });

  it("changing lock state does NOT change content hash", () => {
    const p1 = basePrediction();
    const p2 = { ...p1, locks: [] };
    expect(hashBracket(p1)).toBe(hashBracket(p2));
  });

  it("changing updated_at_utc does NOT change content hash", () => {
    const p1 = basePrediction();
    const p2 = { ...p1, updated_at_utc: "2099-01-01T00:00:00Z" };
    expect(hashBracket(p1)).toBe(hashBracket(p2));
  });

  it("knockout order does not affect hash (sorted internally)", () => {
    const p1 = basePrediction();
    const p2 = {
      ...p1,
      knockouts: [...p1.knockouts].reverse(),
    };
    expect(hashBracket(p1)).toBe(hashBracket(p2));
  });
});

describe("vstamp — signature verifies", () => {
  it("verifies a signed envelope", () => {
    const p = basePrediction();
    const env = signBracket(p, KEY);
    expect(verifyBracket(env, p, KEY)).toBe(true);
  });

  it("rejects with the wrong key", () => {
    const p = basePrediction();
    const env = signBracket(p, KEY);
    expect(verifyBracket(env, p, KEY_ALT)).toBe(false);
  });

  it("rejects when the prediction is tampered", () => {
    const p = basePrediction();
    const env = signBracket(p, KEY);
    const tampered = { ...p, knockouts: [{ match_id: "r32_01", winner: "ESP" }, p.knockouts[1]] };
    expect(verifyBracket(env, tampered, KEY)).toBe(false);
  });

  it("rejects when key_id mismatches", () => {
    const p = basePrediction();
    const env = signBracket(p, KEY);
    expect(verifyBracket({ ...env, key_id: "vt-other" }, p, KEY)).toBe(false);
  });

  it("envelope is fully deterministic given a fixed now_utc", () => {
    const p = basePrediction();
    const a = signBracket(p, KEY, { now_utc: "2026-06-10T12:00:00Z" });
    const b = signBracket(p, KEY, { now_utc: "2026-06-10T12:00:00Z" });
    expect(a).toEqual(b);
  });
});
