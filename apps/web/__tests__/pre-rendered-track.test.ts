/**
 * Unit tests for the pre-rendered commentary track.
 *
 * Pure module, no DOM. Covers schedule lookup, scrub recovery, and
 * the CDN URL helper.
 */
import { describe, expect, it } from "vitest";
import {
  audioUrlForLine,
  lineAt,
  loadManifest,
  nearestLine,
  type CommentaryManifest,
} from "@/lib/audio/pre-rendered-track";

const MANIFEST: CommentaryManifest = {
  match: "test",
  lang: "en",
  lines: [
    { id: "L0001", t_ms: 0, duration_ms: 4000, text: "Kick off." },
    { id: "L0002", t_ms: 4500, duration_ms: 3500, text: "Mbappé runs." },
    { id: "L0003", t_ms: 8500, duration_ms: 5000, text: "Goal! Messi!" },
    { id: "L0004", t_ms: 60000, duration_ms: 4000, text: "Half time approaches." },
  ],
};

describe("lineAt", () => {
  it("returns active line when in window", () => {
    const r = lineAt(MANIFEST, 1000);
    expect(r.kind).toBe("active");
    if (r.kind === "active") expect(r.line.id).toBe("L0001");
  });

  it("returns next line in the gap", () => {
    const r = lineAt(MANIFEST, 4200);
    expect(r.kind).toBe("next");
    if (r.kind === "next") expect(r.line.id).toBe("L0002");
  });

  it("returns before-start when t < first line", () => {
    const empty: CommentaryManifest = {
      match: "x",
      lang: "en",
      lines: [{ id: "L0001", t_ms: 5000, duration_ms: 3000, text: "" }],
    };
    const r = lineAt(empty, 0);
    expect(r.kind).toBe("before-start");
  });

  it("returns after-end past the last line", () => {
    const r = lineAt(MANIFEST, 999_999);
    expect(r.kind).toBe("after-end");
  });

  it("returns after-end on an empty manifest", () => {
    const r = lineAt({ match: "x", lang: "en", lines: [] }, 0);
    expect(r.kind).toBe("after-end");
  });

  it("snaps active at the exact start boundary", () => {
    const r = lineAt(MANIFEST, 8500);
    expect(r.kind).toBe("active");
    if (r.kind === "active") expect(r.line.id).toBe("L0003");
  });

  it("snaps to next at the exact end boundary", () => {
    // L0001 ends at 4000; lookup at 4000 should fall through to next.
    const r = lineAt(MANIFEST, 4000);
    expect(r.kind).toBe("next");
    if (r.kind === "next") expect(r.line.id).toBe("L0002");
  });
});

describe("nearestLine", () => {
  it("finds the closest line by absolute time distance", () => {
    expect(nearestLine(MANIFEST, 0)?.id).toBe("L0001");
    expect(nearestLine(MANIFEST, 4500)?.id).toBe("L0002");
    expect(nearestLine(MANIFEST, 30000)?.id).toBe("L0003");
    expect(nearestLine(MANIFEST, 999_999)?.id).toBe("L0004");
  });

  it("returns null on empty manifest", () => {
    expect(nearestLine({ match: "x", lang: "en", lines: [] }, 0)).toBe(null);
  });
});

describe("audioUrlForLine", () => {
  it("URL-encodes special chars", () => {
    expect(audioUrlForLine("test+match", "en", "L0001")).toContain("test+match");
    expect(audioUrlForLine("m", "en/foreign", "L0001")).toContain("en%2Fforeign");
  });

  it("includes the .mp3 suffix", () => {
    expect(audioUrlForLine("m", "en", "L0001")).toMatch(/L0001\.mp3$/);
  });
});

describe("loadManifest", () => {
  it("returns a parsed manifest on 200", async () => {
    const fakeFetch = (async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => MANIFEST,
    })) as unknown as typeof fetch;
    const m = await loadManifest("test", "en", fakeFetch);
    expect(m.lines).toHaveLength(4);
  });

  it("falls back to an empty manifest on failure (stub mode)", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const m = await loadManifest("test", "en", fakeFetch);
    expect(m.lines).toEqual([]);
    expect(m.match).toBe("test");
    expect(m.lang).toBe("en");
  });

  it("falls back when fetch throws", async () => {
    const fakeFetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const m = await loadManifest("test", "en", fakeFetch);
    expect(m.lines).toEqual([]);
  });
});
