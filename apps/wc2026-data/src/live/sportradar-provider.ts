/**
 * SportRadar Soccer (Trial v4) live-data adapter.
 *
 * Endpoint shape (production):
 *   https://api.sportradar.com/soccer/trial/v4/en/sport_events/{event_id}/timeline.json?api_key=...
 *   https://api.sportradar.com/soccer/trial/v4/en/schedules/{date}/schedule.json?api_key=...
 *
 * Pricing (per Tim's gap list, May 2026):
 *   - Trial: 1000 requests, 30 days. Sufficient to validate the wiring.
 *   - Paid: ~USD 200/month for soccer-only during-tournament tier with
 *     5-second polling cadence and full event metadata.
 *
 * Rate-limit shape:
 *   - Trial: 1 QPS.
 *   - Paid:  10 QPS.
 *   - Headers: `X-Plan-Quota-Allotted`, `X-Plan-Quota-Current`,
 *              `X-Plan-Quota-Remaining`, `X-Plan-Quota-Interval`.
 *
 * This file is a *stub adapter*: the network calls are real shape-wise
 * but the response-mapping is intentionally minimal so we can swap in
 * the full mapping once the trial key arrives. All methods throw
 * `MissingApiKeyError` if `WC2026_DATA_API_KEY` is not set — there is no
 * silent fallback to mock data here; the provider barrel handles backend
 * selection.
 */

import { request } from "undici";

import type {
  LiveDataProvider,
  LiveFixture,
  LiveMatchState,
  LiveMatchUpdate,
} from "./types.js";

export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(
      `${provider} provider requires WC2026_DATA_API_KEY. ` +
        `Set the env var or switch WC2026_DATA_BACKEND=mock.`,
    );
    this.name = "MissingApiKeyError";
  }
}

export interface SportRadarOptions {
  readonly apiKey: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Override fetcher for tests. Receives URL + headers, returns parsed JSON. */
  readonly fetcher?: (url: string, headers: Record<string, string>) => Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
  /** Polling interval for `subscribeMatch` in ms. Default 5000 (paid tier cadence). */
  readonly pollIntervalMs?: number;
}

interface SportRadarTimelineResponse {
  readonly sport_event?: {
    readonly id: string;
    readonly start_time: string;
    readonly competitors?: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly qualifier: "home" | "away";
      readonly abbreviation?: string;
    }>;
    readonly venue?: { readonly name?: string; readonly country_code?: string };
  };
  readonly sport_event_status?: {
    readonly status: string; // "not_started" | "live" | "ended" | "ht" | ...
    readonly match_status?: string;
    readonly home_score?: number;
    readonly away_score?: number;
    readonly clock?: { readonly played?: string };
  };
  readonly timeline?: ReadonlyArray<{
    readonly id: number;
    readonly type: string; // "score_change" | "yellow_card" | "period_start" | ...
    readonly time: string;
    readonly match_time?: number;
    readonly match_clock?: string;
    readonly competitor?: "home" | "away";
    readonly players?: ReadonlyArray<{ readonly name: string; readonly type?: string }>;
    readonly description?: string;
  }>;
}

const DEFAULT_BASE = "https://api.sportradar.com/soccer/trial/v4/en";

async function defaultFetcher(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const res = await request(url, {
    method: "GET",
    headers,
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
  });
  const body = (await res.body.json()) as unknown;
  const outHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (typeof v === "string") outHeaders[k.toLowerCase()] = v;
    else if (Array.isArray(v)) outHeaders[k.toLowerCase()] = v.join(",");
  }
  return { status: res.statusCode, body, headers: outHeaders };
}

export class SportRadarLiveDataProvider implements LiveDataProvider {
  readonly name = "sportradar";

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetcher: NonNullable<SportRadarOptions["fetcher"]>;
  private readonly pollIntervalMs: number;

  constructor(opts: SportRadarOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.pollIntervalMs = Math.max(1000, opts.pollIntervalMs ?? 5_000);
  }

  private requireKey(): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      throw new MissingApiKeyError(this.name);
    }
    return this.apiKey;
  }

  /**
   * Schedule fetch — list upcoming events. Real impl would take a date
   * range and merge per-day schedule files; this stub fetches "today" and
   * returns the next-N rows in start-time order.
   */
  async fetchUpcoming(limit: number): Promise<LiveFixture[]> {
    const key = this.requireKey();
    const today = new Date().toISOString().slice(0, 10);
    const url =
      `${this.baseUrl}/schedules/${today}/schedule.json?api_key=${encodeURIComponent(key)}`;
    const { status, body } = await this.fetcher(url, this.headers());
    if (status !== 200) {
      throw new Error(`sportradar schedule HTTP ${status}`);
    }
    const obj = body as { sport_events?: ReadonlyArray<unknown> };
    const events = Array.isArray(obj.sport_events) ? obj.sport_events : [];
    return events.slice(0, Math.max(0, limit)).map((e) => this.mapScheduleRow(e));
  }

  async fetchMatch(matchId: string): Promise<LiveMatchState> {
    const key = this.requireKey();
    const url =
      `${this.baseUrl}/sport_events/${encodeURIComponent(matchId)}/timeline.json` +
      `?api_key=${encodeURIComponent(key)}`;
    const { status, body } = await this.fetcher(url, this.headers());
    if (status !== 200) {
      throw new Error(`sportradar timeline HTTP ${status}`);
    }
    return this.mapTimeline(matchId, body as SportRadarTimelineResponse);
  }

  subscribeMatch(matchId: string, onUpdate: LiveMatchUpdate): () => void {
    let cancelled = false;
    let lastVersion = -1;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const state = await this.fetchMatch(matchId);
        if (state.version !== lastVersion) {
          lastVersion = state.version;
          onUpdate(state);
        }
      } catch {
        // Swallow per-tick errors so a transient failure doesn't break
        // the subscription. Real impl logs via pino.
      }
    };

    // Fire and forget the first tick, then schedule.
    void tick();
    const handle = setInterval(() => {
      void tick();
    }, this.pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }

  // ---------- mapping helpers (shape-correct stubs) ----------

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "User-Agent": "vtorn-wc2026-data/0.1 (+https://play.tournamental.com)",
    };
  }

  private mapScheduleRow(raw: unknown): LiveFixture {
    const e = raw as {
      sport_event?: {
        id?: string;
        start_time?: string;
        competitors?: Array<{
          qualifier?: "home" | "away";
          abbreviation?: string;
          name?: string;
        }>;
        venue?: { name?: string; country_code?: string };
      };
    };
    const ev = e.sport_event ?? {};
    const home = ev.competitors?.find((c) => c.qualifier === "home");
    const away = ev.competitors?.find((c) => c.qualifier === "away");
    const country = (ev.venue?.country_code ?? "USA").toUpperCase();
    const host = country === "CAN" ? "CA" : country === "MEX" ? "MX" : "US";
    return {
      matchId: ev.id ?? "unknown",
      homeTeamId: (home?.abbreviation ?? home?.name ?? "HOM").slice(0, 3).toUpperCase(),
      awayTeamId: (away?.abbreviation ?? away?.name ?? "AWY").slice(0, 3).toUpperCase(),
      kickoffUtc: ev.start_time ?? new Date().toISOString(),
      host,
      venue: ev.venue?.name ?? "Unknown",
      status: "scheduled",
    };
  }

  private mapTimeline(matchId: string, body: SportRadarTimelineResponse): LiveMatchState {
    const status = mapStatus(body.sport_event_status?.status);
    const events = body.timeline ?? [];
    return {
      matchId,
      status,
      currentMinute: extractMinute(body),
      homeScore: body.sport_event_status?.home_score ?? 0,
      awayScore: body.sport_event_status?.away_score ?? 0,
      scorers: events
        .filter((e) => e.type === "score_change")
        .map((e) => {
          const teamCompetitor = body.sport_event?.competitors?.find(
            (c) => c.qualifier === e.competitor,
          );
          const teamId = (teamCompetitor?.abbreviation ?? "UNK").toUpperCase();
          return {
            teamId,
            playerName: e.players?.[0]?.name ?? "Unknown",
            minute: e.match_time ?? 0,
            type: "goal" as const,
          };
        }),
      latestEvents: events.slice(-20).map((e) => ({
        minute: e.match_time ?? 0,
        type: e.type,
        description: e.description ?? `${e.type} (${e.match_time ?? "?"}')`,
      })),
      // Use the count of timeline rows as a monotonic version proxy.
      version: events.length,
      updatedAtUtc: new Date().toISOString(),
    };
  }
}

function mapStatus(s: string | undefined): LiveMatchState["status"] {
  switch (s) {
    case "live":
    case "1st_half":
    case "2nd_half":
    case "extra_time":
      return "live";
    case "halftime":
    case "ht":
      return "ht";
    case "ended":
    case "closed":
      return "final";
    case "postponed":
      return "postponed";
    case "abandoned":
    case "cancelled":
      return "abandoned";
    case "not_started":
    default:
      return "scheduled";
  }
}

function extractMinute(body: SportRadarTimelineResponse): number {
  const played = body.sport_event_status?.clock?.played;
  if (!played) return 0;
  const m = /^(\d+):(\d+)$/.exec(played);
  if (!m) return 0;
  const mins = Number(m[1]);
  return Number.isFinite(mins) ? mins : 0;
}
