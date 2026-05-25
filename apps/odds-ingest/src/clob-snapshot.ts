/**
 * Polymarket CLOB orderbook snapshot loop. For every active Polymarket
 * market in the store, hit /book?token_id=... for each Yes-token and write
 * a fresh tick with the mid-price (= implied probability).
 *
 * Runs every ~30s. Conservative: skips markets that don't have CLOB token
 * ids attached (the Gamma metadata sometimes lags).
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";

import { PolymarketClobClient, type ClobBookSnapshot } from "./sources/polymarket.js";
import type { Config } from "./config.js";
import type { OddsStore } from "./store/sqlite.js";
import type { OddsTick } from "./types.js";

export class ClobSnapshotter {
  private readonly client: PolymarketClobClient;
  private stopRequested = false;
  public lastRun: number | null = null;
  public lastError: string | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: OddsStore,
    private readonly log: Logger,
  ) {
    this.client = new PolymarketClobClient({ baseUrl: config.polymarket.clobUrl });
  }

  /** One snapshot pass over every Polymarket market with token ids. */
  async runOnce(now: number = Date.now()): Promise<number> {
    let count = 0;
    const markets = this.store.listMarkets().filter((m) => m.source === "polymarket");
    for (const market of markets) {
      for (const out of market.outcomes) {
        if (!out.source_token_id) continue;
        const snap = await this.client.fetchBook(out.source_token_id);
        if (!snap) continue;
        const tick = bookToTick(market.id, out.label, snap, now);
        if (tick) {
          this.store.insertTick(tick);
          count += 1;
        }
      }
    }
    this.lastRun = now;
    return count;
  }

  async run(): Promise<void> {
    let backoffMs = this.config.polymarket.pollClobMs;
    while (!this.stopRequested) {
      try {
        const n = await this.runOnce();
        this.log.debug({ ticks: n }, "clob snapshot");
        this.lastError = null;
        backoffMs = this.config.polymarket.pollClobMs;
      } catch (e) {
        this.lastError = (e as Error).message;
        this.log.warn({ err: e }, "clob snapshot failed");
        backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
      }
      await sleep(backoffMs);
    }
  }

  stop(): void {
    this.stopRequested = true;
  }
}

/**
 * Maximum bid-ask spread (in probability points) for a CLOB mid-price to be
 * trusted. Far-out World Cup markets often have a near-empty book (e.g. best
 * bid 0.01 / best ask 0.99), whose 0.50 mid is meaningless and would clobber
 * the accurate de-vigged price from Gamma's `outcomePrices`. When the spread
 * is wider than this we skip the tick and let the Gamma value stand.
 */
export const MAX_TRUSTED_CLOB_SPREAD = 0.1;

export function bookToTick(
  marketId: string,
  outcomeLabel: string,
  snap: ClobBookSnapshot,
  ts: number,
): OddsTick | null {
  if (snap.best_bid == null && snap.best_ask == null) return null;
  let mid: number;
  if (snap.best_bid != null && snap.best_ask != null) {
    // Reject illiquid books whose mid is uninformative.
    if (Math.abs(snap.best_ask - snap.best_bid) > MAX_TRUSTED_CLOB_SPREAD) return null;
    mid = (snap.best_bid + snap.best_ask) / 2;
  } else {
    mid = (snap.best_bid ?? snap.best_ask)!;
  }
  return {
    market_id: marketId,
    outcome_label: outcomeLabel,
    best_bid: snap.best_bid,
    best_ask: snap.best_ask,
    last: snap.last_trade_price,
    implied_prob: Math.min(1, Math.max(0, mid)),
    volume_24h: null,
    ts,
  };
}
