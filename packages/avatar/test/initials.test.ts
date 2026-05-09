import { describe, it, expect } from "vitest";
import { deriveInitials } from "../src/billboard-face.js";

describe("deriveInitials", () => {
  it("returns first+last initial for two-word names", () => {
    expect(deriveInitials("Lionel Messi")).toBe("LM");
  });

  it("returns first+last initial for multi-word names", () => {
    expect(deriveInitials("Ángel Di María")).toBe("ÁM");
  });

  it("returns the first two letters of a single-word name", () => {
    expect(deriveInitials("Pelé")).toBe("PE");
  });

  it("handles empty input safely", () => {
    expect(deriveInitials("")).toBe("?");
    expect(deriveInitials("   ")).toBe("?");
  });
});
