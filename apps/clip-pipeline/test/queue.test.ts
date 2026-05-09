import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FfmpegRunner } from "../src/ffmpeg.js";
import { ClipQueue, isValidTransition } from "../src/queue.js";
import type { ClipRequest } from "../src/types.js";

function makeRunner(behaviour: "ok" | "fail" = "ok"): FfmpegRunner & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    set calls(_: number) {
      // ignore — tests read calls
    },
    async available() {
      return true;
    },
    async run() {
      calls += 1;
      if (behaviour === "ok") return { ok: true };
      return { ok: false, error: "stub failure" };
    },
  } as FfmpegRunner & { calls: number };
}

const baseReq: ClipRequest = {
  match_id: "test-match",
  start_ms: 0,
  end_ms: 5_000,
  format: "9:16",
  src: "/dev/null",
};

let storage: string;

beforeEach(async () => {
  storage = await fs.mkdtemp(path.join(tmpdir(), "clip-pipeline-queue-"));
});

afterEach(async () => {
  await fs.rm(storage, { recursive: true, force: true });
});

describe("isValidTransition", () => {
  it("allows queued -> rendering, rendering -> done, rendering -> failed", () => {
    expect(isValidTransition("queued", "rendering")).toBe(true);
    expect(isValidTransition("rendering", "done")).toBe(true);
    expect(isValidTransition("rendering", "failed")).toBe(true);
  });

  it("disallows terminal -> any", () => {
    expect(isValidTransition("done", "rendering")).toBe(false);
    expect(isValidTransition("done", "queued")).toBe(false);
    expect(isValidTransition("failed", "rendering")).toBe(false);
  });

  it("disallows queued -> done (must go via rendering)", () => {
    expect(isValidTransition("queued", "done")).toBe(false);
  });
});

describe("ClipQueue", () => {
  it("submits a job in queued state and assigns a deterministic id", () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner(), storagePath: storage });
    const { job, cached } = queue.submit(baseReq);
    expect(cached).toBe(false);
    expect(job.status).toMatch(/queued|rendering|done/);
    expect(job.clip_id).toMatch(/^clip_[0-9a-f]{16}$/);
  });

  it("returns the cached job on duplicate submission, never re-encoding", async () => {
    const runner = makeRunner();
    const queue = new ClipQueue({ ffmpeg: runner, storagePath: storage });
    const a = queue.submit(baseReq);
    await queue.waitForIdle();
    const b = queue.submit(baseReq);
    expect(b.cached).toBe(true);
    expect(b.job.clip_id).toBe(a.job.clip_id);
    expect(runner.calls).toBe(1);
  });

  it("transitions queued -> rendering -> done on success", async () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner("ok"), storagePath: storage });
    const { job } = queue.submit(baseReq);
    await queue.waitForIdle();
    const after = queue.get(job.clip_id);
    expect(after?.status).toBe("done");
    expect(after?.url).toBeTruthy();
    expect(after?.output_path).toContain(`${job.clip_id}.mp4`);
  });

  it("transitions queued -> rendering -> failed on ffmpeg failure", async () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner("fail"), storagePath: storage });
    const { job } = queue.submit(baseReq);
    await queue.waitForIdle();
    const after = queue.get(job.clip_id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("stub failure");
  });

  it("fails immediately when no src is provided", async () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner(), storagePath: storage });
    const reqNoSrc: ClipRequest = { ...baseReq };
    delete reqNoSrc.src;
    const { job } = queue.submit(reqNoSrc);
    await queue.waitForIdle();
    const after = queue.get(job.clip_id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toMatch(/no input source/);
  });

  it("uses CLIP_STORAGE_URL when set for the public url", async () => {
    const queue = new ClipQueue({
      ffmpeg: makeRunner(),
      storagePath: storage,
      storageUrl: "https://cdn.example/clips",
    });
    const { job } = queue.submit(baseReq);
    await queue.waitForIdle();
    const after = queue.get(job.clip_id);
    expect(after?.url).toBe(`https://cdn.example/clips/${job.clip_id}.mp4`);
    expect(after?.thumbnail).toBe(`https://cdn.example/clips/${job.clip_id}.jpg`);
  });

  it("falls back to a file:// url in dev when no storage url is set", async () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner(), storagePath: storage });
    const { job } = queue.submit(baseReq);
    await queue.waitForIdle();
    const after = queue.get(job.clip_id);
    expect(after?.url?.startsWith("file://")).toBe(true);
  });

  it("processes multiple distinct submissions in order", async () => {
    const runner = makeRunner();
    const queue = new ClipQueue({ ffmpeg: runner, storagePath: storage });
    queue.submit({ ...baseReq, match_id: "m1" });
    queue.submit({ ...baseReq, match_id: "m2" });
    queue.submit({ ...baseReq, match_id: "m3" });
    await queue.waitForIdle();
    expect(runner.calls).toBe(3);
    expect(queue.list().every((j) => j.status === "done")).toBe(true);
  });

  it("returns undefined for unknown clip ids", () => {
    const queue = new ClipQueue({ ffmpeg: makeRunner(), storagePath: storage });
    expect(queue.get("clip_unknown")).toBeUndefined();
  });
});
