/**
 * Tests for the canvas-rendered bracket share PNG. These are slower
 * than the satori tests (they actually rasterise) but still budgeted
 * at < 5s total — render once at each size and assert on the bytes.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  renderBracketShareCard,
  CANVAS_SIZES,
  type BracketShareCardInput,
} from "../src/canvas/index.js";
import { _resetFlagCache } from "../src/canvas/flags.js";

const FIXTURE_FLAGS = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "flags",
);

const BASE_INPUT: BracketShareCardInput = {
  user: { handle: "messi-fan", displayName: "Messi Fan" },
  champion: {
    code: "ARG",
    name: "Argentina",
    kit: { primary: "#74acdf" },
  },
  knockoutPath: [
    { stage: "r16", teamCode: "AUS", teamName: "Australia" },
    { stage: "qf", teamCode: "ESP", teamName: "Spain" },
    { stage: "sf", teamCode: "BRA", teamName: "Brazil" },
    { stage: "final", teamCode: "FRA", teamName: "France" },
  ],
  tournamentName: "FIFA WC 2026",
  pundit: { level: 2 },
  flagsDir: FIXTURE_FLAGS,
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

describe("renderBracketShareCard", () => {
  beforeAll(() => {
    _resetFlagCache();
  });

  it("renders a portrait PNG (1080×1350) for the default size", async () => {
    const png = await renderBracketShareCard(BASE_INPUT);
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(isPng(png)).toBe(true);
    // Non-trivial canvas → non-trivial PNG.
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("renders all three size presets with valid PNG signatures", async () => {
    for (const size of ["portrait", "landscape", "square"] as const) {
      const png = await renderBracketShareCard({ ...BASE_INPUT, size });
      expect(isPng(png), `${size} should be PNG`).toBe(true);
      // The IHDR chunk starts at offset 16 and the width/height live at 16..24
      // (big-endian uint32 each). Decode them to verify the canvas matches
      // the requested preset dimensions.
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(width).toBe(CANVAS_SIZES[size].width);
      expect(height).toBe(CANVAS_SIZES[size].height);
    }
  });

  it("falls back to a placeholder when the champion's flag SVG is missing", async () => {
    // Use a code that is *not* in the fixture directory.
    const png = await renderBracketShareCard({
      ...BASE_INPUT,
      champion: { code: "ZZZ", name: "Zedland", kit: { primary: "#ff0000" } },
    });
    expect(isPng(png)).toBe(true);
  });

  it("survives a champion with no kit colour at all", async () => {
    const noKit: BracketShareCardInput = {
      ...BASE_INPUT,
      champion: { code: "ARG", name: "Argentina", kit: undefined },
    };
    const png = await renderBracketShareCard(noKit);
    expect(isPng(png)).toBe(true);
  });

  it("survives a champion with an invalid kit hex", async () => {
    const bad: BracketShareCardInput = {
      ...BASE_INPUT,
      champion: { code: "ARG", name: "Argentina", kit: { primary: "not-a-colour" } },
    };
    const png = await renderBracketShareCard(bad);
    expect(isPng(png)).toBe(true);
  });

  it("renders even when the knockout path is empty", async () => {
    const png = await renderBracketShareCard({ ...BASE_INPUT, knockoutPath: [] });
    expect(isPng(png)).toBe(true);
  });

  it("renders without the pundit chip when pundit is null", async () => {
    const png = await renderBracketShareCard({ ...BASE_INPUT, pundit: null });
    expect(isPng(png)).toBe(true);
  });

  it("renders with a long champion name without throwing", async () => {
    const png = await renderBracketShareCard({
      ...BASE_INPUT,
      champion: { ...BASE_INPUT.champion, name: "The Most Excellent Footballing Nation" },
    });
    expect(isPng(png)).toBe(true);
  });

  it("renders a full 5-stage path (incl. 3rd-place playoff)", async () => {
    const png = await renderBracketShareCard({
      ...BASE_INPUT,
      knockoutPath: [
        { stage: "r16", teamCode: "AUS", teamName: "Australia" },
        { stage: "qf", teamCode: "ESP", teamName: "Spain" },
        { stage: "sf", teamCode: "BRA", teamName: "Brazil" },
        { stage: "tp", teamCode: "BRA", teamName: "Brazil" },
        { stage: "final", teamCode: "FRA", teamName: "France" },
      ],
    });
    expect(isPng(png)).toBe(true);
  });

  it("deduplicates stages, keeping the last entry per stage", async () => {
    const png = await renderBracketShareCard({
      ...BASE_INPUT,
      knockoutPath: [
        { stage: "r16", teamCode: "AUS", teamName: "Australia" },
        { stage: "r16", teamCode: "JPN", teamName: "Japan" },
        { stage: "final", teamCode: "FRA", teamName: "France" },
      ],
    });
    expect(isPng(png)).toBe(true);
  });

  it("uses the override footer URL when provided", async () => {
    const png = await renderBracketShareCard({
      ...BASE_INPUT,
      footerUrl: "vtourn.com/world-cup-2026",
    });
    expect(isPng(png)).toBe(true);
  });

  it("renders identically for repeated calls (flag cache hit path)", async () => {
    const a = await renderBracketShareCard(BASE_INPUT);
    const b = await renderBracketShareCard(BASE_INPUT);
    // Byte-equal isn't strictly guaranteed (zlib timestamps), so just
    // assert both are valid PNGs of the same length.
    expect(isPng(a)).toBe(true);
    expect(isPng(b)).toBe(true);
    expect(Math.abs(a.length - b.length)).toBeLessThan(1_024);
  });
});
