/**
 * Long-running poll loops. Each loop runs in its own try/catch with
 * exponential backoff. The constructor caller decides whether to start
 * each loop (so tests can wire just one).
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";

import { mockMarketForFixture, mockTournamentWinners } from "./sources/mock.js";
import {
  gammaEventToInternal,
  gammaMarketToInternal,
  PolymarketGammaClient,
} from "./sources/polymarket.js";
import { OddsApiClient, oddsApiEventToInternal } from "./sources/the-odds-api.js";
import type { Config } from "./config.js";
import type { DataPack } from "./data.js";
import type { OddsStore } from "./store/sqlite.js";
import type { OddsSource, SourceHealth, SourceStatus } from "./types.js";

export interface PollerStatus {
  source: SourceHealth;
  last_run: Record<string, number | null>;
  last_error: Record<string, string | null>;
}

export class IngestPoller {
  private gamma: PolymarketGammaClient | null;
  private oddsApi: OddsApiClient | null;
  private stopRequested = false;
  private status: PollerStatus = {
    source: { polymarket: "down", theoddsapi: "down", mock: "live" },
    last_run: { polymarket_gamma: null, polymarket_clob: null, theoddsapi: null, mock: null },
    last_error: { polymarket_gamma: null, polymarket_clob: null, theoddsapi: null, mock: null },
  };

  constructor(
    private readonly config: Config,
    private readonly store: OddsStore,
    private readonly data: DataPack,
    private readonly log: Logger,
  ) {
    this.gamma = config.polymarket.enabled
      ? new PolymarketGammaClient({ baseUrl: config.polymarket.gammaUrl })
      : null;
    this.oddsApi =
      config.theOddsApi.enabled && config.theOddsApi.apiKey
        ? new OddsApiClient({ baseUrl: config.theOddsApi.baseUrl, apiKey: config.theOddsApi.apiKey })
        : null;
  }

  getStatus(): PollerStatus {
    return JSON.parse(JSON.stringify(this.status)) as PollerStatus;
  }

  /** Synchronous one-shot mock seed. Always safe to call; idempotent. */
  seedMockData(now: number = Date.now()): { markets: number; ticks: number } {
    if (!this.config.mock.enabled) return { markets: 0, ticks: 0 };
    let mCount = 0;
    let tCount = 0;
    for (const fixture of this.data.fixtures) {
      // Group + knockout are both fine; knockout slots may be placeholders
      // ("W49" etc.) which won't resolve via byCode and we skip them.
      const out = mockMarketForFixture(fixture, this.data, now);
      if (!out) continue;
      // Don't overwrite a real market that's already been ingested.
      const existing = this.store.getMarket(out.market.id);
      if (!existing || existing.source === "mock") {
        this.store.upsertMarket(out.market);
        mCount += 1;
      }
      if (!existing || existing.source === "mock") {
        for (const t of out.ticks) this.store.insertTick(t);
        tCount += out.ticks.length;
      }
    }
    const winners = mockTournamentWinners(this.data, now);
    for (const m of winners.markets) {
      const existing = this.store.getMarket(m.id);
      if (!existing || existing.source === "mock") {
        this.store.upsertMarket(m);
        mCount += 1;
      }
    }
    for (const t of winners.ticks) {
      const existing = this.store.getMarket(t.market_id);
      if (!existing || existing.source === "mock") {
        this.store.insertTick(t);
        tCount += 1;
      }
    }
    this.status.last_run.mock = now;
    this.status.source.mock = "live";
    return { markets: mCount, ticks: tCount };
  }

  /** One Gamma poll cycle. Returns count of markets upserted. */
  async pollGammaOnce(now: number = Date.now()): Promise<number> {
    if (!this.gamma) return 0;
    try {
      let count = 0;
      // Events first: this is the only query shape that exposes group-winner
      // and per-match moneyline markets (each as nested child binaries).
      // Isolated try/catch so an events-API hiccup never blocks the flat
      // tournament-winner backstop below.
      if (typeof this.gamma.fetchEventsByTagSlugs === "function") {
        try {
          const events = await this.gamma.fetchEventsByTagSlugs(this.config.polymarket.tagSlugs);
          for (const e of events) {
            for (const internal of gammaEventToInternal(e, this.data, now)) {
              this.store.upsertMarket(internal.market);
              for (const t of internal.ticks) this.store.insertTick(t);
              count += 1;
            }
          }
        } catch (e) {
          this.log.warn({ err: e }, "polymarket gamma events poll failed");
        }
      }
      // Flat markets second: backstop for tournament-winner binaries that
      // carry the tag directly. Won't clobber an event-sourced market for the
      // same id because the kinds + ids line up (both write wc2026:winner:<CODE>).
      const raw = await this.gamma.fetchMarketsByTagSlugs(this.config.polymarket.tagSlugs);
      for (const m of raw) {
        const internal = gammaMarketToInternal(m, this.data, now);
        if (!internal) continue;
        this.store.upsertMarket(internal.market);
        for (const t of internal.ticks) this.store.insertTick(t);
        count += 1;
      }
      this.status.last_run.polymarket_gamma = now;
      this.status.last_error.polymarket_gamma = null;
      this.status.source.polymarket =
        count > 0 ? "live" : (this.status.source.polymarket === "live" ? "live" : "degraded");
      return count;
    } catch (e) {
      this.status.last_error.polymarket_gamma = (e as Error).message;
      this.status.source.polymarket = "degraded";
      this.log.warn({ err: e }, "polymarket gamma poll failed");
      return 0;
    }
  }

  /** One The Odds API poll cycle. Returns count of events upserted. */
  async pollOddsApiOnce(now: number = Date.now()): Promise<number> {
    if (!this.oddsApi) {
      this.status.source.theoddsapi = "down";
      return 0;
    }
    try {
      const events = await this.oddsApi.fetchH2H();
      let count = 0;
      for (const ev of events) {
        const internal = oddsApiEventToInternal(ev, this.data, now);
        if (!internal) continue;
        // Only overwrite mock markets; don't clobber a Polymarket market for
        // the same match_id (Polymarket is the primary source).
        const existing = this.store.getMarket(internal.market.id);
        if (existing && existing.source === "polymarket") continue;
        this.store.upsertMarket(internal.market);
        for (const t of internal.ticks) this.store.insertTick(t);
        count += 1;
      }
      this.status.last_run.theoddsapi = now;
      this.status.last_error.theoddsapi = null;
      this.status.source.theoddsapi = events.length > 0 ? "live" : "degraded";
      return count;
    } catch (e) {
      this.status.last_error.theoddsapi = (e as Error).message;
      this.status.source.theoddsapi = "down";
      this.log.warn({ err: e }, "the-odds-api poll failed");
      return 0;
    }
  }

  /** Start all loops concurrently. Returns when stop() is called. */
  async run(): Promise<void> {
    this.seedMockData();
    const tasks: Promise<void>[] = [];
    if (this.gamma) tasks.push(this.runGammaLoop());
    if (this.oddsApi) tasks.push(this.runOddsApiLoop());
    if (tasks.length === 0) {
      this.log.warn("no live sources enabled; service will only serve mock data");
      while (!this.stopRequested) await sleep(1000);
      return;
    }
    await Promise.all(tasks);
  }

  stop(): void {
    this.stopRequested = true;
  }

  private async runGammaLoop(): Promise<void> {
    let backoffMs = this.config.polymarket.pollGammaMs;
    while (!this.stopRequested) {
      const upserts = await this.pollGammaOnce();
      this.log.info({ upserts }, "gamma poll");
      const ok = upserts > 0 || this.status.last_error.polymarket_gamma == null;
      backoffMs = ok
        ? this.config.polymarket.pollGammaMs
        : Math.min(backoffMs * 2, 30 * 60_000);
      await sleep(backoffMs);
    }
  }

  private async runOddsApiLoop(): Promise<void> {
    let backoffMs = this.config.theOddsApi.pollMs;
    while (!this.stopRequested) {
      const upserts = await this.pollOddsApiOnce();
      this.log.info({ upserts }, "the-odds-api poll");
      const ok = upserts > 0 || this.status.last_error.theoddsapi == null;
      backoffMs = ok ? this.config.theOddsApi.pollMs : Math.min(backoffMs * 2, 6 * 60 * 60_000);
      await sleep(backoffMs);
    }
  }
}

export function defaultSourceStatus(): SourceStatus {
  return "down";
}

export function pollerOnly(_s: OddsSource): SourceStatus {
  return "down";
}
