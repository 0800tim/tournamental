/**
 * Unit tests for the Phase-3 quality preset resolver.
 *
 * Pure module, no DOM/Three. Covers:
 *   - URL flag parsing (`?quality=` + `?fx=`).
 *   - `?fx=off` escape hatch wins over everything.
 *   - `auto` device-hint heuristics for low / medium / high.
 *   - Mobile cap at medium even with strong hints.
 *   - SSR-safe defaults when `window` is unavailable.
 */
import { describe, expect, it } from "vitest";
import {
  autoResolve,
  fxOffProfile,
  parseQualityFromSearch,
  resolveCurrentQuality,
  resolveQuality,
} from "@/lib/quality";

describe("parseQualityFromSearch", () => {
  it("parses quality + fx from a leading-? search string", () => {
    expect(parseQualityFromSearch("?quality=high&fx=off")).toEqual({
      quality: "high",
      fx: "off",
    });
  });

  it("parses query without a leading `?`", () => {
    expect(parseQualityFromSearch("quality=low")).toEqual({
      quality: "low",
      fx: undefined,
    });
  });

  it("defaults to auto + undefined fx when missing", () => {
    expect(parseQualityFromSearch("")).toEqual({
      quality: "auto",
      fx: undefined,
    });
  });

  it("rejects an invalid quality value and falls back to auto", () => {
    expect(parseQualityFromSearch("?quality=ultra")).toEqual({
      quality: "auto",
      fx: undefined,
    });
  });

  it("rejects an invalid fx value (treated as undefined)", () => {
    expect(parseQualityFromSearch("?fx=potato")).toEqual({
      quality: "auto",
      fx: undefined,
    });
  });

  it("accepts ?fx=on as an explicit on", () => {
    expect(parseQualityFromSearch("?fx=on")).toEqual({
      quality: "auto",
      fx: "on",
    });
  });
});

describe("autoResolve", () => {
  it("returns low when device memory is under 4GB", () => {
    expect(autoResolve({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe("low");
  });

  it("returns low when cores are under 4", () => {
    expect(autoResolve({ deviceMemory: 16, hardwareConcurrency: 2 })).toBe("low");
  });

  it("returns high on a beefy desktop", () => {
    expect(
      autoResolve({
        deviceMemory: 16,
        hardwareConcurrency: 12,
        isMobile: false,
      }),
    ).toBe("high");
  });

  it("caps at medium on mobile even with strong hints", () => {
    expect(
      autoResolve({
        deviceMemory: 16,
        hardwareConcurrency: 12,
        isMobile: true,
      }),
    ).toBe("medium");
  });

  it("defaults to medium when hints are missing", () => {
    expect(autoResolve({})).toBe("medium");
  });

  it("returns medium for a mid-range device", () => {
    expect(
      autoResolve({ deviceMemory: 4, hardwareConcurrency: 6, isMobile: false }),
    ).toBe("medium");
  });
});

describe("resolveQuality", () => {
  it("returns the explicit preset over auto", () => {
    expect(resolveQuality("low").preset).toBe("low");
    expect(resolveQuality("medium").preset).toBe("medium");
    expect(resolveQuality("high").preset).toBe("high");
  });

  it("uses auto-resolution when flag is auto", () => {
    expect(
      resolveQuality("auto", { deviceMemory: 16, hardwareConcurrency: 12 }).preset,
    ).toBe("high");
  });

  it("uses auto-resolution when flag is undefined", () => {
    expect(resolveQuality(undefined).preset).toBe("medium");
  });

  it("hard-disables fx when ?fx=off", () => {
    const p = resolveQuality("high", {}, "off");
    expect(p.fxOff).toBe(true);
    expect(p.preset).toBe(null);
    expect(p.ssao).toBe(false);
    expect(p.bloomIntensity).toBe(0);
  });

  it("hard-disables fx when quality flag is off", () => {
    const p = resolveQuality("off");
    expect(p.fxOff).toBe(true);
    expect(p.preset).toBe(null);
  });

  it("low preset disables ssao + motion blur", () => {
    const p = resolveQuality("low");
    expect(p.ssao).toBe(false);
    expect(p.motionBlur).toBe(false);
    expect(p.shadowMapSize).toBe(1024);
  });

  it("medium preset enables ssao but not motion blur", () => {
    const p = resolveQuality("medium");
    expect(p.ssao).toBe(true);
    expect(p.motionBlur).toBe(false);
    expect(p.shadowMapSize).toBe(2048);
  });

  it("high preset enables everything including motion blur", () => {
    const p = resolveQuality("high");
    expect(p.ssao).toBe(true);
    expect(p.motionBlur).toBe(true);
    expect(p.shadowMapSize).toBe(4096);
  });

  it("vignette is on for every preset (signature broadcast feel)", () => {
    expect(resolveQuality("low").vignette).toBe(true);
    expect(resolveQuality("medium").vignette).toBe(true);
    expect(resolveQuality("high").vignette).toBe(true);
  });
});

describe("fxOffProfile", () => {
  it("zeroes every effect", () => {
    const p = fxOffProfile();
    expect(p.fxOff).toBe(true);
    expect(p.preset).toBe(null);
    expect(p.ssao).toBe(false);
    expect(p.motionBlur).toBe(false);
    expect(p.depthOfField).toBe(false);
    expect(p.bloomIntensity).toBe(0);
    expect(p.vignette).toBe(false);
    expect(p.filmGrain).toBe(false);
    expect(p.chromaticAberration).toBe(false);
  });
});

describe("resolveCurrentQuality", () => {
  it("returns medium when window is missing (SSR)", () => {
    const p = resolveCurrentQuality({});
    expect(p.preset).toBe("medium");
  });

  it("respects ?fx=off in URL even on a beefy desktop", () => {
    const p = resolveCurrentQuality({
      location: { search: "?quality=high&fx=off" },
      navigator: {
        deviceMemory: 16,
        hardwareConcurrency: 12,
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      },
    });
    expect(p.fxOff).toBe(true);
  });

  it("auto-resolves to high on a beefy desktop UA", () => {
    const p = resolveCurrentQuality({
      location: { search: "?quality=auto" },
      navigator: {
        deviceMemory: 16,
        hardwareConcurrency: 12,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    expect(p.preset).toBe("high");
  });

  it("auto-caps at medium on Android UA even with strong hints", () => {
    const p = resolveCurrentQuality({
      location: { search: "?quality=auto" },
      navigator: {
        deviceMemory: 8,
        hardwareConcurrency: 8,
        userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7)",
      },
    });
    expect(p.preset).toBe("medium");
  });
});
