import { describe, expect, it } from "vitest";

import {
  countriesFromAllowed,
  MAX_ALLOWED_COUNTRIES,
  parseAllowedCountries,
  phoneMatchesAllowed,
  serialiseAllowedCountries,
} from "../country-gate";

describe("parseAllowedCountries", () => {
  it("returns empty array for null / undefined / empty", () => {
    expect(parseAllowedCountries(null)).toEqual([]);
    expect(parseAllowedCountries(undefined)).toEqual([]);
    expect(parseAllowedCountries("")).toEqual([]);
  });

  it("parses a single dial code", () => {
    expect(parseAllowedCountries("64")).toEqual(["64"]);
  });

  it("parses comma-separated codes and trims whitespace", () => {
    expect(parseAllowedCountries(" 64 , 61 ")).toEqual(["64", "61"]);
  });

  it("filters tokens that aren't valid dial codes", () => {
    expect(parseAllowedCountries("64,abc,0,61,")).toEqual(["64", "61"]);
  });

  it("accepts longer dial codes (up to 4 digits)", () => {
    expect(parseAllowedCountries("353,1")).toEqual(["353", "1"]);
  });
});

describe("serialiseAllowedCountries", () => {
  it("returns null for empty input", () => {
    expect(serialiseAllowedCountries([])).toBeNull();
  });

  it("returns null when every input is junk", () => {
    expect(serialiseAllowedCountries(["abc", "0", ""])).toBeNull();
  });

  it("strips non-digits and joins with comma", () => {
    expect(serialiseAllowedCountries(["+64", " 61 ", "+44"])).toBe("64,61,44");
  });

  it("dedupes preserving first-seen order", () => {
    expect(serialiseAllowedCountries(["64", "61", "64", "61"])).toBe("64,61");
  });

  it("round-trips through parse without changing meaning", () => {
    const csv = serialiseAllowedCountries(["64", "61", "44"])!;
    expect(parseAllowedCountries(csv)).toEqual(["64", "61", "44"]);
  });
});

describe("phoneMatchesAllowed", () => {
  it("returns true for an empty allow-list (no restriction)", () => {
    expect(phoneMatchesAllowed("+447700900123", [])).toBe(true);
    expect(phoneMatchesAllowed(null, [])).toBe(true);
  });

  it("returns false for an empty / malformed phone when there's a gate", () => {
    expect(phoneMatchesAllowed(null, ["64"])).toBe(false);
    expect(phoneMatchesAllowed("", ["64"])).toBe(false);
    expect(phoneMatchesAllowed("64211234567", ["64"])).toBe(false); // no leading +
  });

  it("NZ-only pool accepts a NZ phone", () => {
    expect(phoneMatchesAllowed("+64211234567", ["64"])).toBe(true);
  });

  it("NZ-only pool rejects a UK phone", () => {
    expect(phoneMatchesAllowed("+447700900123", ["64"])).toBe(false);
  });

  it("ANZAC pool accepts both NZ and AU phones", () => {
    expect(phoneMatchesAllowed("+64211234567", ["64", "61"])).toBe(true);
    expect(phoneMatchesAllowed("+61455123456", ["64", "61"])).toBe(true);
  });

  it("ANZAC pool rejects a UK phone", () => {
    expect(phoneMatchesAllowed("+447700900123", ["64", "61"])).toBe(false);
  });

  it("longer prefix wins when allow-list mixes overlapping codes", () => {
    // contrived: "+1441..." (Bermuda) when allow-list has both "1" and "1441"
    expect(phoneMatchesAllowed("+14415551234", ["1", "1441"])).toBe(true);
    expect(phoneMatchesAllowed("+14155551234", ["1441"])).toBe(false);
  });

  it("US pool accepts +1 number (US/CA share dial code as documented)", () => {
    expect(phoneMatchesAllowed("+14155551234", ["1"])).toBe(true);
    expect(phoneMatchesAllowed("+16041234567", ["1"])).toBe(true); // Canadian
  });
});

describe("countriesFromAllowed", () => {
  it("returns empty for empty input", () => {
    expect(countriesFromAllowed([])).toEqual([]);
  });

  it("maps known dial codes to CountryEntry shapes", () => {
    const result = countriesFromAllowed(["64", "61"]);
    expect(result.map((c) => c.iso)).toEqual(["NZ", "AU"]);
    expect(result[0].flag).toBe("🇳🇿");
  });

  it("silently skips unknown dial codes", () => {
    const result = countriesFromAllowed(["64", "9999", "61"]);
    expect(result.map((c) => c.iso)).toEqual(["NZ", "AU"]);
  });
});

describe("MAX_ALLOWED_COUNTRIES", () => {
  it("is a positive integer that matches the spec", () => {
    expect(MAX_ALLOWED_COUNTRIES).toBe(10);
  });
});
