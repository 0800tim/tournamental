import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  EventMessage,
  MatchInit,
  Message,
  StateFrame,
} from "@vtorn/spec";

/**
 * Connection status for the underlying stream source.
 */
export type StreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error"
  | "synthetic";

/**
 * The bounded ring buffer length for events. Sized to comfortably exceed a
 * single match's event count (~1500 for AR-FR 2022) so HUD aggregators
 * (`computeMatchStats`) never lose a goal/foul/sub from the early phases by
 * the time the playhead is in stoppage time. Live-WS callers that worry
 * about unbounded growth can tune this if they need to.
 */
export const EVENT_RING_SIZE = 4096;

export interface MatchStore {
  /** Most recent MatchInit; null until the producer has emitted it. */
  init: MatchInit | null;

  /** The previous and current state frames, used for client-side lerping. */
  prev: StateFrame | null;
  curr: StateFrame | null;

  /** Wall-clock ms when prev / curr arrived (Date.now()), for interpolation. */
  prevWallMs: number;
  currWallMs: number;

  /** Bounded ring buffer of recent events. Newest last. */
  events: EventMessage[];

  /**
   * The most recent commentary line for HUD ticker display. We keep this
   * separate from `events` for cheap reads from the HUD render path.
   */
  commentary: string | null;

  /** The most recent score-change event, if any (used for HUD score). */
  score: { home: number; away: number };

  /** Penalty shootout score (separate from regulation score). */
  shootout: { home: number; away: number; active: boolean; ended: boolean };

  /** Most recent period number (1, 2, 3=ET1, 4=ET2, 5=pens). */
  period: number;

  /** Most recent clock display string (sport-specific format). */
  clockDisplay: string | null;

  /** Round-trip latency proxy (ms). Updated on each state frame. */
  lagMs: number;

  /** Connection status for diagnostics. */
  status: StreamStatus;

  /** Total state frames received since match start. */
  frameCount: number;

  // ---------- mutators (used by the stream driver, not by components) ----------
  applyMessage(msg: Message): void;
  setStatus(s: StreamStatus): void;
  reset(): void;
}

export type MatchStoreApi = StoreApi<MatchStore>;

/**
 * A "stream source" abstracts away "WebSocket vs in-process synthetic stream
 * vs canned ndjson playback". It hands the driver one Message at a time and
 * lets it cleanly tear down.
 */
export interface StreamSource {
  start(onMessage: (m: Message) => void, onStatus: (s: StreamStatus) => void): void;
  stop(): void;
}

const initialState = {
  init: null,
  prev: null,
  curr: null,
  prevWallMs: 0,
  currWallMs: 0,
  events: [] as EventMessage[],
  commentary: null,
  score: { home: 0, away: 0 },
  shootout: { home: 0, away: 0, active: false, ended: false },
  period: 1,
  clockDisplay: null,
  lagMs: 0,
  status: "idle" as StreamStatus,
  frameCount: 0,
};

export function createMatchStore(): MatchStoreApi {
  return createStore<MatchStore>((set, get) => ({
    ...initialState,

    applyMessage(msg) {
      if (msg.type === "match.init") {
        // `match.init` is the canonical "start (or restart) of a match"
        // signal. In manifest mode the driver re-emits it after a user
        // seek so the store rebuilds cumulative state (score, period,
        // shootout, events ring buffer) from scratch as it re-drains the
        // event log up to the new playhead. Without this reset, a
        // forward scrub would silently skip the score_change events
        // between the old and new playhead and the scoreboard would
        // stay stuck at the pre-scrub score (the AR-FR "0-0 at 86'" bug).
        const preservedStatus =
          get().status === "idle" ? "open" : get().status;
        set({ ...initialState, init: msg, status: preservedStatus });
        return;
      }

      if (msg.type === "state") {
        const now = Date.now();
        const prev = get().curr;
        set({
          prev,
          prevWallMs: prev ? get().currWallMs : now,
          curr: msg,
          currWallMs: now,
          period: msg.period ?? get().period,
          clockDisplay: msg.clock_display ?? get().clockDisplay,
          lagMs: prev ? Math.max(0, now - get().currWallMs) : 0,
          frameCount: get().frameCount + 1,
        });
        return;
      }

      // EventMessage
      const events = get().events.concat(msg);
      if (events.length > EVENT_RING_SIZE) {
        events.splice(0, events.length - EVENT_RING_SIZE);
      }
      const patch: Partial<MatchStore> = { events };

      switch (msg.type) {
        case "event.score_change":
          patch.score = { home: msg.home, away: msg.away };
          break;
        case "event.commentary":
          patch.commentary = msg.text;
          break;
        case "event.penalty_shootout_start":
          patch.shootout = { home: 0, away: 0, active: true, ended: false };
          break;
        case "event.penalty_attempt": {
          const init = get().init;
          if (init && msg.outcome === "scored") {
            const so = { ...get().shootout };
            if (msg.team === init.teams[0].id) so.home += 1;
            else if (msg.team === init.teams[1].id) so.away += 1;
            patch.shootout = so;
          }
          break;
        }
        case "event.penalty_shootout_end":
          patch.shootout = {
            ...get().shootout,
            home: msg.score.home,
            away: msg.score.away,
            active: false,
            ended: true,
          };
          break;
        case "event.period_start":
          patch.period = msg.period;
          break;
        default:
          break;
      }

      set(patch);
    },

    setStatus(s) {
      set({ status: s });
    },

    reset() {
      set({ ...initialState });
    },
  }));
}
