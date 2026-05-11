import { describe, expect, it } from "vitest";
import { fifaCodeToFlagEmoji, iso2ToFlagEmoji } from "@/lib/team-flag";

describe("iso2ToFlagEmoji", () => {
  it("converts ISO-2 codes to regional-indicator pairs", () => {
    expect(iso2ToFlagEmoji("AR")).toBe("🇦🇷");
    expect(iso2ToFlagEmoji("FR")).toBe("🇫🇷");
    expect(iso2ToFlagEmoji("nz")).toBe("🇳🇿");
  });

  it("returns null for invalid input", () => {
    expect(iso2ToFlagEmoji("X")).toBeNull();
    expect(iso2ToFlagEmoji("123")).toBeNull();
    expect(iso2ToFlagEmoji("XX")).toBe("🇽🇽"); // valid construct, even if no real flag
  });
});

describe("fifaCodeToFlagEmoji", () => {
  it("maps the AR-FR demo codes", () => {
    expect(fifaCodeToFlagEmoji("ARG")).toBe("🇦🇷");
    expect(fifaCodeToFlagEmoji("FRA")).toBe("🇫🇷");
  });

  it("returns null for unknown codes so callers fall back gracefully", () => {
    expect(fifaCodeToFlagEmoji("ZZZ")).toBeNull();
    expect(fifaCodeToFlagEmoji(undefined)).toBeNull();
  });
});
