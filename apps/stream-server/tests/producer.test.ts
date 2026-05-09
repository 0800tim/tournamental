/**
 * ProducerClient — reconnect, backoff, parse hardening.
 *
 * We inject a fake WebSocket so behaviour is deterministic without
 * spinning up a real server.
 */

import { describe, it, expect } from "vitest";
import pino from "pino";
import { ProducerClient } from "../src/producer";
import { FakeWS, makeInit, makeStateFrame, waitFor, nextTick } from "./helpers";

const silentLogger = pino({ level: "silent" });

function makeClient(seenMsgs: unknown[], factories: FakeWS[]) {
  const wsList: FakeWS[] = [];
  const factory = (_: string) => {
    const ws = new FakeWS();
    wsList.push(ws);
    factories.push(ws);
    return ws as unknown as import("ws").default;
  };
  const client = new ProducerClient({
    url: "ws://test/producer",
    logger: silentLogger,
    onMessage: (m) => seenMsgs.push(m),
    backoffMinMs: 1,
    backoffMaxMs: 5,
    wsFactory: factory,
  });
  return { client, wsList };
}

describe("ProducerClient", () => {
  it("connects, parses NDJSON, calls onMessage per line", async () => {
    const seen: unknown[] = [];
    const got: FakeWS[] = [];
    const { client } = makeClient(seen, got);
    client.start();
    await nextTick();
    got[0]!.open();
    await nextTick();
    got[0]!.push(JSON.stringify(makeInit("m-1")));
    got[0]!.push(JSON.stringify(makeStateFrame(50)));
    expect(seen).toHaveLength(2);
    expect(client.status().frames_in).toBe(2);
    expect(client.status().current_match_id).toBe("m-1");
    client.stop();
  });

  it("tolerates batched newline-delimited frames in one WS message", async () => {
    const seen: unknown[] = [];
    const got: FakeWS[] = [];
    const { client } = makeClient(seen, got);
    client.start();
    got[0]!.open();
    const batch =
      JSON.stringify(makeInit("m-batch")) +
      "\n" +
      JSON.stringify(makeStateFrame(10)) +
      "\n" +
      JSON.stringify(makeStateFrame(20)) +
      "\n";
    got[0]!.push(batch);
    expect(seen).toHaveLength(3);
    client.stop();
  });

  it("counts parse errors for non-JSON lines without crashing", async () => {
    const seen: unknown[] = [];
    const got: FakeWS[] = [];
    const { client } = makeClient(seen, got);
    client.start();
    got[0]!.open();
    got[0]!.push("{not json");
    got[0]!.push("{}"); // valid JSON but no `type`
    got[0]!.push(JSON.stringify(makeStateFrame(1)));
    expect(seen).toHaveLength(1); // only the valid state frame got delivered
    expect(client.status().parse_errors).toBe(2);
    expect(client.status().frames_in).toBe(1);
    client.stop();
  });

  it("reconnects with backoff on drop", async () => {
    const seen: unknown[] = [];
    const got: FakeWS[] = [];
    const { client } = makeClient(seen, got);
    client.start();
    got[0]!.open();
    expect(client.status().state).toBe("open");
    got[0]!.drop(); // remote closed
    await waitFor(() => got.length === 2, 1000);
    got[1]!.open();
    expect(client.status().state).toBe("open");
    expect(client.status().reconnects).toBeGreaterThanOrEqual(1);
    client.stop();
  });

  it("does not reconnect after stop()", async () => {
    const got: FakeWS[] = [];
    const { client } = makeClient([], got);
    client.start();
    got[0]!.open();
    client.stop();
    got[0]!.drop();
    await new Promise((res) => setTimeout(res, 30));
    expect(got).toHaveLength(1);
    expect(client.status().state).toBe("stopped");
  });

  it("transitions through states and calls onState", () => {
    const states: string[] = [];
    const got: FakeWS[] = [];
    const factory = () => {
      const ws = new FakeWS();
      got.push(ws);
      return ws as unknown as import("ws").default;
    };
    const client = new ProducerClient({
      url: "ws://test/x",
      logger: silentLogger,
      onMessage: () => {},
      onState: (s) => states.push(s),
      backoffMinMs: 1,
      backoffMaxMs: 5,
      wsFactory: factory,
    });
    client.start();
    got[0]!.open();
    client.stop();
    expect(states).toContain("connecting");
    expect(states).toContain("open");
    expect(states).toContain("stopped");
  });

  it("survives a wsFactory throw and schedules reconnect", async () => {
    const ok = new FakeWS();
    let calls = 0;
    const factory = () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return ok as unknown as import("ws").default;
    };
    const client = new ProducerClient({
      url: "ws://test/throw",
      logger: silentLogger,
      onMessage: () => {},
      backoffMinMs: 1,
      backoffMaxMs: 5,
      wsFactory: factory,
    });
    client.start();
    await waitFor(() => calls >= 2, 500);
    ok.open();
    expect(client.status().state).toBe("open");
    client.stop();
  });

  it("handles Buffer-format WS data", async () => {
    const seen: unknown[] = [];
    const got: FakeWS[] = [];
    const { client } = makeClient(seen, got);
    client.start();
    got[0]!.open();
    got[0]!.push(Buffer.from(JSON.stringify(makeStateFrame(7))));
    expect(seen).toHaveLength(1);
    client.stop();
  });
});
