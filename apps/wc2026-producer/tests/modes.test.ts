/**
 * Tests for replay-mode + live-mode scaffolding.
 */

import { describe, expect, it } from "vitest";
import { loadFixtures } from "../src/fixtures.js";
import { pickReplaySource } from "../src/replay-mode.js";
import { UnconfiguredLiveAdapter } from "../src/live-mode.js";

describe("replay-mode", () => {
  it("returns a placeholder replay source for any fixture", () => {
    const bundle = loadFixtures();
    const fixture = bundle.fixtures[0];
    const replay = pickReplaySource(fixture);
    expect(replay.fixture).toBe(fixture);
    expect(replay.source_match_id).toBeTruthy();
    expect(replay.source_stream_uri).toBeTruthy();
  });
});

describe("live-mode (unconfigured)", () => {
  it("never claims to support a fixture", async () => {
    const bundle = loadFixtures();
    const adapter = new UnconfiguredLiveAdapter();
    expect(await adapter.supports(bundle.fixtures[0])).toBe(false);
  });

  it("throws when stream() is called", async () => {
    const bundle = loadFixtures();
    const adapter = new UnconfiguredLiveAdapter();
    const ctrl = new AbortController();
    const it = adapter.stream(bundle.fixtures[0], ctrl.signal)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow(/not configured/i);
  });
});
