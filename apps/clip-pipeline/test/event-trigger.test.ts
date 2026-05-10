/**
 * Auto-trigger tests. We never spin up a real WebSocket: the SubscriptionManager
 * accepts an injected wsFactory so we can drive a fake transport synchronously.
 *
 * Coverage:
 *   - Goal event triggers a clip-render with the correct (start_ms, end_ms)
 *     window and submits to the queue.
 *   - The dispatched social-publisher payload includes the rendered caption,
 *     hashtags, scoreboard, and the clip_id from the queue.
 *   - Red card / penalty / match-end events all map through correctly.
 *   - Publisher failure (non-2xx + thrown) writes a row to the failed-publish
 *     dead-letter file.
 *   - The JSONL store survives stop()/restart() round-trips.
 *   - The /v1/auto-trigger/start endpoint validates input and starts a sub.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/api.js";
import {
  jsonlTriggerStore,
  normaliseEvent,
  SubscriptionManager,
  subscribeToMatchStream,
  type MinimalWS,
  type PublishedClip,
  type PublisherClient,
  type WSFactory,
} from "../src/lib/event-trigger.js";
import { ClipQueue } from "../src/queue.js";
import type { FfmpegRunner } from "../src/ffmpeg.js";
import type { ClipRequest, DetectorEvent } from "../src/types.js";

interface RunnerProbe extends FfmpegRunner {
  calls: ClipRequest[];
}

function makeRunner(): RunnerProbe {
  const calls: ClipRequest[] = [];
  return {
    calls,
    async available() {
      return true;
    },
    async run(args) {
      // Synthesise the ClipRequest the queue submitted from the ffmpeg args.
      calls.push({
        match_id: "(captured-via-ffmpeg)",
        start_ms: args.start_ms,
        end_ms: args.end_ms,
        format: args.format,
        ...(args.overlay ? { overlay: args.overlay } : {}),
        src: args.inputPath,
      });
      await fs.writeFile(args.outputPath, Buffer.from("FAKE_MP4"));
      return { ok: true };
    },
  };
}

class FakeWS implements MinimalWS {
  private listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  closed = false;
  on(event: string, cb: (...a: unknown[]) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) cb(...args);
  }
  close(code?: number, reason?: string): void {
    this.closed = true;
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }
}

function makeWSFactory(): { factory: WSFactory; sockets: FakeWS[] } {
  const sockets: FakeWS[] = [];
  const factory: WSFactory = () => {
    const sock = new FakeWS();
    sockets.push(sock);
    // Simulate "open" on next microtask.
    queueMicrotask(() => sock.emit("open"));
    return sock;
  };
  return { factory, sockets };
}

interface PublisherProbe extends PublisherClient {
  calls: PublishedClip[];
  /** When set, replaces the default success response. */
  override?: () => Promise<{ ok: boolean; status?: number; error?: string }>;
}

function makePublisher(): PublisherProbe {
  const calls: PublishedClip[] = [];
  const probe: PublisherProbe = {
    calls,
    async publish(payload) {
      calls.push(payload);
      if (probe.override) return probe.override();
      return { ok: true, status: 202 };
    },
  };
  return probe;
}

let storage: string;
let dataDir: string;

beforeEach(async () => {
  storage = await fs.mkdtemp(path.join(tmpdir(), "clip-auto-storage-"));
  dataDir = await fs.mkdtemp(path.join(tmpdir(), "clip-auto-data-"));
});

afterEach(async () => {
  await fs.rm(storage, { recursive: true, force: true });
  await fs.rm(dataDir, { recursive: true, force: true });
});

function buildStore(): ReturnType<typeof jsonlTriggerStore> {
  return jsonlTriggerStore({
    activePath: path.join(dataDir, "active-triggers.jsonl"),
    failedPath: path.join(dataDir, "failed-publishes.jsonl"),
  });
}

describe("normaliseEvent", () => {
  it("maps event.goal to the goal key", () => {
    const out = normaliseEvent({ type: "event.goal", t: 60_000, player: "P_MESSI", team: "ARG" });
    expect(out?.type).toBe("event.goal");
    expect(out?.scorer).toBe("P_MESSI");
  });

  it("maps red-severity event.foul to event.red_card", () => {
    const out = normaliseEvent({ type: "event.foul", t: 70_000, player: "P_X", severity: "red" });
    expect(out?.type).toBe("event.red_card");
  });

  it("ignores yellow fouls", () => {
    expect(
      normaliseEvent({ type: "event.foul", t: 70_000, player: "P_X", severity: "yellow" }),
    ).toBeNull();
  });

  it("maps event.penalty_attempt to event.penalty", () => {
    const out = normaliseEvent({
      type: "event.penalty_attempt",
      t: 80_000,
      player: "P_X",
      team: "ARG",
      outcome: "scored",
    });
    expect(out?.type).toBe("event.penalty");
  });

  it("maps event.out_of_bounds with restart=penalty to event.penalty", () => {
    const out = normaliseEvent({ type: "event.out_of_bounds", t: 90_000, restart: "penalty" });
    expect(out?.type).toBe("event.penalty");
  });

  it("maps event.match_end through", () => {
    expect(normaliseEvent({ type: "event.match_end", t: 100_000 })?.type).toBe("event.match_end");
  });

  it("ignores unknown event types", () => {
    expect(normaliseEvent({ type: "event.kickoff", t: 0 })).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(normaliseEvent(null)).toBeNull();
    expect(normaliseEvent({ type: "event.goal" })).toBeNull();
    expect(normaliseEvent({ type: "event.goal", t: "not-a-number" })).toBeNull();
  });
});

describe("subscribeToMatchStream - goal flow", () => {
  it("renders a goal clip with the correct window and dispatches the publisher", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    const { factory } = makeWSFactory();

    const sub = subscribeToMatchStream({
      matchId: "ar-fr-2022",
      streamUrl: "ws://localhost:4002/v1/match/ar-fr-2022",
      queue,
      publisher,
      store,
      wsFactory: factory,
    });

    // Seed the scoreboard with a match.init payload.
    await sub._injectMessage({
      type: "match.init",
      teams: [
        { id: "ARG", name: "Argentina", side: "home" },
        { id: "FRA", name: "France", side: "away" },
      ],
    });
    await sub._injectMessage({
      type: "event.score_change",
      t: 60_000,
      home: 1,
      away: 0,
    });
    // The actual goal.
    await sub._injectMessage({
      type: "event.goal",
      t: 60_000,
      player: "P_MESSI",
      team: "ARG",
    });

    await queue.waitForIdle();
    sub.close();

    // Three formats render for goals.
    expect(ffmpeg.calls.length).toBe(3);
    for (const call of ffmpeg.calls) {
      expect(call.start_ms).toBe(60_000 - 7_000);
      expect(call.end_ms).toBe(60_000 + 10_000);
    }

    // Publisher saw three dispatches, each with caption + hashtags.
    expect(publisher.calls.length).toBe(3);
    const verticalCall = publisher.calls.find((c) => c.format === "9:16");
    expect(verticalCall).toBeDefined();
    expect(verticalCall?.caption).toContain("GOAL");
    expect(verticalCall?.caption).toContain("P_MESSI");
    expect(verticalCall?.caption).toContain("Argentina");
    expect(verticalCall?.caption).toContain("France");
    expect(verticalCall?.caption).toContain("1-0");
    expect(verticalCall?.hashtags).toContain("#Tournamental");
    expect(verticalCall?.event_type).toBe("event.goal");
    expect(verticalCall?.match_id).toBe("ar-fr-2022");
    expect(verticalCall?.clip_id).toMatch(/^clip_[0-9a-f]{16}$/);

    // No failed-publishes file written on the happy path.
    await expect(
      fs.readFile(path.join(dataDir, "failed-publishes.jsonl"), "utf8"),
    ).rejects.toThrow();
  });

  it("does not crash on malformed JSON or unknown events", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    const { factory } = makeWSFactory();

    const sub = subscribeToMatchStream({
      matchId: "m",
      streamUrl: "ws://localhost:4002/v1/match/m",
      queue,
      publisher,
      store,
      wsFactory: factory,
    });

    await sub._injectMessage({ type: "event.kickoff", t: 0, team: "ARG" });
    await sub._injectMessage({ type: "event.pass", t: 5_000, from: "A", target: { x: 0, y: 0 } });
    sub.close();
    expect(publisher.calls.length).toBe(0);
  });
});

describe("subscribeToMatchStream - red card / penalty / match end", () => {
  it("renders red-card, penalty, and match-end clips with the right windows", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    const { factory } = makeWSFactory();

    const sub = subscribeToMatchStream({
      matchId: "m",
      streamUrl: "ws://localhost:4002/v1/match/m",
      queue,
      publisher,
      store,
      wsFactory: factory,
    });

    await sub._injectMessage({
      type: "match.init",
      teams: [
        { id: "ARG", name: "Argentina", side: "home" },
        { id: "FRA", name: "France", side: "away" },
      ],
    });
    await sub._injectMessage({
      type: "event.foul",
      t: 70_000,
      player: "P_OTAMENDI",
      severity: "red",
    });
    await sub._injectMessage({
      type: "event.penalty_attempt",
      t: 80_000,
      player: "P_MBAPPE",
      team: "FRA",
      outcome: "scored",
    });
    await sub._injectMessage({ type: "event.match_end", t: 95_000 });

    await queue.waitForIdle();
    sub.close();

    const byEvent: Record<string, PublishedClip[]> = {};
    for (const c of publisher.calls) {
      (byEvent[c.event_type] ??= []).push(c);
    }
    expect(byEvent["event.red_card"]?.length).toBe(2); // 9:16 + 16:9
    expect(byEvent["event.penalty"]?.length).toBe(3); // 9:16 + 1:1 + 16:9
    expect(byEvent["event.match_end"]?.length).toBe(2); // 9:16 + 16:9

    // Window math.
    const red = byEvent["event.red_card"]![0]!;
    expect(red.start_ms).toBe(70_000 - 4_000);
    expect(red.end_ms).toBe(70_000 + 8_000);

    const pen = byEvent["event.penalty"]![0]!;
    expect(pen.start_ms).toBe(80_000 - 5_000);
    expect(pen.end_ms).toBe(80_000 + 8_000);

    const end = byEvent["event.match_end"]![0]!;
    expect(end.start_ms).toBe(95_000 - 15_000);
    expect(end.end_ms).toBe(95_000 + 5_000);

    // Captions don't contain any non-ASCII glyphs / emojis.
    for (const c of publisher.calls) {
      expect(c.caption).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
      for (const h of c.hashtags) expect(h).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});

describe("publisher dispatch failure", () => {
  it("dead-letters the payload on non-2xx response", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    publisher.override = async () => ({ ok: false, status: 404, error: "publisher 404" });
    const store = buildStore();
    const { factory } = makeWSFactory();

    const sub = subscribeToMatchStream({
      matchId: "m",
      streamUrl: "ws://localhost:4002/v1/match/m",
      queue,
      publisher,
      store,
      wsFactory: factory,
    });
    await sub._injectMessage({ type: "event.match_end", t: 95_000 });
    sub.close();

    const text = await fs.readFile(path.join(dataDir, "failed-publishes.jsonl"), "utf8");
    const rows = text.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.length).toBe(2); // 9:16 + 16:9
    expect(rows[0].error).toContain("publisher 404");
    expect(rows[0].event_type).toBe("event.match_end");
  });

  it("dead-letters when the publisher throws", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    publisher.override = async () => {
      throw new Error("ECONNREFUSED");
    };
    // Wrap with a thrown-handling decorator to mimic defaultPublisherClient.
    const safe: PublisherClient = {
      async publish(p) {
        try {
          return await publisher.publish(p);
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },
    };
    const store = buildStore();
    const { factory } = makeWSFactory();
    const sub = subscribeToMatchStream({
      matchId: "m",
      streamUrl: "ws://localhost:4002/v1/match/m",
      queue,
      publisher: safe,
      store,
      wsFactory: factory,
    });
    await sub._injectMessage({ type: "event.match_end", t: 95_000 });
    sub.close();

    const text = await fs.readFile(path.join(dataDir, "failed-publishes.jsonl"), "utf8");
    expect(text).toContain("ECONNREFUSED");
  });
});

describe("jsonlTriggerStore", () => {
  it("persists upserts and survives a fresh store instance", async () => {
    const opts = {
      activePath: path.join(dataDir, "active-triggers.jsonl"),
      failedPath: path.join(dataDir, "failed-publishes.jsonl"),
    };
    const a = jsonlTriggerStore(opts);
    await a.upsert("m1", "ws://h/v1/match/m1");
    await a.upsert("m2", "ws://h/v1/match/m2");
    const b = jsonlTriggerStore(opts);
    const list = await b.list();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.matchId).sort()).toEqual(["m1", "m2"]);
  });

  it("removes rows on stop", async () => {
    const opts = {
      activePath: path.join(dataDir, "active-triggers.jsonl"),
      failedPath: path.join(dataDir, "failed-publishes.jsonl"),
    };
    const a = jsonlTriggerStore(opts);
    await a.upsert("m1", "ws://h/v1/match/m1");
    await a.upsert("m2", "ws://h/v1/match/m2");
    await a.remove("m1");
    const b = jsonlTriggerStore(opts);
    const list = await b.list();
    expect(list.map((r) => r.matchId)).toEqual(["m2"]);
  });
});

describe("SubscriptionManager", () => {
  it("re-binds on duplicate start and reports counts", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    const { factory } = makeWSFactory();

    const mgr = new SubscriptionManager({ queue, publisher, store, wsFactory: factory });
    await mgr.start("m1", "ws://h/v1/match/m1");
    expect(mgr.count()).toBe(1);
    await mgr.start("m1", "ws://h/v1/match/m1?token=xyz");
    expect(mgr.count()).toBe(1);
    expect(mgr.list()[0]?.streamUrl).toContain("token=xyz");

    await mgr.stop("m1");
    expect(mgr.count()).toBe(0);
    mgr.closeAll();
  });

  it("resumes from store on boot", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    await store.upsert("resumed-match", "ws://h/v1/match/resumed-match");
    const { factory } = makeWSFactory();
    const mgr = new SubscriptionManager({ queue, publisher, store, wsFactory: factory });
    await mgr.resumeFromStore();
    expect(mgr.count()).toBe(1);
    expect(mgr.list()[0]?.matchId).toBe("resumed-match");
    mgr.closeAll();
  });
});

describe("HTTP /v1/auto-trigger", () => {
  async function setup() {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const publisher = makePublisher();
    const store = buildStore();
    const { factory } = makeWSFactory();
    const triggers = new SubscriptionManager({ queue, publisher, store, wsFactory: factory });
    const fetchEvents = async (): Promise<ReadonlyArray<DetectorEvent>> => [];
    const app = await buildApp({ queue, ffmpeg, fetchEvents, triggers });
    return { app, triggers, publisher };
  }

  it("starts a subscription and reports it in /healthz", async () => {
    const { app, triggers } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auto-trigger/start",
      payload: { matchId: "m-http", streamUrl: "ws://localhost:4002/v1/match/m-http" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; active_triggers: number };
    expect(body.ok).toBe(true);
    expect(body.active_triggers).toBe(1);

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect((health.json() as { active_triggers: number }).active_triggers).toBe(1);

    triggers.closeAll();
  });

  it("rejects an invalid streamUrl scheme", async () => {
    const { app, triggers } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auto-trigger/start",
      payload: { matchId: "m", streamUrl: "http://nope" },
    });
    expect(res.statusCode).toBe(400);
    triggers.closeAll();
  });

  it("returns 503 when the manager isn't wired", async () => {
    const ffmpeg = makeRunner();
    const queue = new ClipQueue({ ffmpeg, storagePath: storage });
    const fetchEvents = async (): Promise<ReadonlyArray<DetectorEvent>> => [];
    const app = await buildApp({ queue, ffmpeg, fetchEvents });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auto-trigger/start",
      payload: { matchId: "m", streamUrl: "ws://h" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("stops a subscription", async () => {
    const { app, triggers } = await setup();
    await app.inject({
      method: "POST",
      url: "/v1/auto-trigger/start",
      payload: { matchId: "m-stop", streamUrl: "ws://localhost:4002/v1/match/m-stop" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auto-trigger/stop",
      payload: { matchId: "m-stop" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stopped: boolean; active_triggers: number };
    expect(body.stopped).toBe(true);
    expect(body.active_triggers).toBe(0);
    triggers.closeAll();
  });
});
