import { describe, expect, it } from "vitest";

import { clipIdFor } from "../src/clip-id.js";
import type { ClipRequest } from "../src/types.js";

const baseReq: ClipRequest = {
  match_id: "fifa-wc-2022-final-arg-fra",
  start_ms: 100_000,
  end_ms: 115_000,
  format: "9:16",
};

describe("clipIdFor", () => {
  it("returns a 16-hex-char id with the clip_ prefix", () => {
    const id = clipIdFor(baseReq);
    expect(id).toMatch(/^clip_[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(clipIdFor(baseReq)).toBe(clipIdFor(baseReq));
  });

  it("ignores the order of fields in the request object", () => {
    const reordered: ClipRequest = {
      end_ms: 115_000,
      match_id: "fifa-wc-2022-final-arg-fra",
      format: "9:16",
      start_ms: 100_000,
    };
    expect(clipIdFor(reordered)).toBe(clipIdFor(baseReq));
  });

  it("changes when the match changes", () => {
    expect(clipIdFor({ ...baseReq, match_id: "other" })).not.toBe(clipIdFor(baseReq));
  });

  it("changes when the window changes", () => {
    expect(clipIdFor({ ...baseReq, start_ms: 100_001 })).not.toBe(clipIdFor(baseReq));
    expect(clipIdFor({ ...baseReq, end_ms: 115_001 })).not.toBe(clipIdFor(baseReq));
  });

  it("changes when the format changes", () => {
    expect(clipIdFor({ ...baseReq, format: "1:1" })).not.toBe(clipIdFor(baseReq));
    expect(clipIdFor({ ...baseReq, format: "16:9" })).not.toBe(clipIdFor(baseReq));
  });

  it("changes when the overlay changes", () => {
    const a = clipIdFor({ ...baseReq, overlay: { scoreline: "ARG 3-2 FRA" } });
    const b = clipIdFor({ ...baseReq, overlay: { scoreline: "ARG 3-3 FRA" } });
    expect(a).not.toBe(b);
  });

  it("treats missing overlay as identical to overlay: undefined", () => {
    const a = clipIdFor({ ...baseReq });
    const b = clipIdFor({ ...baseReq, overlay: undefined });
    expect(a).toBe(b);
  });

  it("changes when src changes", () => {
    expect(clipIdFor({ ...baseReq, src: "/tmp/a.mp4" })).not.toBe(
      clipIdFor({ ...baseReq, src: "/tmp/b.mp4" }),
    );
  });
});
