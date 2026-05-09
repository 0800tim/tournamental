import { describe, expect, it } from "vitest";
import {
  buildArFrMessages,
  buildManifestBuffer,
  createManifestController,
  findFrameIndex,
  getStateAt,
  manifestSourceFromText,
  parseNdjson,
} from "@vtorn/spec-client";
import type { Message } from "@vtorn/spec";

const toNdjson = (messages: Message[]): string =>
  messages.map((m) => JSON.stringify(m)).join("\n");

describe("parseNdjson", () => {
  it("parses every line into a typed Message", () => {
    const ndjson = toNdjson(buildArFrMessages().slice(0, 5));
    const parsed = parseNdjson(ndjson);
    expect(parsed.length).toBe(5);
    expect(parsed[0]?.type).toBe("match.init");
  });

  it("skips blank lines and survives bad rows", () => {
    const ndjson = ['{"type":"match.init","match_id":"x"}', "", "not-json", "  "].join("\n");
    const parsed = parseNdjson(ndjson);
    expect(parsed.length).toBe(1);
  });
});

describe("buildManifestBuffer", () => {
  it("indexes init + sorted frames + sorted events with correct duration", () => {
    const messages = buildArFrMessages();
    const buf = buildManifestBuffer(messages);
    expect(buf.init.match_id).toBe("fifa-wc-2022-final-arg-fra-2022-12-18");
    expect(buf.frames.length).toBeGreaterThan(5000);
    expect(buf.events.length).toBeGreaterThan(0);
    // Frames sorted ascending.
    for (let i = 1; i < buf.frames.length; i += 1) {
      expect(buf.frames[i].t).toBeGreaterThanOrEqual(buf.frames[i - 1].t);
    }
    // Duration is at least the regulation+ET total of 7,200,000 ms.
    expect(buf.durationMs).toBeGreaterThan(7_200_000);
  });

  it("throws if no match.init is present", () => {
    expect(() => buildManifestBuffer([])).toThrow(/match\.init/);
  });
});

describe("findFrameIndex", () => {
  const buf = buildManifestBuffer(buildArFrMessages());

  it("returns -1 when t is before the first frame", () => {
    expect(findFrameIndex(buf.frames, -1000)).toBe(-1);
  });

  it("returns the last frame when t is past the end", () => {
    const idx = findFrameIndex(buf.frames, buf.frames[buf.frames.length - 1].t + 5000);
    expect(idx).toBe(buf.frames.length - 1);
  });

  it("returns the bracketing-lower index for a midpoint t", () => {
    const t = (buf.frames[10].t + buf.frames[11].t) / 2;
    expect(findFrameIndex(buf.frames, t)).toBe(10);
  });
});

describe("getStateAt", () => {
  const buf = buildManifestBuffer(buildArFrMessages());

  it("returns null on an empty list", () => {
    expect(getStateAt([], 5)).toBeNull();
  });

  it("clamps to the first frame when t precedes everything", () => {
    const out = getStateAt(buf.frames, -1000);
    expect(out?.t).toBe(buf.frames[0].t);
  });

  it("lerps player positions between bracketing frames", () => {
    const a = buf.frames[5];
    const b = buf.frames[6];
    const midT = (a.t + b.t) / 2;
    const out = getStateAt(buf.frames, midT);
    expect(out).not.toBeNull();
    const playerId = a.players[0]?.id;
    if (!playerId) return;
    const ap = a.players.find((p) => p.id === playerId)!;
    const bp = b.players.find((p) => p.id === playerId)!;
    const op = out!.players.find((p) => p.id === playerId)!;
    expect(op.pos[0]).toBeCloseTo((ap.pos[0] + bp.pos[0]) / 2, 5);
    expect(op.pos[1]).toBeCloseTo((ap.pos[1] + bp.pos[1]) / 2, 5);
  });
});

describe("createManifestController + manifestSourceFromText", () => {
  it("seek + getCurrentState walk forward and back without throwing", () => {
    const buf = buildManifestBuffer(buildArFrMessages());
    const ctrl = createManifestController({ buffer: buf, startTime: 0, startPlaying: false });
    expect(ctrl.durationMs).toBe(buf.durationMs);
    ctrl.seek(buf.durationMs / 2);
    expect(ctrl.getTime()).toBe(buf.durationMs / 2);
    const mid = ctrl.getCurrentState(ctrl.getTime());
    expect(mid).not.toBeNull();
    ctrl.seek(0);
    expect(ctrl.getTime()).toBe(0);
    ctrl.seek(buf.durationMs * 10);
    expect(ctrl.getTime()).toBe(buf.durationMs);
  });

  it("manifestSourceFromText fires onReady with a controller", () => {
    const ndjson = toNdjson(buildArFrMessages());
    let captured: import("@vtorn/spec-client").ManifestController | null = null;
    const source = manifestSourceFromText(ndjson, {
      autoplay: false,
      onReady: (c) => {
        captured = c;
      },
    });
    const messages: Message[] = [];
    source.start(
      (m) => messages.push(m),
      () => undefined,
    );
    expect(captured).not.toBeNull();
    // Init is emitted synchronously.
    expect(messages[0]?.type).toBe("match.init");
    source.stop();
  });
});
