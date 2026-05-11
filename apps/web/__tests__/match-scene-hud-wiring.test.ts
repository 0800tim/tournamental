/**
 * MatchScene source-shape tests (no jsdom mount, the Canvas backend
 * needs a real WebGL context).
 *
 * Verifies the polished HUD wiring stays intact:
 *   - The centred MatchScoreboard is imported and mounted (so
 *     viewers see ARG / FRA on every render).
 *   - The CameraAngleToggle component (not the legacy inline
 *     `<div className="camera-toggle">`) is used.
 *   - The bottom-dock container groups the cam-angle row + timeline,
 *     so the cam-angle controls aren't visually obscured by the
 *     scrubber.
 *   - DebugPanel is still mounted (hidden by default at runtime).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readMatchScene(): string {
  return readFileSync(
    resolve(__dirname, "..", "components", "MatchScene.tsx"),
    "utf-8",
  );
}

describe("MatchScene HUD wiring", () => {
  it("mounts MatchStatsHUD (which renders the centred scoreboard)", () => {
    const src = readMatchScene();
    expect(src).toMatch(/<MatchStatsHUD\s+store=\{store\}\s*\/>/);
    expect(src).toMatch(/from\s+["']\.\/MatchStatsHUD["']/);
  });

  it("uses the polished CameraAngleToggle component, not legacy inline buttons", () => {
    const src = readMatchScene();
    expect(src).toMatch(/<CameraAngleToggle\s+/);
    expect(src).toMatch(/from\s+["']\.\/CameraAngleToggle["']/);
    // The legacy inline cluster used `className="camera-toggle"`; ensure
    // it's gone. (The new component uses `camera-angle-row` instead.)
    expect(src).not.toMatch(/className="camera-toggle"/);
  });

  it("wraps cam-angle row + timeline in a single bottom-dock container", () => {
    const src = readMatchScene();
    expect(src).toMatch(/className="match-bottom-dock"/);
  });

  it("mounts the DebugPanel (hidden by default, opens via ~/i)", () => {
    const src = readMatchScene();
    expect(src).toMatch(/<DebugPanel\s+/);
  });
});
