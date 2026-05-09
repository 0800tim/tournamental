/**
 * SQLite-backed market + tick store. better-sqlite3 is synchronous which
 * matches the read-heavy, low-write-rate access pattern of this service
 * (one writer process; many concurrent HTTP readers).
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import type { Database as DatabaseT, Statement } from "better-sqlite3";

import { SCHEMA_SQL } from "./schema.js";
import type { OddsMarket, OddsTick } from "../types.js";

export interface StoreOptions {
  /** Filesystem path to the SQLite file. ":memory:" for tests. */
  dbPath: string;
}

export class OddsStore {
  readonly db: DatabaseT;

  private upsertMarketStmt!: Statement;
  private getMarketStmt!: Statement;
  private listMarketsByKindStmt!: Statement;
  private listMarketsByMatchStmt!: Statement;
  private listMarketsAllStmt!: Statement;
  private insertTickStmt!: Statement;
  private latestTicksForMarketStmt!: Statement;
  private latestTicksForMarketsStmt!: Statement;

  constructor(opts: StoreOptions) {
    if (opts.dbPath !== ":memory:") {
      mkdirSync(dirname(resolve(opts.dbPath)), { recursive: true });
    }
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.applySchema();
    this.prepareStatements();
  }

  private applySchema(): void {
    this.db.exec(SCHEMA_SQL);
  }

  private prepareStatements(): void {
    this.upsertMarketStmt = this.db.prepare(`
      INSERT INTO odds_market (id, source, source_id, match_id, kind, question, outcomes_json, starts_at, ends_at, resolved, resolved_outcome, updated_at)
      VALUES (@id, @source, @source_id, @match_id, @kind, @question, @outcomes_json, @starts_at, @ends_at, @resolved, @resolved_outcome, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        source_id = excluded.source_id,
        match_id = excluded.match_id,
        kind = excluded.kind,
        question = excluded.question,
        outcomes_json = excluded.outcomes_json,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        resolved = excluded.resolved,
        resolved_outcome = excluded.resolved_outcome,
        updated_at = excluded.updated_at
    `);
    this.getMarketStmt = this.db.prepare(`SELECT * FROM odds_market WHERE id = ?`);
    this.listMarketsByKindStmt = this.db.prepare(
      `SELECT * FROM odds_market WHERE kind = ? ORDER BY id`,
    );
    this.listMarketsByMatchStmt = this.db.prepare(
      `SELECT * FROM odds_market WHERE match_id = ? ORDER BY id`,
    );
    this.listMarketsAllStmt = this.db.prepare(`SELECT * FROM odds_market ORDER BY id`);

    this.insertTickStmt = this.db.prepare(`
      INSERT INTO odds_tick (market_id, outcome_label, best_bid, best_ask, last, implied_prob, volume_24h, ts)
      VALUES (@market_id, @outcome_label, @best_bid, @best_ask, @last, @implied_prob, @volume_24h, @ts)
      ON CONFLICT(market_id, outcome_label, ts) DO UPDATE SET
        best_bid = excluded.best_bid,
        best_ask = excluded.best_ask,
        last = excluded.last,
        implied_prob = excluded.implied_prob,
        volume_24h = excluded.volume_24h
    `);
    this.latestTicksForMarketStmt = this.db.prepare(`
      SELECT t.*
      FROM odds_tick t
      JOIN (
        SELECT outcome_label, MAX(ts) AS max_ts
        FROM odds_tick
        WHERE market_id = ?
        GROUP BY outcome_label
      ) m ON t.outcome_label = m.outcome_label AND t.ts = m.max_ts
      WHERE t.market_id = ?
    `);
    this.latestTicksForMarketsStmt = this.db.prepare(`
      SELECT t.*
      FROM odds_tick t
      JOIN (
        SELECT market_id, outcome_label, MAX(ts) AS max_ts
        FROM odds_tick
        GROUP BY market_id, outcome_label
      ) m
      ON t.market_id = m.market_id AND t.outcome_label = m.outcome_label AND t.ts = m.max_ts
    `);
  }

  upsertMarket(m: OddsMarket): void {
    this.upsertMarketStmt.run({
      id: m.id,
      source: m.source,
      source_id: m.source_id,
      match_id: m.match_id,
      kind: m.kind,
      question: m.question,
      outcomes_json: JSON.stringify(m.outcomes),
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      resolved: m.resolved ? 1 : 0,
      resolved_outcome: m.resolved_outcome,
      updated_at: m.updated_at,
    });
  }

  getMarket(id: string): OddsMarket | null {
    const row = this.getMarketStmt.get(id) as MarketRow | undefined;
    return row ? rowToMarket(row) : null;
  }

  listMarkets(filter: { kind?: string; match_id?: string } = {}): OddsMarket[] {
    let rows: MarketRow[];
    if (filter.kind) {
      rows = this.listMarketsByKindStmt.all(filter.kind) as MarketRow[];
    } else if (filter.match_id) {
      rows = this.listMarketsByMatchStmt.all(filter.match_id) as MarketRow[];
    } else {
      rows = this.listMarketsAllStmt.all() as MarketRow[];
    }
    return rows.map(rowToMarket);
  }

  insertTick(t: OddsTick): void {
    this.insertTickStmt.run({
      market_id: t.market_id,
      outcome_label: t.outcome_label,
      best_bid: t.best_bid,
      best_ask: t.best_ask,
      last: t.last,
      implied_prob: t.implied_prob,
      volume_24h: t.volume_24h,
      ts: t.ts,
    });
  }

  latestTicks(marketId: string): OddsTick[] {
    const rows = this.latestTicksForMarketStmt.all(marketId, marketId) as TickRow[];
    return rows.map(rowToTick);
  }

  /** All latest ticks across every market. Used by the `/snapshot` endpoint. */
  latestTicksAll(): OddsTick[] {
    const rows = this.latestTicksForMarketsStmt.all() as TickRow[];
    return rows.map(rowToTick);
  }

  close(): void {
    this.db.close();
  }
}

interface MarketRow {
  id: string;
  source: string;
  source_id: string | null;
  match_id: string | null;
  kind: string;
  question: string;
  outcomes_json: string;
  starts_at: number | null;
  ends_at: number | null;
  resolved: number;
  resolved_outcome: string | null;
  updated_at: number;
}

interface TickRow {
  market_id: string;
  outcome_label: string;
  best_bid: number | null;
  best_ask: number | null;
  last: number | null;
  implied_prob: number;
  volume_24h: number | null;
  ts: number;
}

function rowToMarket(row: MarketRow): OddsMarket {
  return {
    id: row.id,
    source: row.source as OddsMarket["source"],
    source_id: row.source_id,
    match_id: row.match_id,
    kind: row.kind as OddsMarket["kind"],
    question: row.question,
    outcomes: JSON.parse(row.outcomes_json) as OddsMarket["outcomes"],
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    resolved: row.resolved !== 0,
    resolved_outcome: row.resolved_outcome,
    updated_at: row.updated_at,
  };
}

function rowToTick(row: TickRow): OddsTick {
  return {
    market_id: row.market_id,
    outcome_label: row.outcome_label,
    best_bid: row.best_bid,
    best_ask: row.best_ask,
    last: row.last,
    implied_prob: row.implied_prob,
    volume_24h: row.volume_24h,
    ts: row.ts,
  };
}
