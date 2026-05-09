import type {
  EventMessage,
  MatchInit,
  Message,
  PlayerState,
  StateFrame,
  Vec2,
  Vec3,
} from "@vtorn/spec";
import {
  isEvent,
  isMatchInit,
  isStateFrame,
} from "@vtorn/spec";
import type { StreamSource, StreamStatus } from "./store";

/**
 * Manifest mode: play a canned NDJSON stream of spec messages with
 * seekable bracket interpolation.
 *
 * The renderer demo ships AR-FR 2022 as a gzipped NDJSON dump produced
 * by `apps/statsbomb-replay`. Manifest mode loads the dump in one shot,
 * indexes it for seeking, and exposes a `ManifestController` so a UI
 * scrubber can drive the playhead directly.
 *
 * The same `MatchStore` shape is used in WS mode and manifest mode —
 * the only difference is that manifest mode keeps the full
 * `StateFrame[]` and `EventMessage[]` lists so seek lerps between
 * bracketing frames instead of replaying real-time arrivals.
 */

// ---------- shared types ----------

/**
 * Compact buffer of all messages parsed out of an NDJSON manifest, sorted
 * for seek-friendly access.
 */
export interface ManifestBuffer {
  init: MatchInit;
  /** State frames sorted ascending by `t`. */
  frames: StateFrame[];
  /** Event messages sorted ascending by `t`. */
  events: EventMessage[];
  /** Highest `t` across frames + events; used as the timeline upper bound. */
  durationMs: number;
}

/**
 * Controller surface a UI (timeline scrubber) holds onto. The controller
 * lives outside React so two views can share one playhead and the
 * driver does not have to round-trip through React state.
 */
export interface ManifestController {
  /** Total timeline length in ms (== `durationMs`). */
  durationMs: number;
  /** Current playhead in ms. */
  getTime(): number;
  /** Seek to `t_ms`; clamps to [0, durationMs]. Re-applies any newly-crossed events. */
  seek(t_ms: number): void;
  /** Toggle the wall-clock driver. Does not change the current time. */
  setPlaying(playing: boolean): void;
  isPlaying(): boolean;
  /** Set the playback rate multiplier. 1 = realtime; > 1 = faster. */
  setRate(rate: number): void;
  getRate(): number;
  /** Subscribe to time/state updates; returns unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Underlying buffer for things that need it (UI markers, debug). */
  buffer(): ManifestBuffer;
  /** Compute (lerped) state at an arbitrary t. Cheap; allocates one StateFrame. */
  getCurrentState(t_ms: number): StateFrame | null;
}

// ---------- ndjson parsing ----------

/**
 * Parse NDJSON text into a list of typed `Message`s. Skips blank lines and
 * logs (and drops) malformed lines so a single bad row doesn't take the
 * stream down.
 */
export function parseNdjson(text: string): Message[] {
  const out: Message[] = [];
  // Split on \n; manifests use unix line endings.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as Message);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[spec-client] manifest: dropping malformed line ${i + 1}:`, err);
    }
  }
  return out;
}

/**
 * Build a `ManifestBuffer` from a flat message list. Throws if the list
 * doesn't begin with a `match.init` — manifests are expected to be
 * complete spec streams.
 */
export function buildManifestBuffer(messages: Message[]): ManifestBuffer {
  let init: MatchInit | null = null;
  const frames: StateFrame[] = [];
  const events: EventMessage[] = [];

  for (const m of messages) {
    if (isMatchInit(m)) {
      init = m;
      continue;
    }
    if (isStateFrame(m)) {
      frames.push(m);
      continue;
    }
    if (isEvent(m)) {
      events.push(m);
    }
  }

  if (!init) {
    throw new Error("[spec-client] manifest is missing a match.init message");
  }

  frames.sort((a, b) => a.t - b.t);
  events.sort((a, b) => a.t - b.t);

  const lastFrameT = frames.length > 0 ? frames[frames.length - 1].t : 0;
  const lastEventT = events.length > 0 ? events[events.length - 1].t : 0;
  const durationMs = Math.max(lastFrameT, lastEventT);

  return { init, frames, events, durationMs };
}

// ---------- buffer queries (pure) ----------

/**
 * Find the index of the last frame with `t <= queryT`. Returns -1 if
 * `queryT` is before the first frame. Binary search; O(log n).
 */
export function findFrameIndex(frames: StateFrame[], queryT: number): number {
  if (frames.length === 0) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  if (queryT < frames[0].t) return -1;
  if (queryT >= frames[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= queryT) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Shortest-path angular interpolation in radians. */
function slerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2;
  const delta = ((b - a) % TAU + TAU * 1.5) % TAU - Math.PI;
  return a + delta * t;
}

/**
 * Compute the lerped `StateFrame` at time `t` against a sorted frame list.
 * Returns null if `t` precedes all frames or the buffer is empty.
 */
export function getStateAt(frames: StateFrame[], t: number): StateFrame | null {
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];

  const idx = findFrameIndex(frames, t);
  if (idx < 0) return frames[0];
  if (idx >= frames.length - 1) return frames[frames.length - 1];

  const a = frames[idx];
  const b = frames[idx + 1];
  const span = b.t - a.t;
  const alpha = span > 0 ? (t - a.t) / span : 0;

  // Build a player map for `b` so we can lerp with O(1) look-ups.
  const aMap = new Map<string, PlayerState>();
  for (const p of a.players) aMap.set(p.id, p);

  const players: PlayerState[] = b.players.map((bp) => {
    const ap = aMap.get(bp.id);
    if (!ap) return bp;
    return {
      id: bp.id,
      pos: lerp2(ap.pos, bp.pos, alpha),
      facing: slerpAngle(ap.facing, bp.facing, alpha),
      anim: bp.anim,
      has_ball: bp.has_ball,
      fatigue: bp.fatigue,
    };
  });

  return {
    type: "state",
    t,
    ball: {
      pos: lerp3(a.ball.pos, b.ball.pos, alpha),
      vel: b.ball.vel,
      carrier: b.ball.carrier ?? a.ball.carrier,
    },
    players,
    period: b.period ?? a.period,
    clock_display: b.clock_display ?? a.clock_display,
  };
}

// ---------- decompression / fetch ----------

/**
 * Fetch `url` and return the raw text. If the URL ends in `.gz` we
 * decompress with the platform `DecompressionStream("gzip")` API
 * (Chromium / Safari ≥ 16.4 / Firefox ≥ 113).
 *
 * In Node-test environments the helper is bypassed entirely — see
 * `manifestSourceFromText` and `buildManifestBuffer` for direct entry.
 */
export async function fetchManifestText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[spec-client] manifest fetch failed: ${res.status} ${res.statusText}`);
  }
  const isGz = url.toLowerCase().endsWith(".gz");
  if (!isGz) {
    return res.text();
  }
  if (typeof DecompressionStream === "undefined" || !res.body) {
    throw new Error(
      "[spec-client] manifest is gzipped but DecompressionStream is unavailable in this runtime"
    );
  }
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// ---------- controller ----------

/** Internal listener bag. */
class Listeners {
  private subs = new Set<() => void>();
  add(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  emit(): void {
    for (const cb of this.subs) cb();
  }
}

interface CreateControllerOptions {
  buffer: ManifestBuffer;
  /** Initial playhead (ms). Default 0. */
  startTime?: number;
  /** Initial play state. Default true. */
  startPlaying?: boolean;
  /** Initial playback rate. Default 1. */
  startRate?: number;
}

/**
 * Build a `ManifestController` over a parsed buffer. Pure function;
 * does NOT start the wall-clock driver — that's the source's job.
 */
export function createManifestController(opts: CreateControllerOptions): ManifestController {
  const { buffer } = opts;
  let time = clamp(opts.startTime ?? 0, 0, buffer.durationMs);
  let playing = opts.startPlaying ?? true;
  let rate = opts.startRate ?? 1;
  const listeners = new Listeners();

  return {
    get durationMs() {
      return buffer.durationMs;
    },
    getTime: () => time,
    seek(t) {
      time = clamp(t, 0, buffer.durationMs);
      listeners.emit();
    },
    setPlaying(p) {
      playing = p;
      listeners.emit();
    },
    isPlaying: () => playing,
    setRate(r) {
      rate = Math.max(0, r);
      listeners.emit();
    },
    getRate: () => rate,
    subscribe: (cb) => listeners.add(cb),
    buffer: () => buffer,
    getCurrentState(t) {
      return getStateAt(buffer.frames, t);
    },
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// ---------- StreamSource adapters ----------

export interface ManifestSourceOptions {
  /** Optional starting playhead. Default 0. */
  startTime?: number;
  /** Whether to start playing on connect. Default true. */
  autoplay?: boolean;
  /** Initial playback rate. Default 1. */
  rate?: number;
  /**
   * Hook to receive the controller as soon as the manifest finishes
   * loading. UIs that own a scrubber call `seek()` etc on this.
   */
  onReady?: (controller: ManifestController) => void;
}

interface DriverState {
  controller: ManifestController;
  emittedInit: boolean;
  /** Index of the next event to flush (sorted ascending). */
  eventCursor: number;
  /** Last applied state-frame time, used to know when to re-emit a frame. */
  lastEmittedT: number;
  /** Last wall-clock time we ticked at. */
  lastWallMs: number;
}

const DRIVER_FPS = 30;

/**
 * Wall-clock driver that walks `controller.time` forward at `rate` and
 * emits messages to the renderer on every tick. Re-emits a fresh
 * `StateFrame` every tick so the store has prev/curr to lerp; flushes
 * any events whose `t` is between the previous and current playhead.
 *
 * On seek, fires a synthetic state frame at the new time and re-walks
 * the event cursor.
 */
function startDriver(
  state: DriverState,
  onMessage: (m: Message) => void,
  onStatus: (s: StreamStatus) => void,
): { stop: () => void } {
  const { controller } = state;
  const buffer = controller.buffer();

  // Emit init once.
  if (!state.emittedInit) {
    onMessage(buffer.init);
    state.emittedInit = true;
  }
  onStatus("synthetic");

  // Catch the cursor up to the start time so we don't replay history.
  state.eventCursor = firstEventAtOrAfter(buffer.events, controller.getTime());

  // Push an initial state frame so renderers have something to draw.
  const initial = controller.getCurrentState(controller.getTime());
  if (initial) {
    onMessage(initial);
    state.lastEmittedT = initial.t;
  }
  state.lastWallMs = nowMs();

  const tickIntervalMs = 1000 / DRIVER_FPS;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    const now = nowMs();
    const dtWall = now - state.lastWallMs;
    state.lastWallMs = now;

    if (controller.isPlaying()) {
      const advance = dtWall * controller.getRate();
      const next = controller.getTime() + advance;
      if (next >= buffer.durationMs) {
        controller.seek(buffer.durationMs);
        controller.setPlaying(false);
      } else {
        controller.seek(next);
      }
    }
    flushFrame(state, onMessage);
  };

  // Subscribe to seek events: when the user scrubs, we flush a frame on the
  // next animation frame so the renderer redraws immediately, regardless
  // of the rate.
  let dirty = false;
  const unsubscribe = controller.subscribe(() => {
    dirty = true;
    // Reset the event cursor — a backward scrub means events ahead of the
    // new time are pending again; a forward scrub past events skips them.
    state.eventCursor = firstEventAtOrAfter(buffer.events, controller.getTime());
  });

  // Run a small dirty-check on the same timer so we avoid double-emitting.
  timer = setInterval(() => {
    if (dirty) {
      dirty = false;
      flushFrame(state, onMessage);
    }
    tick();
  }, tickIntervalMs);

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      unsubscribe();
    },
  };
}

function firstEventAtOrAfter(events: EventMessage[], t: number): number {
  // Linear scan; events are typically <100 in a match. Could binary search
  // if this ever shows up in profiles.
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].t >= t) return i;
  }
  return events.length;
}

function flushFrame(state: DriverState, onMessage: (m: Message) => void): void {
  const t = state.controller.getTime();
  const frame = state.controller.getCurrentState(t);
  if (frame && frame.t !== state.lastEmittedT) {
    onMessage(frame);
    state.lastEmittedT = frame.t;
  } else if (frame) {
    // Same `t` (idle frame) — emit a fresh frame at controller.time so the
    // store still updates wall-clock timestamps and components animate.
    onMessage({ ...frame, t });
    state.lastEmittedT = t;
  }

  // Drain events with t <= playhead.
  const buffer = state.controller.buffer();
  while (state.eventCursor < buffer.events.length) {
    const ev = buffer.events[state.eventCursor];
    if (ev.t > t) break;
    onMessage(ev);
    state.eventCursor += 1;
  }
}

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Build a `StreamSource` from an NDJSON URL (gzipped or plain).
 *
 * Usage:
 *   const source = manifestSource("/data/foo.ndjson.gz", { onReady: setController });
 *   useMatchStream(source);
 *
 * The `onReady` callback fires once the manifest has loaded and parsed,
 * with a `ManifestController` that drives play/pause/seek/rate. The
 * source synchronously emits `match.init` and the first state frame
 * once the manifest is parsed.
 */
export function manifestSource(url: string, opts: ManifestSourceOptions = {}): StreamSource {
  let driver: { stop: () => void } | null = null;
  let stopped = false;

  return {
    start(onMessage, onStatus) {
      // Reset stopped flag so the source can be restarted (React StrictMode
      // mounts useEffect twice in dev, so start->stop->start happens on
      // every mount; without this reset the second start would short-circuit
      // and the renderer would stay stuck on "Connecting…").
      stopped = false;
      onStatus("connecting");
      void (async () => {
        try {
          const text = await fetchManifestText(url);
          if (stopped) return;
          const messages = parseNdjson(text);
          const buffer = buildManifestBuffer(messages);
          const controller = createManifestController({
            buffer,
            startTime: opts.startTime,
            startPlaying: opts.autoplay !== false,
            startRate: opts.rate,
          });
          opts.onReady?.(controller);
          if (stopped) return;
          driver = startDriver(
            {
              controller,
              emittedInit: false,
              eventCursor: 0,
              lastEmittedT: -1,
              lastWallMs: nowMs(),
            },
            onMessage,
            onStatus,
          );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[spec-client] manifest source failed:", err);
          onStatus("error");
        }
      })();
    },
    stop() {
      stopped = true;
      driver?.stop();
      driver = null;
    },
  };
}

/**
 * Test-only helper: build a `StreamSource` from raw NDJSON text. Skips
 * the network fetch path so tests don't depend on `DecompressionStream`
 * or `fetch`. The `onReady` callback fires synchronously inside `start`.
 */
export function manifestSourceFromText(
  text: string,
  opts: ManifestSourceOptions = {},
): StreamSource {
  const messages = parseNdjson(text);
  const buffer = buildManifestBuffer(messages);
  const controller = createManifestController({
    buffer,
    startTime: opts.startTime,
    startPlaying: opts.autoplay !== false,
    startRate: opts.rate,
  });

  let driver: { stop: () => void } | null = null;
  let stopped = false;

  return {
    start(onMessage, onStatus) {
      if (stopped) return;
      opts.onReady?.(controller);
      driver = startDriver(
        {
          controller,
          emittedInit: false,
          eventCursor: 0,
          lastEmittedT: -1,
          lastWallMs: nowMs(),
        },
        onMessage,
        onStatus,
      );
    },
    stop() {
      stopped = true;
      driver?.stop();
      driver = null;
    },
  };
}
