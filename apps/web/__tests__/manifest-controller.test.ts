import { describe, expect, it } from "vitest";
import {
  buildArFrMessages,
  buildManifestBuffer,
  createManifestController,
} from "@tournamental/spec-client";

describe("ManifestController seek vs advance channel separation", () => {
  it("seek() fires both general and seek subscribers", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    let general = 0;
    let seek = 0;
    ctrl.subscribe(() => {
      general += 1;
    });
    ctrl.subscribeSeek(() => {
      seek += 1;
    });
    ctrl.seek(1000);
    expect(general).toBe(1);
    expect(seek).toBe(1);
    ctrl.seek(2000);
    expect(general).toBe(2);
    expect(seek).toBe(2);
  });

  it("_advanceTo() fires only the general subscriber", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    let general = 0;
    let seek = 0;
    ctrl.subscribe(() => {
      general += 1;
    });
    ctrl.subscribeSeek(() => {
      seek += 1;
    });
    ctrl._advanceTo(1000);
    expect(general).toBe(1);
    expect(seek).toBe(0);
    ctrl._advanceTo(2000);
    expect(general).toBe(2);
    expect(seek).toBe(0);
  });

  it("setPlaying / setRate fire only the general subscriber", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    let general = 0;
    let seek = 0;
    ctrl.subscribe(() => {
      general += 1;
    });
    ctrl.subscribeSeek(() => {
      seek += 1;
    });
    ctrl.setPlaying(true);
    ctrl.setRate(2);
    expect(general).toBe(2);
    expect(seek).toBe(0);
  });

  it("subscribers can unsubscribe", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    let count = 0;
    const unsub = ctrl.subscribe(() => {
      count += 1;
    });
    ctrl.seek(1000);
    expect(count).toBe(1);
    unsub();
    ctrl.seek(2000);
    expect(count).toBe(1);
  });

  it("seek subscribers can unsubscribe independently", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    let count = 0;
    const unsub = ctrl.subscribeSeek(() => {
      count += 1;
    });
    ctrl.seek(1000);
    expect(count).toBe(1);
    unsub();
    ctrl.seek(2000);
    expect(count).toBe(1);
  });

  it("seek clamps to [0, durationMs]", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    ctrl.seek(-1000);
    expect(ctrl.getTime()).toBe(0);
    ctrl.seek(buffer.durationMs * 10);
    expect(ctrl.getTime()).toBe(buffer.durationMs);
  });

  it("_advanceTo clamps to [0, durationMs]", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    ctrl._advanceTo(-1000);
    expect(ctrl.getTime()).toBe(0);
    ctrl._advanceTo(buffer.durationMs * 10);
    expect(ctrl.getTime()).toBe(buffer.durationMs);
  });

  it("subscribers see the new time when their callback runs", () => {
    const buffer = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer, startPlaying: false });
    const observed: number[] = [];
    ctrl.subscribe(() => {
      observed.push(ctrl.getTime());
    });
    ctrl._advanceTo(500);
    ctrl._advanceTo(1000);
    ctrl.seek(2000);
    expect(observed).toEqual([500, 1000, 2000]);
  });
});
