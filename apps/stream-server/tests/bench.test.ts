/**
 * Synthetic fan-out benchmark.
 *
 * Spins up the real server, attaches N concurrent WS subscribers, runs a
 * burst of frames at 30Hz for a few seconds, and reports per-frame
 * delivery latency p50 / p99 across all subscribers.
 *
 * Sample output (loopback, N=200, 5s, 30Hz, 22 players):
 *   bench: subs=200 frames=150 p50=1.4ms p99=4.6ms drops=0
 *
 * The thresholds below are deliberately loose so the test passes on
 * the slowest CI we expect to encounter — the goal here is to *report*
 * the numbers (which print to the test output) and to assert the
 * pipeline doesn't fall over, not to gate-keep on absolute perf.
 */

import { describe, it, expect, afterAll } from "vitest";
import WebSocket from "ws";
import pino from "pino";
import { buildServer, type BuiltServer } from "../src/server";
import { loadConfig } from "../src/config";
import { Pipeline } from "../src/pipeline";
import { makeInit, makeStateFrame } from "./helpers";

const silent = pino({ level: "silent" });

interface Sample {
  recvAt: number;
  sentAt: number;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i]!;
}

describe("fan-out benchmark", () => {
  let built: BuiltServer | null = null;

  afterAll(async () => {
    await built?.shutdown();
  });

  it("delivers frames to N=200 subscribers with reasonable p99", async () => {
    const baseConfig = loadConfig({});
    const config = {
      ...baseConfig,
      port: 0,
      bind: "127.0.0.1",
      producerUrls: [],
      adminToken: "",
      // Big queue + cap for the bench.
      subscriberQueueMax: 500,
      maxConnsPerIp: 1000,
      maxConnsTotal: 5000,
    };
    const pipeline = new Pipeline({ config, logger: silent });
    built = await buildServer({ config, pipeline, startProducers: false });
    await built.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = built.app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = addr.port;

    const matchId = "m-bench";
    pipeline.injectForTest("upstream-A", makeInit(matchId));

    // Connect N subscribers.
    const N = 200;
    const samples: Sample[][] = Array.from({ length: N }, () => []);
    const wss: WebSocket[] = [];
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        new Promise<void>((res, rej) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/match/${matchId}`);
          wss.push(ws);
          ws.on("message", (data) => {
            const recvAt = performance.now();
            const line = data.toString();
            // Cheap test: peek for `"x_t":` in the line; we tag bench frames with that.
            const idx = line.indexOf('"x_t":');
            if (idx === -1) return;
            const after = line.slice(idx + 6);
            const num = Number.parseFloat(after);
            if (Number.isFinite(num)) samples[i]!.push({ recvAt, sentAt: num });
          });
          ws.once("open", () => res());
          ws.once("error", rej);
        }),
      ),
    );

    // Burst frames at 30Hz for 5 seconds.
    const FRAMES = 150;
    const PERIOD_MS = 1000 / 30;
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) {
      const target = start + i * PERIOD_MS;
      const wait = target - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const sentAt = performance.now();
      const frame = { ...makeStateFrame(i * 33), x_t: sentAt } as unknown as ReturnType<typeof makeStateFrame> & { x_t: number };
      pipeline.injectForTest("upstream-A", frame);
    }

    // Drain.
    await new Promise((r) => setTimeout(r, 500));
    for (const ws of wss) ws.close();

    const allLatencies: number[] = [];
    let totalReceived = 0;
    for (const arr of samples) {
      totalReceived += arr.length;
      for (const s of arr) allLatencies.push(s.recvAt - s.sentAt);
    }
    const p50 = quantile(allLatencies, 0.5);
    const p99 = quantile(allLatencies, 0.99);
    const drops = pipeline.hub.totalDropped();

    // Print results so they show up in vitest output.
    // eslint-disable-next-line no-console
    console.log(
      `bench: subs=${N} frames=${FRAMES} samples=${totalReceived} p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms drops=${drops}`,
    );

    // Assertions are deliberately generous; the goal is to certify the
    // pipeline copes, not to police absolute timings on shared CI.
    expect(totalReceived).toBeGreaterThan(N * FRAMES * 0.9); // <10% drop tolerance
    expect(p99).toBeLessThan(500); // 500ms ceiling on a loopback bench
  }, 30_000);
});
