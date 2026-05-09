import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("returns sensible defaults for an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3380);
    expect(c.bind).toBe("0.0.0.0");
    expect(c.ffmpegBin).toBe("ffmpeg");
    expect(c.storageUrl).toBeNull();
    expect(c.logLevel).toBe("info");
  });

  it("respects CLIP_PORT", () => {
    const c = loadConfig({ CLIP_PORT: "4400" });
    expect(c.port).toBe(4400);
  });

  it("rejects nonsense ports", () => {
    expect(() => loadConfig({ CLIP_PORT: "0" })).toThrow();
    expect(() => loadConfig({ CLIP_PORT: "-1" })).toThrow();
    expect(() => loadConfig({ CLIP_PORT: "70000" })).toThrow();
    expect(() => loadConfig({ CLIP_PORT: "abc" })).toThrow();
  });

  it("trims trailing slashes from CLIP_STORAGE_URL", () => {
    const c = loadConfig({ CLIP_STORAGE_URL: "https://cdn.example/clips/" });
    expect(c.storageUrl).toBe("https://cdn.example/clips");
  });

  it("treats blank CLIP_STORAGE_URL as null (dev fallback)", () => {
    expect(loadConfig({ CLIP_STORAGE_URL: "" }).storageUrl).toBeNull();
    expect(loadConfig({ CLIP_STORAGE_URL: "   " }).storageUrl).toBeNull();
  });
});
