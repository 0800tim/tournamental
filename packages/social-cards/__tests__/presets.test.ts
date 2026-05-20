/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Editorial-preset smoke + sample emission.
 *
 * For each of the four new presets we render the landscape (1200x630)
 * and the story (1080x1920) variant, write the bytes to the canonical
 * sample directory (so the orchestrator + reviewer agents can diff
 * them), and assert:
 *
 *   - The buffer starts with the PNG magic number.
 *   - The PNG IHDR header reports the expected width + height.
 *   - The buffer size is > 8 KB (sanity floor — any preset that
 *     accidentally renders a blank canvas would slip well under that).
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  leaderboardRankUp,
  perfectWeek,
  predictionPick,
  syndicateInvite,
} from "../src/presets/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Worktree root is __tests__/../../../ (packages/social-cards -> repo root).
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLE_DIR = join(REPO_ROOT, ".playwright-mcp", "og-samples", "phase3e");

// PNG signature: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPngHeader(
  buf: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): void {
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  // IHDR begins at byte 8 (chunk length, 4) + "IHDR" (4) + width (4) + height (4).
  // So width starts at byte 16, height at byte 20 (big-endian 32-bit ints).
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(width).toBe(expectedWidth);
  expect(height).toBe(expectedHeight);
}

async function writeSample(name: string, png: Buffer): Promise<void> {
  await fs.mkdir(SAMPLE_DIR, { recursive: true });
  await fs.writeFile(join(SAMPLE_DIR, name), png);
}

const SAMPLE_FLOOR_BYTES = 8 * 1024;

// All four presets, both sizes -> eight samples total.

describe("editorial presets: prediction-pick", () => {
  const args = {
    userHandle: "messi-fan",
    pickedOn: "2026-05-21",
    pickTeam: "Argentina",
    opponentTeam: "Brazil",
    oddsPercent: 38,
    picksSaved: 12,
    matchNumber: "Match 47 of 64",
    poolSlug: "casa-rosada",
  } as const;

  it("renders landscape (1200x630)", async () => {
    const png = await predictionPick.render({ ...args, size: "og" });
    assertPngHeader(png, 1200, 630);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("prediction-pick-og.png", png);
  });

  it("renders story (1080x1920)", async () => {
    const png = await predictionPick.render({ ...args, size: "story" });
    assertPngHeader(png, 1080, 1920);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("prediction-pick-story.png", png);
  });
});

describe("editorial presets: leaderboard-rank-up", () => {
  const args = {
    userHandle: "kiri",
    newRank: 87,
    points: 4280,
    streakDays: 5,
    hitRatePercent: 71,
    poolSlug: "global",
  } as const;

  it("renders landscape (1200x630)", async () => {
    const png = await leaderboardRankUp.render({ ...args, size: "og" });
    assertPngHeader(png, 1200, 630);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("leaderboard-rank-up-og.png", png);
  });

  it("renders story (1080x1920)", async () => {
    const png = await leaderboardRankUp.render({ ...args, size: "story" });
    assertPngHeader(png, 1080, 1920);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("leaderboard-rank-up-story.png", png);
  });
});

describe("editorial presets: perfect-week", () => {
  const args = {
    userHandle: "kiri",
    weekEnding: "2026-05-21",
    streakDays: 7,
    matchesCalled: 7,
    pointsEarned: 1240,
    poolSlug: "casa-rosada",
  } as const;

  it("renders landscape (1200x630)", async () => {
    const png = await perfectWeek.render({ ...args, size: "og" });
    assertPngHeader(png, 1200, 630);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("perfect-week-og.png", png);
  });

  it("renders story (1080x1920)", async () => {
    const png = await perfectWeek.render({ ...args, size: "story" });
    assertPngHeader(png, 1080, 1920);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("perfect-week-story.png", png);
  });
});

describe("editorial presets: syndicate-invite", () => {
  const args = {
    poolSlug: "casa-rosada",
    poolName: "Casa Rosada",
    ownerHandle: "leo",
    memberCount: 248,
    picksMade: 1124,
    entryFee: null,
  } as const;

  it("renders landscape (1200x630)", async () => {
    const png = await syndicateInvite.render({ ...args, size: "og" });
    assertPngHeader(png, 1200, 630);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("syndicate-invite-og.png", png);
  });

  it("renders story (1080x1920)", async () => {
    const png = await syndicateInvite.render({ ...args, size: "story" });
    assertPngHeader(png, 1080, 1920);
    expect(png.byteLength).toBeGreaterThan(SAMPLE_FLOOR_BYTES);
    await writeSample("syndicate-invite-story.png", png);
  });
});
