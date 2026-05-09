import { describe, expect, it } from "vitest";

import { buildFfmpegArgs, sanitizeText } from "../src/ffmpeg.js";

describe("buildFfmpegArgs", () => {
  it("uses 1080x1920 for 9:16", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "9:16",
    });
    const vf = argv[argv.indexOf("-vf") + 1];
    expect(vf).toContain("1080:1920");
  });

  it("uses 1080x1080 for 1:1", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "1:1",
    });
    const vf = argv[argv.indexOf("-vf") + 1];
    expect(vf).toContain("1080:1080");
  });

  it("uses 1920x1080 for 16:9", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "16:9",
    });
    const vf = argv[argv.indexOf("-vf") + 1];
    expect(vf).toContain("1920:1080");
  });

  it("converts start/end ms to seconds for -ss and -t", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 30_000,
      end_ms: 45_500,
      format: "9:16",
    });
    expect(argv[argv.indexOf("-ss") + 1]).toBe("30.000");
    expect(argv[argv.indexOf("-t") + 1]).toBe("15.500");
  });

  it("includes the output file path as the last argv entry", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/data/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "9:16",
    });
    expect(argv[argv.length - 1]).toBe("/data/out.mp4");
  });

  it("appends a drawtext filter when overlay.scoreline is set", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "9:16",
      overlay: { scoreline: "ARG 3-2 FRA" },
    });
    const vf = argv[argv.indexOf("-vf") + 1];
    expect(vf).toContain("drawtext");
    expect(vf).toContain("ARG 3-2 FRA");
  });

  it("encodes with libx264 + aac at the documented bitrate", () => {
    const argv = buildFfmpegArgs("ffmpeg", {
      inputPath: "/in.mp4",
      outputPath: "/out.mp4",
      start_ms: 0,
      end_ms: 5_000,
      format: "9:16",
    });
    expect(argv).toContain("libx264");
    expect(argv).toContain("aac");
    expect(argv).toContain("128k");
    // +faststart improves first-byte playback over the network.
    expect(argv).toContain("+faststart");
  });
});

describe("sanitizeText", () => {
  it("strips characters that would break drawtext", () => {
    expect(sanitizeText("Hello: world's %s 'thing'")).toBe("Hello worlds s thing");
  });

  it("strips non-printable characters but keeps spaces and ASCII letters", () => {
    // Embed a control char (BEL = 0x07) which is non-printable.
    const out = sanitizeText("a\x07b c");
    expect(out).toBe("ab c");
  });
});
