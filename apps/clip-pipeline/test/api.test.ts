import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp, parseClipRequest } from "../src/api.js";
import type { FfmpegRunner } from "../src/ffmpeg.js";
import { ClipQueue } from "../src/queue.js";
import type { ClipRequest, DetectorEvent } from "../src/types.js";

function makeRunner(): FfmpegRunner & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    set calls(_: number) {
      // ignore
    },
    async available() {
      return true;
    },
    async run(args) {
      calls += 1;
      // Write a tiny non-empty MP4-shaped file so the file-stream test passes.
      await fs.writeFile(args.outputPath, Buffer.from("FAKE_MP4_BYTES_FOR_TEST_ONLY"));
      return { ok: true };
    },
  } as FfmpegRunner & { calls: number };
}

let storage: string;

beforeEach(async () => {
  storage = await fs.mkdtemp(path.join(tmpdir(), "clip-pipeline-api-"));
});

afterEach(async () => {
  await fs.rm(storage, { recursive: true, force: true });
});

const fixtureEvents: DetectorEvent[] = [
  { t: 60_000, type: "event.goal", player: "P_MESSI", team: "ARG" },
  { t: 600_000, type: "event.goal", player: "P_MBAPPE", team: "FRA" },
  { t: 1_200_000, type: "event.match_end" },
];

function setup(opts?: { events?: ReadonlyArray<DetectorEvent>; runner?: FfmpegRunner }) {
  const ffmpeg = opts?.runner ?? makeRunner();
  const queue = new ClipQueue({ ffmpeg, storagePath: storage });
  const fetchEvents = async (_id: string): Promise<ReadonlyArray<DetectorEvent>> =>
    opts?.events ?? fixtureEvents;
  const app = buildApp({ queue, ffmpeg, fetchEvents });
  return { app, queue, ffmpeg };
}

describe("parseClipRequest", () => {
  const ok: ClipRequest = { match_id: "m", start_ms: 0, end_ms: 5_000, format: "9:16" };

  it("accepts a minimal valid request", () => {
    const r = parseClipRequest({ ...ok });
    expect("value" in r).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(parseClipRequest(null)).toEqual({ error: expect.stringContaining("body") });
    expect(parseClipRequest("string")).toEqual({ error: expect.stringContaining("body") });
  });

  it("rejects bad match_id", () => {
    expect(parseClipRequest({ ...ok, match_id: "" })).toEqual({
      error: expect.stringContaining("match_id"),
    });
    expect(parseClipRequest({ ...ok, match_id: 5 })).toEqual({
      error: expect.stringContaining("match_id"),
    });
  });

  it("rejects bad time windows", () => {
    expect(parseClipRequest({ ...ok, start_ms: -1 })).toEqual({
      error: expect.stringContaining("start_ms"),
    });
    expect(parseClipRequest({ ...ok, end_ms: 0 })).toEqual({
      error: expect.stringContaining("end_ms"),
    });
    expect(parseClipRequest({ ...ok, end_ms: 500 })).toEqual({
      error: expect.stringContaining("duration"),
    });
    expect(parseClipRequest({ ...ok, end_ms: 1_000_000 })).toEqual({
      error: expect.stringContaining("duration"),
    });
  });

  it("rejects bad format", () => {
    expect(parseClipRequest({ ...ok, format: "4:3" })).toEqual({
      error: expect.stringContaining("format"),
    });
  });

  it("accepts an overlay with optional fields", () => {
    const r = parseClipRequest({
      ...ok,
      overlay: { scoreline: "ARG 3-2 FRA", scorer: "Messi", minute: "108'", language: "en" },
    });
    expect("value" in r).toBe(true);
    if ("value" in r) {
      expect(r.value.overlay?.scoreline).toBe("ARG 3-2 FRA");
    }
  });

  it("rejects an overlay that isn't an object", () => {
    expect(parseClipRequest({ ...ok, overlay: "not-an-object" })).toEqual({
      error: expect.stringContaining("overlay"),
    });
  });

  it("rejects oversized src", () => {
    const long = "x".repeat(3000);
    expect(parseClipRequest({ ...ok, src: long })).toEqual({
      error: expect.stringContaining("src"),
    });
  });
});

describe("GET /healthz", () => {
  it("reports ok and ffmpeg availability", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; ffmpeg: string };
    expect(body.ok).toBe(true);
    expect(body.ffmpeg).toBe("available");
  });

  it("reports missing ffmpeg when the runner is unavailable", async () => {
    const runner: FfmpegRunner = {
      async available() {
        return false;
      },
      async run() {
        return { ok: true };
      },
    };
    const { app } = setup({ runner });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    const body = res.json() as { ffmpeg: string };
    expect(body.ffmpeg).toBe("missing");
  });
});

describe("POST /v1/clip", () => {
  it("returns 202 + queued status on first submit", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: {
        match_id: "m",
        start_ms: 0,
        end_ms: 5_000,
        format: "9:16",
        src: "/tmp/in.mp4",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { clip_id: string; status: string; cached: boolean };
    expect(body.clip_id).toMatch(/^clip_[0-9a-f]{16}$/);
    expect(body.cached).toBe(false);
    expect(["queued", "rendering", "done"]).toContain(body.status);
  });

  it("returns 200 + cached: true on duplicate submit", async () => {
    const { app, queue } = setup();
    const payload = {
      match_id: "m-dupe",
      start_ms: 0,
      end_ms: 5_000,
      format: "9:16",
      src: "/tmp/in.mp4",
    };
    const first = await app.inject({ method: "POST", url: "/v1/clip", payload });
    expect(first.statusCode).toBe(202);
    await queue.waitForIdle();
    const second = await app.inject({ method: "POST", url: "/v1/clip", payload });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { cached: boolean };
    expect(body.cached).toBe(true);
  });

  it("returns 400 when the body is missing required fields", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/v1/clip", payload: { match_id: "m" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the format is invalid", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: { match_id: "m", start_ms: 0, end_ms: 5_000, format: "vertical" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/clip/:clip_id", () => {
  it("returns 404 for an unknown clip", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/clip/clip_doesntexist" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the queued/rendering/done state and a no-store cache header pre-completion", async () => {
    const { app, queue } = setup();
    const submit = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: {
        match_id: "m-state",
        start_ms: 0,
        end_ms: 5_000,
        format: "9:16",
        src: "/tmp/in.mp4",
      },
    });
    const { clip_id } = submit.json() as { clip_id: string };
    await queue.waitForIdle();
    const res = await app.inject({ method: "GET", url: `/v1/clip/${clip_id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; url?: string };
    expect(body.status).toBe("done");
    expect(body.url).toBeTruthy();
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("returns the failed state with an error message when render fails", async () => {
    const failingRunner: FfmpegRunner = {
      async available() {
        return true;
      },
      async run() {
        return { ok: false, error: "boom" };
      },
    };
    const { app, queue } = setup({ runner: failingRunner });
    const submit = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: {
        match_id: "m-fail",
        start_ms: 0,
        end_ms: 5_000,
        format: "9:16",
        src: "/tmp/in.mp4",
      },
    });
    const { clip_id } = submit.json() as { clip_id: string };
    await queue.waitForIdle();
    const res = await app.inject({ method: "GET", url: `/v1/clip/${clip_id}` });
    const body = res.json() as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toContain("boom");
  });
});

describe("GET /v1/clip/:clip_id/file", () => {
  it("streams the rendered MP4 with immutable caching", async () => {
    const { app, queue } = setup();
    const submit = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: {
        match_id: "m-file",
        start_ms: 0,
        end_ms: 5_000,
        format: "9:16",
        src: "/tmp/in.mp4",
      },
    });
    const { clip_id } = submit.json() as { clip_id: string };
    await queue.waitForIdle();
    const res = await app.inject({ method: "GET", url: `/v1/clip/${clip_id}/file` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unknown clip", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/clip/clip_nope/file" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when the clip is still rendering", async () => {
    // Use a runner that doesn't resolve until we say so, keeping the job
    // mid-render. We poll until the runner has actually been invoked so
    // resolveRunner is wired up before the test tries to drain.
    let resolveRunner: (() => void) | null = null;
    const slowRunner: FfmpegRunner = {
      async available() {
        return true;
      },
      run() {
        return new Promise<{ ok: true }>((resolve) => {
          resolveRunner = () => resolve({ ok: true });
        });
      },
    };
    const { app, queue } = setup({ runner: slowRunner });
    const submit = await app.inject({
      method: "POST",
      url: "/v1/clip",
      payload: {
        match_id: "m-slow",
        start_ms: 0,
        end_ms: 5_000,
        format: "9:16",
        src: "/tmp/in.mp4",
      },
    });
    const { clip_id } = submit.json() as { clip_id: string };
    // Wait until ffmpeg.run has actually been invoked (resolveRunner is set).
    for (let i = 0; i < 200 && resolveRunner === null; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(resolveRunner).not.toBeNull();
    expect(queue.get(clip_id)?.status).toBe("rendering");
    const res = await app.inject({ method: "GET", url: `/v1/clip/${clip_id}/file` });
    expect(res.statusCode).toBe(409);
    // Now drain the queue so afterEach can clean up.
    resolveRunner?.();
    await queue.waitForIdle();
  });
});

describe("GET /v1/match/:match_id/highlights", () => {
  it("returns the detected highlight reel", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/match/m1/highlights" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { match_id: string; count: number; highlights: { kind: string }[] };
    expect(body.match_id).toBe("m1");
    expect(body.count).toBeGreaterThan(0);
    expect(body.highlights.some((h) => h.kind === "goal")).toBe(true);
  });

  it("returns an empty list when there are no events", async () => {
    const { app } = setup({ events: [] });
    const res = await app.inject({ method: "GET", url: "/v1/match/empty/highlights" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; highlights: unknown[] };
    expect(body.count).toBe(0);
    expect(body.highlights).toEqual([]);
  });

  it("respects the limit query param", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/match/m1/highlights?limit=1" });
    const body = res.json() as { count: number };
    expect(body.count).toBe(1);
  });

  it("attaches a SWR cache header", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/v1/match/m1/highlights" });
    expect(res.headers["cache-control"]).toContain("stale-while-revalidate");
  });

  it("returns 502 when the event source throws", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const fetchEvents = async () => {
      throw new Error("upstream-down");
    };
    const app = buildApp({ queue, ffmpeg, fetchEvents });
    const res = await app.inject({ method: "GET", url: "/v1/match/m1/highlights" });
    expect(res.statusCode).toBe(502);
  });
});
