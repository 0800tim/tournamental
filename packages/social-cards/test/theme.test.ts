import { describe, it, expect } from "vitest";
import { palette, referralUrl, referralLabel, sizes, wordmark } from "../src/theme.js";

describe("theme", () => {
  it("matches the marketing tailwind palette exactly", () => {
    // Sanity: these are the four families the spec requires us to use.
    expect(palette.ink[900]).toBe("#0a0e1a");
    expect(palette.accent[500]).toBe("#5a96d8");
    expect(palette.flame[500]).toBe("#ff8a3d");
    expect(palette.emerald[500]).toBe("#21a34a");
  });

  it("ships exactly two card sizes (og + story)", () => {
    expect(sizes.og).toEqual({ width: 1200, height: 630 });
    expect(sizes.story).toEqual({ width: 1080, height: 1920 });
  });

  it("brand wordmark is VTourn (capital V, capital T)", () => {
    expect(wordmark).toBe("VTourn");
  });

  it("referralUrl carries utm_source", () => {
    const url = referralUrl({ userId: "u_42", utmSource: "share-card" });
    expect(url).toBe("https://vtourn.com/r/u_42?utm_source=share-card");
  });

  it("referralUrl carries utm_campaign when supplied", () => {
    const url = referralUrl({
      userId: "u_42",
      utmSource: "share-card",
      utmCampaign: "goal-clip",
    });
    expect(url).toContain("utm_source=share-card");
    expect(url).toContain("utm_campaign=goal-clip");
  });

  it("referralUrl URL-encodes the user id", () => {
    const url = referralUrl({ userId: "user with spaces", utmSource: "x" });
    expect(url).toContain("user%20with%20spaces");
  });

  it("referralLabel is a clean human-readable footer string", () => {
    expect(referralLabel("u_42")).toBe("vtourn.com/r/u_42");
  });
});
