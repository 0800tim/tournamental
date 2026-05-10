/**
 * Deterministic in-memory live-data provider.
 *
 * Seeded from `data/fifa-wc-2026/fixtures.json` (loaded once at construct
 * time). The provider models a small state machine for every match:
 *
 *   scheduled → live → ht → live → final → scheduled (cycle)
 *
 * Time advances on `tick()` calls — by default `subscribeMatch` schedules
 * its own ticks via `setInterval`, but `tick()` can be driven manually
 * from tests for full determinism.
 *
 * Goals are simulated at plausible minutes seeded by `(match_number * minute)`
 * so test runs are reproducible.
 *
 * The provider cycles cleanly: when a match transitions to `final` and is
 * re-subscribed, it will cycle back to `scheduled` on the next external
 * "reset" call (or after a configurable cool-off). This keeps repeat dev
 * sessions honest without restarting the process.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  LiveDataProvider,
  LiveEvent,
  LiveFixture,
  LiveMatchState,
  LiveMatchStatus,
  LiveMatchUpdate,
  LiveScorer,
} from "./types.js";

interface RawFixture {
  readonly match_number: number;
  readonly home_team_slot: string;
  readonly away_team_slot: string;
  readonly host_city_id: string;
  readonly kickoff_utc: string;
  readonly stage: string;
}

interface RawFixturesDoc {
  readonly fixtures: readonly RawFixture[];
}

const HOST_BY_CITY: Record<string, "US" | "CA" | "MX"> = {
  // United States
  atlanta: "US",
  boston: "US",
  dallas: "US",
  houston: "US",
  kansas_city: "US",
  los_angeles: "US",
  miami: "US",
  new_york: "US",
  philadelphia: "US",
  san_francisco: "US",
  seattle: "US",
  // Mexico
  guadalajara: "MX",
  mexico_city: "MX",
  monterrey: "MX",
  // Canada
  toronto: "CA",
  vancouver: "CA",
};

/** Pick the host country for a fixture by city slug. Defaults to "US". */
export function hostFromCity(cityId: string): "US" | "CA" | "MX" {
  return HOST_BY_CITY[cityId] ?? "US";
}

/** Mulberry32-ish 32-bit hash. Same shape as `mock.ts` in odds-ingest. */
export function seededRand(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface MockProviderOptions {
  /** Path to the fixtures JSON. Defaults to data/fifa-wc-2026/fixtures.json. */
  readonly fixturesPath?: string;
  /** Inject fixtures directly (bypasses fs). */
  readonly fixtures?: readonly RawFixture[];
  /** Wall clock; tests pass a frozen value. */
  readonly nowMs?: () => number;
  /**
   * Tick interval for `subscribeMatch` in ms. Default 250ms — fast enough
   * for snappy local dev, slow enough that the SSE stream isn't a fire-hose.
   */
  readonly tickIntervalMs?: number;
  /**
   * Each tick advances the match clock by this many minutes. Default 1.
   * Tests usually pass 5+ to skip ahead quickly.
   */
  readonly minutesPerTick?: number;
}

interface InternalState {
  readonly matchId: string;
  status: LiveMatchStatus;
  currentMinute: number;
  homeScore: number;
  awayScore: number;
  scorers: LiveScorer[];
  latestEvents: LiveEvent[];
  version: number;
  /** Re-rolling pseudo-random seed; advances every tick. */
  rng: number;
}

/**
 * Snapshot internal state into the public, immutable shape. Always returns
 * a fresh object so subscribers can hold references safely.
 */
function snapshot(s: InternalState, nowIso: string): LiveMatchState {
  return {
    matchId: s.matchId,
    status: s.status,
    currentMinute: s.currentMinute,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    scorers: s.scorers.slice(),
    latestEvents: s.latestEvents.slice(),
    version: s.version,
    updatedAtUtc: nowIso,
  };
}

/**
 * Goal-probability per minute. Real World Cup matches average ~2.7 goals
 * over 90 minutes ≈ 0.030 per minute. We keep that average and bias mid
 * and late minutes a touch to feel more "match-like" in dev streams.
 */
function goalProb(minute: number): number {
  if (minute < 5) return 0.005; // very early: rare
  if (minute < 30) return 0.025;
  if (minute < 45) return 0.035; // late first half
  if (minute < 50) return 0.005; // half-time and right after
  if (minute < 75) return 0.030;
  if (minute < 95) return 0.045; // late drama
  return 0.025; // extra time
}

const HALF_TIME_MIN = 45;
const FULL_TIME_MIN = 90;

export class MockLiveDataProvider implements LiveDataProvider {
  readonly name = "mock";

  private readonly fixtures: ReadonlyArray<RawFixture>;
  private readonly nowMs: () => number;
  private readonly tickIntervalMs: number;
  private readonly minutesPerTick: number;
  private readonly states = new Map<string, InternalState>();
  /** Cached upcoming order so fetchUpcoming is stable across calls. */
  private readonly orderedFixtures: ReadonlyArray<RawFixture>;

  constructor(opts: MockProviderOptions = {}) {
    if (opts.fixtures) {
      this.fixtures = opts.fixtures;
    } else {
      const path = opts.fixturesPath ?? defaultFixturesPath();
      const raw = readFileSync(path, "utf-8");
      const doc = JSON.parse(raw) as RawFixturesDoc;
      this.fixtures = doc.fixtures;
    }
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.tickIntervalMs = Math.max(10, opts.tickIntervalMs ?? 250);
    this.minutesPerTick = Math.max(1, Math.floor(opts.minutesPerTick ?? 1));

    // Sort once: by kickoff ascending, then match_number for stable ordering.
    this.orderedFixtures = [...this.fixtures].sort((a, b) => {
      const ka = Date.parse(a.kickoff_utc);
      const kb = Date.parse(b.kickoff_utc);
      if (ka !== kb) return ka - kb;
      return a.match_number - b.match_number;
    });
  }

  /** Returns the next-N upcoming fixtures relative to `nowMs()`. */
  async fetchUpcoming(limit: number): Promise<LiveFixture[]> {
    if (!Number.isFinite(limit) || limit <= 0) return [];
    const cap = Math.min(Math.floor(limit), this.orderedFixtures.length);
    const now = this.nowMs();

    // Anything kicking off after now-3h (3h covers in-progress matches).
    const cutoff = now - 3 * 60 * 60 * 1000;
    const out: LiveFixture[] = [];
    for (const f of this.orderedFixtures) {
      const ko = Date.parse(f.kickoff_utc);
      if (ko < cutoff) continue;
      const matchId = String(f.match_number);
      const state = this.states.get(matchId);
      out.push({
        matchId,
        homeTeamId: f.home_team_slot,
        awayTeamId: f.away_team_slot,
        kickoffUtc: f.kickoff_utc,
        host: hostFromCity(f.host_city_id),
        venue: f.host_city_id,
        status: state?.status ?? "scheduled",
        ...(state?.status === "live" || state?.status === "ht"
          ? { currentMinute: state.currentMinute }
          : {}),
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  /** Idempotent: the first call materialises the state from fixtures. */
  async fetchMatch(matchId: string): Promise<LiveMatchState> {
    const state = this.ensureState(matchId);
    return snapshot(state, new Date(this.nowMs()).toISOString());
  }

  /**
   * Subscribe to a long-poll stream. Returns an unsubscribe function.
   *
   * Behaviour:
   *  - Fires an immediate first tick with the current snapshot (so
   *    subscribers don't need to call `fetchMatch` first).
   *  - Then schedules a `setInterval` that calls `tick(matchId)` and
   *    delivers the new snapshot if the version advanced.
   */
  subscribeMatch(matchId: string, onUpdate: LiveMatchUpdate): () => void {
    const state = this.ensureState(matchId);
    let lastVersion = -1;
    let cancelled = false;

    const deliver = (): void => {
      if (cancelled) return;
      if (state.version === lastVersion) return;
      lastVersion = state.version;
      onUpdate(snapshot(state, new Date(this.nowMs()).toISOString()));
    };

    // Fire immediately with the current state.
    deliver();

    const handle = setInterval(() => {
      if (cancelled) return;
      this.tick(matchId);
      deliver();
    }, this.tickIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }

  /**
   * Advance the match by `minutesPerTick`. Returns the new snapshot.
   * Pure with respect to clock except for the ISO timestamp; tests can
   * call this directly to drive the state machine deterministically.
   */
  tick(matchId: string): LiveMatchState {
    const state = this.ensureState(matchId);

    if (state.status === "final" || state.status === "postponed" || state.status === "abandoned") {
      // Terminal — no advancement; bump version to a stable terminal value
      // exactly once per call so subscribers don't see a duplicate.
      return snapshot(state, new Date(this.nowMs()).toISOString());
    }

    if (state.status === "scheduled") {
      // Kick off.
      state.status = "live";
      state.currentMinute = 0;
      state.latestEvents.push({ minute: 0, type: "kickoff", description: "Kick-off" });
      state.version += 1;
      this.trimEvents(state);
      return snapshot(state, new Date(this.nowMs()).toISOString());
    }

    if (state.status === "ht") {
      // Resume second half.
      state.status = "live";
      state.latestEvents.push({
        minute: HALF_TIME_MIN,
        type: "second_half_start",
        description: "Second half kicks off",
      });
      state.version += 1;
      this.trimEvents(state);
      return snapshot(state, new Date(this.nowMs()).toISOString());
    }

    // Live → advance the clock.
    const before = state.currentMinute;
    state.currentMinute = Math.min(FULL_TIME_MIN + 5, before + this.minutesPerTick);

    // Per-minute goal rolls (one per minute the clock advanced through).
    for (let m = before + 1; m <= state.currentMinute; m++) {
      const r = seededRand(state.rng ^ (m * 16777619));
      state.rng = (state.rng + 0x9e3779b9) >>> 0;
      if (r < goalProb(m)) {
        // 53% home advantage.
        const home = seededRand(state.rng) < 0.53;
        state.rng = (state.rng + 0xdeadbeef) >>> 0;
        const teamId = home
          ? this.fixtureFor(matchId).home_team_slot
          : this.fixtureFor(matchId).away_team_slot;
        const playerName = mockScorerName(teamId, m);
        const isPen = seededRand(state.rng) < 0.18;
        state.rng = (state.rng + 0xc6ef3720) >>> 0;
        const type: LiveScorer["type"] = isPen ? "pen" : "goal";
        const scorer: LiveScorer = { teamId, playerName, minute: m, type };
        state.scorers.push(scorer);
        if (home) state.homeScore += 1;
        else state.awayScore += 1;
        state.latestEvents.push({
          minute: m,
          type: isPen ? "pen_scored" : "goal",
          description: `${type === "pen" ? "Penalty" : "Goal"} for ${teamId} — ${playerName} (${m}')`,
        });
      }
    }

    // Half-time / Full-time transitions.
    if (state.currentMinute >= HALF_TIME_MIN && before < HALF_TIME_MIN) {
      state.status = "ht";
      state.currentMinute = HALF_TIME_MIN;
      state.latestEvents.push({
        minute: HALF_TIME_MIN,
        type: "half_time",
        description: "Half-time",
      });
    } else if (state.currentMinute >= FULL_TIME_MIN) {
      state.status = "final";
      state.currentMinute = FULL_TIME_MIN;
      state.latestEvents.push({
        minute: FULL_TIME_MIN,
        type: "full_time",
        description: `Full-time — ${state.homeScore}-${state.awayScore}`,
      });
    }
    state.version += 1;
    this.trimEvents(state);
    return snapshot(state, new Date(this.nowMs()).toISOString());
  }

  /**
   * Reset a match's state to scheduled. Useful in dev to cycle the state
   * machine without restarting the process.
   */
  reset(matchId: string): void {
    this.states.delete(matchId);
  }

  /** Reset every match. */
  resetAll(): void {
    this.states.clear();
  }

  // ---------- internals ----------

  private fixtureFor(matchId: string): RawFixture {
    const f = this.fixtures.find((x) => String(x.match_number) === matchId);
    if (!f) throw new Error(`unknown matchId: ${matchId}`);
    return f;
  }

  private ensureState(matchId: string): InternalState {
    const existing = this.states.get(matchId);
    if (existing) return existing;
    // Validate match exists.
    this.fixtureFor(matchId);
    const fresh: InternalState = {
      matchId,
      status: "scheduled",
      currentMinute: 0,
      homeScore: 0,
      awayScore: 0,
      scorers: [],
      latestEvents: [],
      version: 0,
      rng: ((Number(matchId) | 0) * 0x85ebca6b) >>> 0,
    };
    this.states.set(matchId, fresh);
    return fresh;
  }

  /** Cap the running events buffer at 50 entries to keep snapshots small. */
  private trimEvents(state: InternalState): void {
    const MAX = 50;
    if (state.latestEvents.length > MAX) {
      state.latestEvents.splice(0, state.latestEvents.length - MAX);
    }
  }
}

/**
 * Resolve the default fixtures-json path relative to this module. Works in
 * both source (src/live/...) and built (dist/live/...) layouts.
 */
function defaultFixturesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Prefer the workspace data directory; fall back to a sibling for tests.
  return resolve(here, "..", "..", "..", "..", "data", "fifa-wc-2026", "fixtures.json");
}

const SCORER_POOL = [
  "Mbappé",
  "Messi",
  "Haaland",
  "Bellingham",
  "Vinícius",
  "Saka",
  "Foden",
  "Pulisic",
  "Davies",
  "Lozano",
  "Son",
  "Modrić",
  "Kane",
  "Lewandowski",
  "De Bruyne",
  "Yamal",
];

function mockScorerName(teamId: string, minute: number): string {
  const idx = Math.abs((teamId.charCodeAt(0) + teamId.charCodeAt(1) + minute) % SCORER_POOL.length);
  return SCORER_POOL[idx] ?? "Unknown";
}
