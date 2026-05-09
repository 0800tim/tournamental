/**
 * End-to-end server tests using a real HTTP listener + real ws clients.
 * We disable upstream producers (`startProducers: false`) and inject
 * messages directly via `pipeline.injectForTest()`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { buildServer, type BuiltServer } from "../src/server";
import { loadConfig } from "../src/config";
import { Pipeline } from "../src/pipeline";
import pino from "pino";
import { makeInit, makeStateFrame, makeGoalEvent, waitFor } from "./helpers";

const silent = pino({ level: "silent" });

interface RunningServer extends BuiltServer {
  port: number;
}

async function startTestServer(overrides: Partial<ReturnType<typeof loadConfig>> = {}): Promise<RunningServer> {
  const baseConfig = loadConfig({});
  const config = {
    ...baseConfig,
    port: 0,
    bind: "127.0.0.1",
    producerUrls: [],
    adminToken: "",
    subscriberQueueMax: 50,
    ...overrides,
  };
  const pipeline = new Pipeline({ config, logger: silent });
  const built = await buildServer({ config, pipeline, startProducers: false });
  await built.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = built.app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { ...built, port: addr.port };
}

function makeClient(port: number, matchId: string): Promise<{ ws: WebSocket; received: string[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/match/${matchId}`);
    const received: string[] = [];
    ws.on("message", (data) => received.push(data.toString()));
    ws.once("open", () => res({ ws, received }));
    ws.once("error", rej);
  });
}

async function httpJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const r = await fetch(url, { headers });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

describe("stream-server end-to-end", () => {
  let server: RunningServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(async () => {
    await server.shutdown();
  });

  it("GET / returns service descriptor with spec_version", async () => {
    const { status, body } = await httpJson(`http://127.0.0.1:${server.port}/`);
    expect(status).toBe(200);
    expect(body.service).toBe("@vtorn/stream-server");
    expect(body.spec_version).toBe("0.1.1");
    expect(body.subscribe).toMatch(/v1\/match/);
  });

  it("GET /healthz returns ok=true with no producers configured", async () => {
    const { status, body } = await httpJson(`http://127.0.0.1:${server.port}/healthz`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.subscribers).toBe(0);
  });

  it("GET /admin/status returns 503 when no token configured", async () => {
    const { status, body } = await httpJson(`http://127.0.0.1:${server.port}/admin/status`);
    expect(status).toBe(503);
    expect(body.error).toBe("admin_disabled");
  });

  it("rejects WS upgrade for an unknown URL path with 404", async () => {
    await expect(
      new Promise<void>((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/not-a-match`);
        ws.once("open", () => {
          ws.close();
          rej(new Error("should not have opened"));
        });
        ws.once("unexpected-response", (_req, response) => {
          expect(response.statusCode).toBe(404);
          res();
        });
        ws.once("error", () => res()); // some ws versions surface error before unexpected-response
      }),
    ).resolves.toBeUndefined();
  });

  it("delivers init + state frames to a fresh subscriber", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-1"));
    server.pipeline.injectForTest("upstream-A", makeStateFrame(0));
    server.pipeline.injectForTest("upstream-A", makeStateFrame(33));
    const { ws, received } = await makeClient(server.port, "m-1");
    await waitFor(() => received.length >= 4);
    const types = received.map((r) => JSON.parse(r).type);
    expect(types[0]).toBe("x_hello");
    expect(types).toContain("match.init");
    expect(types).toContain("state");
    ws.close();
  });

  it("hello message includes ring summary with matching match_id", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-2"));
    server.pipeline.injectForTest("upstream-A", makeStateFrame(0));
    const { ws, received } = await makeClient(server.port, "m-2");
    await waitFor(() => received.length >= 1);
    const hello = JSON.parse(received[0]!);
    expect(hello.type).toBe("x_hello");
    expect(hello.match_id).toBe("m-2");
    expect(hello.ring.match_id).toBe("m-2");
    expect(hello.ring.has_init).toBe(true);
    ws.close();
  });

  it("fans out a live broadcast to multiple subscribers", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-3"));
    const c1 = await makeClient(server.port, "m-3");
    const c2 = await makeClient(server.port, "m-3");
    const c3 = await makeClient(server.port, "m-3");
    // Wait for the hello + init priming on each.
    await waitFor(() => c1.received.length >= 2 && c2.received.length >= 2 && c3.received.length >= 2);
    server.pipeline.injectForTest("upstream-A", makeStateFrame(100));
    server.pipeline.injectForTest("upstream-A", makeGoalEvent(110));
    await waitFor(
      () =>
        c1.received.length >= 4 &&
        c2.received.length >= 4 &&
        c3.received.length >= 4,
      3000,
    );
    for (const c of [c1, c2, c3]) {
      const types = c.received.map((r) => JSON.parse(r).type);
      expect(types).toContain("event.goal");
      c.ws.close();
    }
  });

  it("subscribers for match A do not see frames for match B", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-A"));
    server.pipeline.injectForTest("upstream-B", makeInit("m-B"));
    const a = await makeClient(server.port, "m-A");
    const b = await makeClient(server.port, "m-B");
    await waitFor(() => a.received.length >= 2 && b.received.length >= 2);
    server.pipeline.injectForTest("upstream-B", makeStateFrame(5));
    await waitFor(() => b.received.length >= 3);
    expect(b.received.some((r) => JSON.parse(r).type === "state")).toBe(true);
    expect(a.received.some((r) => JSON.parse(r).type === "state")).toBe(false);
    a.ws.close();
    b.ws.close();
  });

  it("admin/status with valid bearer returns full snapshot", async () => {
    await server.shutdown();
    server = await startTestServer({ adminToken: "secret-xyz" });
    server.pipeline.injectForTest("upstream-A", makeInit("m-admin"));
    server.pipeline.injectForTest("upstream-A", makeStateFrame(0));
    const { status, body } = await httpJson(
      `http://127.0.0.1:${server.port}/admin/status`,
      { Authorization: "Bearer secret-xyz" },
    );
    expect(status).toBe(200);
    expect(body.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ match_id: "m-admin" }),
      ]),
    );
    expect(body.limits.per_ip).toBeGreaterThan(0);
    expect(body.limits.total).toBeGreaterThan(0);
  });

  it("admin/status with bad bearer returns 401", async () => {
    await server.shutdown();
    server = await startTestServer({ adminToken: "secret-xyz" });
    const { status } = await httpJson(
      `http://127.0.0.1:${server.port}/admin/status`,
      { Authorization: "Bearer wrong" },
    );
    expect(status).toBe(401);
  });

  it("enforces per-IP connection cap", async () => {
    await server.shutdown();
    server = await startTestServer({ maxConnsPerIp: 2 });
    server.pipeline.injectForTest("upstream-A", makeInit("m-cap"));
    const a = await makeClient(server.port, "m-cap");
    const b = await makeClient(server.port, "m-cap");
    // Third should be rejected and closed promptly.
    const closed = new Promise<number>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/match/m-cap`);
      ws.once("close", (code) => res(code));
    });
    const code = await closed;
    expect(code).toBe(1013);
    a.ws.close();
    b.ws.close();
  });

  it("late subscriber receives buffered ring frames", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-late"));
    for (let t = 0; t < 5; t++) {
      server.pipeline.injectForTest("upstream-A", makeStateFrame(t * 10));
    }
    const c = await makeClient(server.port, "m-late");
    await waitFor(() => c.received.length >= 7); // hello + init + 5 frames
    const types = c.received.map((r) => JSON.parse(r).type);
    const stateCount = types.filter((t) => t === "state").length;
    expect(stateCount).toBe(5);
    c.ws.close();
  });

  it("healthz reports ring_age_ms after frames flow", async () => {
    server.pipeline.injectForTest("upstream-A", makeInit("m-fresh"));
    server.pipeline.injectForTest("upstream-A", makeStateFrame(0));
    await new Promise((r) => setTimeout(r, 30));
    const { body } = await httpJson(`http://127.0.0.1:${server.port}/healthz`);
    expect(body.ring_age_ms).toBeGreaterThanOrEqual(0);
    expect(body.ring_age_ms).toBeLessThan(2000);
  });
});
