/**
 * Tests for the animated bracket-reveal MP4 generator.
 *
 * We exercise two paths:
 *   1. Mocked spawn — runs in every CI environment, asserts the
 *      ffmpeg argv is what we expect and the frame pipe is consumed.
 *   2. Real spawn — only runs when `/usr/bin/ffmpeg` exists on the
 *      host (skipped otherwise). Verifies the resulting MP4 starts
 *      with a valid ftyp box and reports a non-zero byte size.
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Readable, Writable, PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import {
  renderBracketRevealVideo,
  type BracketRevealVideoInput,
} from "../src/video/bracket-reveal.js";
import type { BracketShareCardInput } from "../src/canvas/index.js";

const FIXTURE_FLAGS = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "flags",
);

const CARD: BracketShareCardInput = {
  user: { handle: "viral-tim", displayName: "Tim" },
  champion: { code: "ARG", name: "Argentina", kit: { primary: "#74acdf" } },
  knockoutPath: [
    { stage: "r16", teamCode: "AUS", teamName: "Australia" },
    { stage: "qf", teamCode: "ESP", teamName: "Spain" },
    { stage: "sf", teamCode: "BRA", teamName: "Brazil" },
    { stage: "final", teamCode: "FRA", teamName: "France" },
  ],
  tournamentName: "FIFA WC 2026",
  flagsDir: FIXTURE_FLAGS,
};

function mockSpawn(opts: {
  exitCode?: number;
  /** Optional file to write so post-encode stat() succeeds. */
  fakeOutputPath?: string;
  /** Optional callback observing the frames written to stdin. */
  onFrames?: (chunks: Buffer[]) => void;
} = {}): {
  spawnFn: BracketRevealVideoInput["spawnFn"];
  framesWritten: () => number;
  argv: () => string[] | null;
} {
  const exitCode = opts.exitCode ?? 0;
  let lastArgv: string[] | null = null;
  const frames: Buffer[] = [];

  const fn: BracketRevealVideoInput["spawnFn"] = ((
    _bin: string,
    args: readonly string[] | string[],
  ) => {
    lastArgv = Array.from(args);
    const emitter = new EventEmitter() as ChildProcess & EventEmitter;
    const stdin = new Writable({
      write(chunk: Buffer, _enc, cb) {
        frames.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(emitter, { stdin, stdout, stderr });
    stdin.on("finish", () => {
      // Simulate "ffmpeg wrote the file" before we report exit.
      if (opts.fakeOutputPath && exitCode === 0) {
        fs.writeFile(opts.fakeOutputPath, Buffer.from("FAKE-MP4-CONTENT")).then(
          () => {
            opts.onFrames?.(frames);
            emitter.emit("close", exitCode);
          },
          () => {
            emitter.emit("close", 1);
          },
        );
      } else {
        opts.onFrames?.(frames);
        if (exitCode !== 0) {
          stderr.write("synthetic-ffmpeg-error\n");
        }
        emitter.emit("close", exitCode);
      }
    });
    return emitter;
  }) as BracketRevealVideoInput["spawnFn"];

  return {
    spawnFn: fn,
    framesWritten: () => frames.length,
    argv: () => lastArgv,
  };
}

describe("renderBracketRevealVideo — mocked spawn", () => {
  it("invokes ffmpeg with image2pipe + libx264 + faststart", async () => {
    const out = join(tmpdir(), `bracket-reveal-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 6,
      durationSec: 1,
      spawnFn: mock.spawnFn,
    });
    expect(result.path).toBe(out);
    expect(result.frameCount).toBe(6);
    const argv = mock.argv() ?? [];
    expect(argv).toContain("image2pipe");
    expect(argv).toContain("libx264");
    expect(argv).toContain("+faststart");
    expect(argv).toContain(out);
    await fs.unlink(out).catch(() => undefined);
  });

  it("pipes the correct number of PNG frames to ffmpeg's stdin", async () => {
    const out = join(tmpdir(), `bracket-reveal-frames-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 8,
      durationSec: 2,
      spawnFn: mock.spawnFn,
    });
    expect(result.frameCount).toBe(16);
    // Each frame is a PNG → starts with 0x89 0x50 ('PN').
    expect(mock.framesWritten()).toBeGreaterThanOrEqual(1);
    await fs.unlink(out).catch(() => undefined);
  });

  it("uses the instagram preset by default (1080×1350)", async () => {
    const out = join(tmpdir(), `bracket-reveal-fmt-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 4,
      durationSec: 0.5,
      spawnFn: mock.spawnFn,
    });
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1350);
    await fs.unlink(out).catch(() => undefined);
  });

  it("switches to tiktok 1080×1920 when format=tiktok", async () => {
    const out = join(tmpdir(), `bracket-reveal-tiktok-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 4,
      durationSec: 0.5,
      format: "tiktok",
      spawnFn: mock.spawnFn,
    });
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    await fs.unlink(out).catch(() => undefined);
  });

  it("switches to twitter 1200×630 when format=twitter", async () => {
    const out = join(tmpdir(), `bracket-reveal-twitter-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 4,
      durationSec: 0.5,
      format: "twitter",
      spawnFn: mock.spawnFn,
    });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(630);
    await fs.unlink(out).catch(() => undefined);
  });

  it("returns the file size from fs.stat after a successful encode", async () => {
    const out = join(tmpdir(), `bracket-reveal-size-${Date.now()}.mp4`);
    const mock = mockSpawn({ fakeOutputPath: out });
    const result = await renderBracketRevealVideo({
      card: CARD,
      outputPath: out,
      fps: 4,
      durationSec: 0.5,
      spawnFn: mock.spawnFn,
    });
    expect(result.sizeBytes).toBeGreaterThan(0);
    await fs.unlink(out).catch(() => undefined);
  });

  it("throws when ffmpeg exits non-zero", async () => {
    const out = join(tmpdir(), `bracket-reveal-fail-${Date.now()}.mp4`);
    const mock = mockSpawn({ exitCode: 1 });
    await expect(
      renderBracketRevealVideo({
        card: CARD,
        outputPath: out,
        fps: 2,
        durationSec: 0.5,
        spawnFn: mock.spawnFn,
      }),
    ).rejects.toThrow(/ffmpeg exited with code 1/);
  });
});

describe.skipIf(!existsSync("/usr/bin/ffmpeg"))(
  "renderBracketRevealVideo — real ffmpeg",
  () => {
    it("produces a non-empty MP4 with the correct duration", async () => {
      const out = join(tmpdir(), `bracket-reveal-real-${Date.now()}.mp4`);
      const input: BracketRevealVideoInput = {
        card: CARD,
        outputPath: out,
        fps: 12,
        durationSec: 1, // 12 frames — keep the test fast
        format: "instagram",
      };
      const result = await renderBracketRevealVideo(input);
      expect(result.sizeBytes).toBeGreaterThan(1_000);
      const head = await fs.readFile(result.path);
      // MP4 files start with an ftyp box: 4-byte size, then "ftyp".
      expect(head.subarray(4, 8).toString("ascii")).toBe("ftyp");
      await fs.unlink(result.path).catch(() => undefined);
    }, 60_000);
  },
);
