/**
 * SubscriberHub tests using a fake WebSocket-shaped object so we don't
 * need a TCP listener.
 */

import { describe, it, expect } from "vitest";
import pino from "pino";
import { EventEmitter } from "node:events";
import { SubscriberHub } from "../src/hub";
import { makeStateFrame, waitFor, nextTick } from "./helpers";

const silent = pino({ level: "silent" });

class StubWS extends EventEmitter {
  readyState = 1; // OPEN
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
  sent: string[] = [];
  closed = false;
  /** If set, send() will hang for this many ms before invoking the callback. */
  sendDelayMs = 0;

  send(line: string, cb?: (err?: Error) => void): void {
    if (this.sendDelayMs > 0) {
      setTimeout(() => {
        this.sent.push(line);
        cb?.();
      }, this.sendDelayMs);
    } else {
      this.sent.push(line);
      cb?.();
    }
  }

  close(): void {
    this.readyState = 3;
    this.closed = true;
    this.emit("close");
  }
}

function addSub(hub: SubscriberHub, ws: StubWS, ip = "1.2.3.4", matchId = "m") {
  const res = hub.add(
    {
      ws: ws as unknown as import("ws").WebSocket,
      matchId,
      ip,
      queueMax: 10,
      stallMs: 5_000,
      logger: silent,
    },
    { perIp: 100, total: 1000 },
  );
  if ("rejected" in res) throw new Error(`unexpected rejection: ${res.rejected}`);
  return res;
}

describe("SubscriberHub", () => {
  it("fans out a frame to all subscribers of a match", async () => {
    const hub = new SubscriberHub(silent);
    const a = new StubWS();
    const b = new StubWS();
    addSub(hub, a, "1.1.1.1");
    addSub(hub, b, "2.2.2.2");
    hub.broadcast("m", makeStateFrame(1));
    await waitFor(() => a.sent.length === 1 && b.sent.length === 1);
    expect(JSON.parse(a.sent[0]!).t).toBe(1);
    expect(JSON.parse(b.sent[0]!).t).toBe(1);
  });

  it("does not deliver to subscribers of a different match", async () => {
    const hub = new SubscriberHub(silent);
    const a = new StubWS();
    addSub(hub, a, "ip", "match-A");
    hub.broadcast("match-B", makeStateFrame(1));
    await nextTick();
    expect(a.sent).toHaveLength(0);
  });

  it("rejects above per-IP cap", () => {
    const hub = new SubscriberHub(silent);
    const cap = { perIp: 2, total: 100 };
    const a = new StubWS();
    const b = new StubWS();
    const c = new StubWS();
    expect("rejected" in hub.add({ ws: a as never, matchId: "m", ip: "1", queueMax: 10, stallMs: 5000, logger: silent }, cap)).toBe(false);
    expect("rejected" in hub.add({ ws: b as never, matchId: "m", ip: "1", queueMax: 10, stallMs: 5000, logger: silent }, cap)).toBe(false);
    const r = hub.add({ ws: c as never, matchId: "m", ip: "1", queueMax: 10, stallMs: 5000, logger: silent }, cap);
    expect("rejected" in r && r.rejected).toBe("per_ip");
  });

  it("rejects above total cap", () => {
    const hub = new SubscriberHub(silent);
    const cap = { perIp: 100, total: 1 };
    const a = new StubWS();
    const b = new StubWS();
    expect("rejected" in hub.add({ ws: a as never, matchId: "m", ip: "1", queueMax: 10, stallMs: 5000, logger: silent }, cap)).toBe(false);
    const r = hub.add({ ws: b as never, matchId: "m", ip: "2", queueMax: 10, stallMs: 5000, logger: silent }, cap);
    expect("rejected" in r && r.rejected).toBe("total");
  });

  it("decrements counts on close", async () => {
    const hub = new SubscriberHub(silent);
    const a = new StubWS();
    addSub(hub, a, "1");
    expect(hub.totalCount()).toBe(1);
    a.close();
    await nextTick();
    expect(hub.totalCount()).toBe(0);
    expect(hub.countByMatch("m")).toBe(0);
  });

  it("drops frames from front for slow subscribers without blocking", async () => {
    const hub = new SubscriberHub(silent);
    const slow = new StubWS();
    slow.sendDelayMs = 50; // each send takes 50ms; queue will fill quickly
    addSub(hub, slow);
    const start = Date.now();
    // Push way more than queueMax (10) instantly; should not block.
    for (let i = 0; i < 200; i++) hub.broadcast("m", makeStateFrame(i));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // broadcast must not await per-subscriber send
    // Eventually the subscriber will register a high drop count.
    await waitFor(() => hub.totalDropped() >= 100, 5000);
    expect(hub.totalDropped()).toBeGreaterThan(0);
  });

  it("closes hopelessly-stalled subscribers after stallMs", async () => {
    const hub = new SubscriberHub(silent);
    const stuck = new StubWS();
    stuck.sendDelayMs = 10_000; // never returns within the test
    const sub = hub.add(
      {
        ws: stuck as never,
        matchId: "m",
        ip: "1",
        queueMax: 5,
        stallMs: 30, // small for the test
        logger: silent,
      },
      { perIp: 10, total: 10 },
    );
    if ("rejected" in sub) throw new Error("unexpected reject");
    // Drive the subscriber into "queue full" + wait past stallMs.
    for (let i = 0; i < 50; i++) hub.broadcast("m", makeStateFrame(i));
    await new Promise((res) => setTimeout(res, 60));
    for (let i = 50; i < 100; i++) hub.broadcast("m", makeStateFrame(i));
    await waitFor(() => stuck.closed, 1000);
    expect(stuck.closed).toBe(true);
  });

  it("describe() lists all subscribers", () => {
    const hub = new SubscriberHub(silent);
    addSub(hub, new StubWS(), "1.1.1.1", "m1");
    addSub(hub, new StubWS(), "2.2.2.2", "m2");
    const list = hub.describe();
    expect(list).toHaveLength(2);
    const ids = list.map((d) => d.match_id).sort();
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("closeAll terminates all subscribers", () => {
    const hub = new SubscriberHub(silent);
    const a = new StubWS();
    const b = new StubWS();
    addSub(hub, a, "1");
    addSub(hub, b, "2");
    hub.closeAll();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(hub.totalCount()).toBe(0);
  });
});
