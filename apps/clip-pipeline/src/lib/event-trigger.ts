/**
 * Auto-trigger module for the clip-pipeline.
 *
 * Subscribes to the stream-server's per-match WebSocket, filters for
 * "clip-worthy" events (goal, red card, penalty, match end), maps each one
 * to a clip-render config (in/out timestamps + format set + caption ctx),
 * submits the renders via the existing ClipQueue, then posts the resulting
 * clip metadata to the social-publisher service.
 *
 * Design notes:
 *   - The WS factory is injectable so tests can drive a fake transport.
 *   - Reconnect is exponential-backoff with a cap; the producer/stream-server
 *     fan-out is the source of truth so we never persist event state locally.
 *   - Active subscriptions are persisted to JSONL so a restart re-subscribes
 *     to in-flight matches without an operator nudge.
 *   - Failed publishes are appended to a JSONL "dead-letter" file for the
 *     orchestrator to retry.
 *   - Captions are rendered server-side from the bundled template config
 *     (no emojis allowed - validated at load time).
 *
 * What this module does NOT do:
 *   - Persist the queue itself (out of scope for v0.1; see queue.ts).
 *   - Retry failed publishes automatically. A retry worker can iterate the
 *     dead-letter file later (TODO in PR body).
 */

import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { Logger } from "pino";

const requireFromHere = createRequire(import.meta.url);

import {
  loadCaptionConfig,
  renderCaption,
  getTemplate,
  type CaptionConfig,
  type CaptionContext,
  type CaptionEventKey,
} from "../captions.js";
import type { ClipQueue } from "../queue.js";
import type { ClipFormat, ClipRequest, DetectorEvent } from "../types.js";

/** Event types that auto-trigger a clip render. */
export const CLIP_WORTHY_EVENT_TYPES = [
  "event.goal",
  "event.red_card",
  "event.penalty",
  "event.match_end",
] as const;
export type ClipWorthyEventType = (typeof CLIP_WORTHY_EVENT_TYPES)[number];

/**
 * Per-event-type render config. Mirrors the highlight-window choices in
 * highlights.ts but is separate so auto-triggered renders can be tuned
 * independently of the offline detector.
 */
export interface EventClipConfig {
  /** Window before the event (ms). */
  pre_ms: number;
  /** Window after the event (ms). */
  post_ms: number;
  /** Output formats to render. */
  formats: ClipFormat[];
}

const DEFAULT_EVENT_CONFIGS: Record<ClipWorthyEventType, EventClipConfig> = {
  "event.goal": { pre_ms: 7_000, post_ms: 10_000, formats: ["9:16", "1:1", "16:9"] },
  "event.red_card": { pre_ms: 4_000, post_ms: 8_000, formats: ["9:16", "16:9"] },
  "event.penalty": { pre_ms: 5_000, post_ms: 8_000, formats: ["9:16", "1:1", "16:9"] },
  "event.match_end": { pre_ms: 15_000, post_ms: 5_000, formats: ["9:16", "16:9"] },
};

// ---------- Spec event normalisation ----------

/**
 * Spec events for fouls use `severity: "red"` rather than a dedicated
 * `event.red_card` type. We normalise all flavours into the four
 * clip-worthy keys above so downstream code stays simple.
 */
export function normaliseEvent(raw: unknown): null | {
  type: ClipWorthyEventType;
  t: number;
  detector: DetectorEvent;
  scorer?: string;
  team?: string;
} {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || typeof e.t !== "number" || !Number.isFinite(e.t)) {
    return null;
  }
  const t = e.t;
  const player = typeof e.player === "string" ? e.player : undefined;
  const team = typeof e.team === "string" ? e.team : undefined;

  switch (e.type) {
    case "event.goal":
      return {
        type: "event.goal",
        t,
        detector: { t, type: "event.goal", ...(player ? { player } : {}), ...(team ? { team } : {}) },
        ...(player ? { scorer: player } : {}),
        ...(team ? { team } : {}),
      };
    case "event.foul":
      if (e.severity === "red") {
        return {
          type: "event.red_card",
          t,
          detector: {
            t,
            type: "event.foul",
            severity: "red",
            ...(player ? { player } : {}),
          },
          ...(player ? { scorer: player } : {}),
          ...(team ? { team } : {}),
        };
      }
      return null;
    case "event.penalty_attempt":
      return {
        type: "event.penalty",
        t,
        detector: {
          t,
          type: "event.penalty_attempt",
          ...(player ? { player } : {}),
          ...(typeof e.outcome === "string"
            ? { outcome: e.outcome as DetectorEvent["outcome"] }
            : {}),
        },
        ...(player ? { scorer: player } : {}),
        ...(team ? { team } : {}),
      };
    case "event.out_of_bounds":
      if (e.restart === "penalty") {
        return {
          type: "event.penalty",
          t,
          detector: { t, type: "event.out_of_bounds", restart: "penalty" },
        };
      }
      return null;
    case "event.match_end":
      return {
        type: "event.match_end",
        t,
        detector: { t, type: "event.match_end" },
      };
    default:
      return null;
  }
}

// ---------- WebSocket abstraction ----------

/**
 * Minimal WebSocket-shape we depend on. The production wiring uses the `ws`
 * package; tests pass an in-memory implementation that emits raw frames.
 */
export interface MinimalWS {
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: Buffer | ArrayBuffer | string) => void): void;
  on(event: "close", cb: (code: number, reason?: Buffer) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export type WSFactory = (url: string) => MinimalWS;

// ---------- Score tracker ----------

/**
 * Tracks current scoreline + team labels per active subscription so caption
 * placeholders ({home}, {away}, {score}) can be filled in.
 *
 * Sources, in order of precedence:
 *   1. `match.init` payload -> teams.
 *   2. `event.score_change` -> running score.
 *   3. Match-end events fall back to whatever the last known score was.
 */
interface MatchScoreboard {
  homeTeamId?: string;
  awayTeamId?: string;
  homeName?: string;
  awayName?: string;
  homeScore: number;
  awayScore: number;
  /** Match start wall-clock (ms epoch) - used to compute minute display. */
  startedAtEpoch?: number;
}

function newScoreboard(): MatchScoreboard {
  return { homeScore: 0, awayScore: 0 };
}

function captionContextFor(
  scoreboard: MatchScoreboard,
  ev: ReturnType<typeof normaliseEvent>,
): CaptionContext {
  if (!ev) return {};
  const minute = Math.max(0, Math.floor(ev.t / 60_000));
  const ctx: CaptionContext = {
    minute: `${minute}'`,
    score: `${scoreboard.homeScore}-${scoreboard.awayScore}`,
  };
  if (scoreboard.homeName ?? scoreboard.homeTeamId) {
    ctx.home = scoreboard.homeName ?? scoreboard.homeTeamId;
  }
  if (scoreboard.awayName ?? scoreboard.awayTeamId) {
    ctx.away = scoreboard.awayName ?? scoreboard.awayTeamId;
  }
  if (ev.scorer) ctx.scorer = ev.scorer;
  return ctx;
}

function applyMessageToScoreboard(scoreboard: MatchScoreboard, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const m = raw as Record<string, unknown>;
  if (m.type === "match.init") {
    const teams = (m as { teams?: Array<{ id?: string; name?: string; side?: string }> }).teams;
    if (Array.isArray(teams)) {
      for (const t of teams) {
        if (!t || typeof t !== "object") continue;
        if (t.side === "home") {
          if (typeof t.id === "string") scoreboard.homeTeamId = t.id;
          if (typeof t.name === "string") scoreboard.homeName = t.name;
        } else if (t.side === "away") {
          if (typeof t.id === "string") scoreboard.awayTeamId = t.id;
          if (typeof t.name === "string") scoreboard.awayName = t.name;
        }
      }
    }
    const startMs = (m as { start_ms?: number }).start_ms;
    if (typeof startMs === "number" && Number.isFinite(startMs)) {
      scoreboard.startedAtEpoch = startMs;
    }
    return;
  }
  if (m.type === "event.score_change") {
    if (typeof m.home === "number" && Number.isFinite(m.home)) scoreboard.homeScore = m.home;
    if (typeof m.away === "number" && Number.isFinite(m.away)) scoreboard.awayScore = m.away;
  }
}

// ---------- Publisher dispatch ----------

export interface PublishedClip {
  match_id: string;
  clip_id: string;
  event_type: ClipWorthyEventType;
  format: ClipFormat;
  start_ms: number;
  end_ms: number;
  caption: string;
  hashtags: string[];
  scoreboard: {
    home?: string;
    away?: string;
    score: string;
  };
  ts: number;
}

export interface PublisherClient {
  publish(payload: PublishedClip): Promise<{ ok: boolean; status?: number; error?: string }>;
}

export interface PublisherOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Default publisher client - POSTs to `baseUrl + /v1/publish` with the clip
 * metadata. Treats 2xx as success; everything else (incl. network errors) as
 * a failure that the caller will dead-letter.
 */
export function defaultPublisherClient(opts: PublisherOptions): PublisherClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1/publish`;
  return {
    async publish(payload: PublishedClip) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
        return { ok: false, status: res.status, error: `publisher ${res.status}` };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

// ---------- Persistence ----------

export interface TriggerStore {
  /** Append-or-replace a single (matchId, streamUrl) row. */
  upsert(matchId: string, streamUrl: string): Promise<void>;
  remove(matchId: string): Promise<void>;
  list(): Promise<Array<{ matchId: string; streamUrl: string }>>;
  /** Append a failed publish row for later retry. */
  recordFailedPublish(payload: PublishedClip & { error: string }): Promise<void>;
}

/**
 * JSONL-backed trigger store. The file is rewritten on each upsert/remove
 * (in-memory snapshot is the source of truth) so we don't grow forever and
 * stale rows can't resurrect deleted subscriptions.
 *
 * Failed-publishes file is purely append-only.
 */
export function jsonlTriggerStore(opts: { activePath: string; failedPath: string }): TriggerStore {
  const active = new Map<string, string>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    try {
      const txt = await fsp.readFile(opts.activePath, "utf8");
      for (const line of txt.split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as { matchId: string; streamUrl: string };
          if (typeof row.matchId === "string" && typeof row.streamUrl === "string") {
            active.set(row.matchId, row.streamUrl);
          }
        } catch {
          /* skip corrupt line */
        }
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
    loaded = true;
  }

  async function flush(): Promise<void> {
    await fsp.mkdir(path.dirname(opts.activePath), { recursive: true });
    const lines = [...active.entries()]
      .map(([matchId, streamUrl]) => JSON.stringify({ matchId, streamUrl }))
      .join("\n");
    await fsp.writeFile(opts.activePath, lines.length ? lines + "\n" : "", "utf8");
  }

  return {
    async upsert(matchId, streamUrl) {
      await ensureLoaded();
      active.set(matchId, streamUrl);
      await flush();
    },
    async remove(matchId) {
      await ensureLoaded();
      active.delete(matchId);
      await flush();
    },
    async list() {
      await ensureLoaded();
      return [...active.entries()].map(([matchId, streamUrl]) => ({ matchId, streamUrl }));
    },
    async recordFailedPublish(payload) {
      await fsp.mkdir(path.dirname(opts.failedPath), { recursive: true });
      await fsp.appendFile(opts.failedPath, JSON.stringify(payload) + "\n", "utf8");
    },
  };
}

// ---------- Source URL helper ----------

/**
 * Hint resolver - given a streamUrl + matchId, derive the input video URL the
 * encoder should pull from. For v0.1 the renderer/spec stream and the source
 * MP4 are co-located in the producer; the convention is the producer also
 * exposes `/v1/match/<id>/source.mp4`. Operators can override via env.
 */
export function deriveSourceUrl(streamUrl: string, matchId: string): string {
  const httpUrl = streamUrl.replace(/^ws/, "http");
  const stripped = httpUrl.replace(/\/v1\/match\/[^/]+$/, "");
  return `${stripped}/v1/match/${matchId}/source.mp4`;
}

// ---------- Subscription manager ----------

export interface MatchSubscriptionOptions {
  matchId: string;
  streamUrl: string;
  queue: ClipQueue;
  publisher: PublisherClient;
  store: TriggerStore;
  captions?: CaptionConfig;
  /** Inject in tests. */
  wsFactory?: WSFactory;
  /** Override per-event render configs in tests / per-tournament overrides. */
  eventConfigs?: Partial<Record<ClipWorthyEventType, EventClipConfig>>;
  /** Source-MP4 resolver. Defaults to deriveSourceUrl. */
  sourceFor?: (streamUrl: string, matchId: string) => string;
  log?: Logger;
  /** Reconnect backoff schedule (ms). Defaults to [1000, 2000, 5000, 10000]. */
  reconnectBackoffMs?: number[];
  now?: () => number;
}

interface ActiveSubscription {
  matchId: string;
  streamUrl: string;
  close(): void;
  /** Test hook - emit a raw spec-message JSON object as if it arrived on the WS. */
  _injectMessage(raw: unknown): Promise<void>;
}

/**
 * Subscribe to a match stream and trigger clips on clip-worthy events.
 * Returns a handle that owns the WS connection lifecycle.
 */
export function subscribeToMatchStream(opts: MatchSubscriptionOptions): ActiveSubscription {
  const log = opts.log;
  const captions = opts.captions ?? loadCaptionConfig();
  const eventConfigs = { ...DEFAULT_EVENT_CONFIGS, ...(opts.eventConfigs ?? {}) };
  const sourceFor = opts.sourceFor ?? deriveSourceUrl;
  const scoreboard = newScoreboard();
  const wsFactory = opts.wsFactory ?? defaultWSFactory();
  const backoff = opts.reconnectBackoffMs ?? [1_000, 2_000, 5_000, 10_000];
  const now = opts.now ?? Date.now;

  let ws: MinimalWS | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const handleRaw = async (raw: unknown): Promise<void> => {
    applyMessageToScoreboard(scoreboard, raw);
    const ev = normaliseEvent(raw);
    if (!ev) return;
    await dispatchEvent(ev);
  };

  const dispatchEvent = async (
    ev: NonNullable<ReturnType<typeof normaliseEvent>>,
  ): Promise<void> => {
    const cfg = eventConfigs[ev.type];
    if (!cfg) return;
    const start_ms = Math.max(0, ev.t - cfg.pre_ms);
    const end_ms = ev.t + cfg.post_ms;
    const ctx = captionContextFor(scoreboard, ev);
    const src = sourceFor(opts.streamUrl, opts.matchId);
    for (const format of cfg.formats) {
      const clipReq: ClipRequest = {
        match_id: opts.matchId,
        start_ms,
        end_ms,
        format,
        src,
        overlay: {
          ...(ctx.scorer ? { scorer: ctx.scorer } : {}),
          ...(ctx.minute ? { minute: ctx.minute } : {}),
          ...(ctx.home && ctx.away && ctx.score
            ? { scoreline: `${ctx.home} ${ctx.score} ${ctx.away}` }
            : {}),
        },
      };
      const { job } = opts.queue.submit(clipReq);
      const tpl = getTemplate(captions, ev.type as CaptionEventKey, format);
      const rendered = renderCaption(tpl, ctx);
      const payload: PublishedClip = {
        match_id: opts.matchId,
        clip_id: job.clip_id,
        event_type: ev.type,
        format,
        start_ms,
        end_ms,
        caption: rendered.caption,
        hashtags: rendered.hashtags,
        scoreboard: {
          ...(ctx.home ? { home: ctx.home } : {}),
          ...(ctx.away ? { away: ctx.away } : {}),
          score: ctx.score ?? "0-0",
        },
        ts: now(),
      };
      const result = await opts.publisher.publish(payload);
      if (!result.ok) {
        log?.warn(
          { matchId: opts.matchId, clipId: job.clip_id, error: result.error, status: result.status },
          "publisher dispatch failed; recording for retry",
        );
        await opts.store.recordFailedPublish({
          ...payload,
          error: result.error ?? `status ${result.status ?? "?"}`,
        });
      } else {
        log?.info(
          { matchId: opts.matchId, clipId: job.clip_id, eventType: ev.type, format },
          "clip dispatched to publisher",
        );
      }
    }
  };

  const connect = (): void => {
    if (closed) return;
    log?.info({ matchId: opts.matchId, streamUrl: opts.streamUrl }, "connecting to stream");
    ws = wsFactory(opts.streamUrl);
    ws.on("open", () => {
      attempt = 0;
      log?.info({ matchId: opts.matchId }, "stream connected");
    });
    ws.on("message", (data) => {
      let text: string;
      if (typeof data === "string") text = data;
      else if (data instanceof Buffer) text = data.toString("utf8");
      else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
      else return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      void handleRaw(parsed).catch((err) => {
        log?.warn({ err, matchId: opts.matchId }, "event handler threw");
      });
    });
    ws.on("error", (err) => {
      log?.warn({ err, matchId: opts.matchId }, "stream ws error");
    });
    ws.on("close", () => {
      ws = null;
      if (closed) return;
      const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 10_000;
      attempt += 1;
      log?.warn({ matchId: opts.matchId, delay, attempt }, "stream closed; will reconnect");
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  connect();

  return {
    matchId: opts.matchId,
    streamUrl: opts.streamUrl,
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close(1000, "stop");
        } catch {
          /* ignore */
        }
      }
    },
    async _injectMessage(raw: unknown) {
      await handleRaw(raw);
    },
  };
}

// ---------- Default WS factory ----------

/**
 * Lazily import `ws` so test files that pass their own factory don't need the
 * dep loaded.
 */
function defaultWSFactory(): WSFactory {
  return (url: string) => {
    // Lazily require `ws` so test paths that supply their own wsFactory don't
    // need it loaded. `createRequire` makes this work under ESM.
    const wsMod = requireFromHere("ws") as typeof import("ws");
    const sock = new wsMod.WebSocket(url);
    return {
      on(event: string, cb: (...args: unknown[]) => void) {
        sock.on(event, cb as (...a: unknown[]) => void);
      },
      close(code?: number, reason?: string) {
        sock.close(code, reason);
      },
    } as MinimalWS;
  };
}

// ---------- Subscription manager (multi-match) ----------

export interface SubscriptionManagerOptions {
  queue: ClipQueue;
  publisher: PublisherClient;
  store: TriggerStore;
  captions?: CaptionConfig;
  wsFactory?: WSFactory;
  eventConfigs?: Partial<Record<ClipWorthyEventType, EventClipConfig>>;
  sourceFor?: (streamUrl: string, matchId: string) => string;
  log?: Logger;
  now?: () => number;
}

export class SubscriptionManager {
  private readonly subs = new Map<string, ActiveSubscription>();

  constructor(private readonly opts: SubscriptionManagerOptions) {}

  /** Number of currently-active match subscriptions. */
  count(): number {
    return this.subs.size;
  }

  list(): Array<{ matchId: string; streamUrl: string }> {
    return [...this.subs.values()].map((s) => ({ matchId: s.matchId, streamUrl: s.streamUrl }));
  }

  has(matchId: string): boolean {
    return this.subs.has(matchId);
  }

  /** Test hook - inject a raw spec-message into a live subscription. */
  async _injectMessage(matchId: string, raw: unknown): Promise<void> {
    const sub = this.subs.get(matchId);
    if (!sub) throw new Error(`no active subscription for ${matchId}`);
    await sub._injectMessage(raw);
  }

  async start(matchId: string, streamUrl: string): Promise<void> {
    if (this.subs.has(matchId)) {
      // Re-binding the URL is allowed; close + reopen.
      this.subs.get(matchId)?.close();
      this.subs.delete(matchId);
    }
    const sub = subscribeToMatchStream({
      matchId,
      streamUrl,
      queue: this.opts.queue,
      publisher: this.opts.publisher,
      store: this.opts.store,
      ...(this.opts.captions ? { captions: this.opts.captions } : {}),
      ...(this.opts.wsFactory ? { wsFactory: this.opts.wsFactory } : {}),
      ...(this.opts.eventConfigs ? { eventConfigs: this.opts.eventConfigs } : {}),
      ...(this.opts.sourceFor ? { sourceFor: this.opts.sourceFor } : {}),
      ...(this.opts.log ? { log: this.opts.log } : {}),
      ...(this.opts.now ? { now: this.opts.now } : {}),
    });
    this.subs.set(matchId, sub);
    await this.opts.store.upsert(matchId, streamUrl);
  }

  async stop(matchId: string): Promise<boolean> {
    const sub = this.subs.get(matchId);
    if (!sub) {
      await this.opts.store.remove(matchId);
      return false;
    }
    sub.close();
    this.subs.delete(matchId);
    await this.opts.store.remove(matchId);
    return true;
  }

  /**
   * Re-hydrate from the persisted store. Called once at boot.
   */
  async resumeFromStore(): Promise<void> {
    const rows = await this.opts.store.list();
    for (const row of rows) {
      try {
        await this.start(row.matchId, row.streamUrl);
      } catch (err) {
        this.opts.log?.warn(
          { err, matchId: row.matchId },
          "failed to resume subscription on boot",
        );
      }
    }
  }

  closeAll(): void {
    for (const sub of this.subs.values()) sub.close();
    this.subs.clear();
  }
}
