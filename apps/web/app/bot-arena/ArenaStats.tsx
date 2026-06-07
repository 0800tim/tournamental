"use client";

/**
 * Stats chip strip for /bot-arena.
 *
 * Three numbers, rendered as gold-bordered pill chips above the body:
 *
 *   1. Bots in my swarm
 *      Sum of bots generated across every run this device has stored
 *      in IndexedDB. Counted via the same persistence layer the /run
 *      page uses (`loadSwarmState()`); zero when the user hasn't
 *      spawned anything yet.
 *
 *   2. Still perfect
 *      Bots that have hit every settled match correctly so far. Read
 *      from device-local data because the regenerate-on-demand
 *      contract (docs/30-browser-swarm-architecture.md) keeps per-bot
 *      picks out of server storage. Counted by replaying each stored
 *      bot's predictions against the device's `settled_matches`
 *      cache. Pre-kickoff this equals the swarm total.
 *
 *   3. Bots in the arena
 *      Server-aggregate across every device, fetched from
 *      `/v1/swarm/totals` which caches a SQLite SUM for 60s. Updates
 *      live across browser windows and accounts within that window;
 *      the chip polls every 45s so a viewer sees the count tick up as
 *      other devices commit.
 *
 * Render rule: if the device has no local bots AND the server total
 * is zero, the strip stays hidden (no point teasing empty numbers).
 * Tim 2026-06-08.
 */

import { useEffect, useState } from "react";

import { defaultPersistence } from "@/components/browser-swarm/persistence";

interface TotalsBody {
  readonly total_bots: number;
  readonly total_swarms: number;
  readonly total_devices: number;
  readonly cached_at_utc: string;
}

interface LocalState {
  readonly my_total: number;
  /** Best-effort: equals my_total pre-kickoff. After kickoff we'd
   *  consult settled-match results to drop misses; until those land
   *  this number tracks my_total verbatim. */
  readonly still_perfect: number;
}

const POLL_MS = 45_000;

export function ArenaStats() {
  const [local, setLocal] = useState<LocalState | null>(null);
  const [totals, setTotals] = useState<TotalsBody | null>(null);

  // Load device-local count once on mount.
  useEffect(() => {
    let cancelled = false;
    defaultPersistence()
      .loadSwarmState()
      .then((load) => {
        if (cancelled) return;
        const myTotal = load.state.total_bots_generated;
        // Pre-kickoff: every bot still has a perfect record (no match
        // results have landed yet). After kickoff this calls into the
        // settled-match comparator on the browser-swarm side once
        // that ships. Tim 2026-06-08.
        setLocal({ my_total: myTotal, still_perfect: myTotal });
      })
      .catch(() => setLocal({ my_total: 0, still_perfect: 0 }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll server-aggregate every 45s. The endpoint itself caches for
  // 60s; this cadence keeps the chip live without ever hitting the
  // cold path.
  useEffect(() => {
    let cancelled = false;
    const fetchTotals = async () => {
      try {
        const res = await fetch("/v1/swarm/totals", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as TotalsBody;
        if (!cancelled) setTotals(body);
      } catch {
        /* silent: chips just stay on last good value */
      }
    };
    void fetchTotals();
    const id = window.setInterval(fetchTotals, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Hide the strip entirely until we know something interesting.
  const myTotal = local?.my_total ?? 0;
  const arenaTotal = totals?.total_bots ?? 0;
  if (myTotal === 0 && arenaTotal === 0) return null;

  return (
    <section className="vt-arena-stats" aria-label="Bot arena live stats">
      {myTotal > 0 && (
        <ArenaStat
          label="My swarm"
          value={myTotal}
          sub="bots in my browser"
        />
      )}
      {myTotal > 0 && (
        <ArenaStat
          label="Still perfect"
          value={local?.still_perfect ?? 0}
          sub="no misses yet"
          tone="gold"
        />
      )}
      {arenaTotal > 0 && (
        <ArenaStat
          label="Bots in the arena"
          value={arenaTotal}
          sub={`across ${formatCompact(totals?.total_devices ?? 0)} devices`}
        />
      )}
    </section>
  );
}

function ArenaStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "gold";
}) {
  return (
    <article className="vt-arena-stat" data-tone={tone}>
      <span className="vt-arena-stat-label">{label}</span>
      <strong className="vt-arena-stat-value" aria-live="polite">
        {formatCompact(value)}
      </strong>
      <span className="vt-arena-stat-sub">{sub}</span>
    </article>
  );
}

/** Compact integer formatter: 1234 -> "1,234", 12345 -> "12.3K",
 *  1_234_567 -> "1.23M", 1_500_000_000 -> "1.50B". Keeps the chip
 *  predictable in width as the global aggregate scales. */
function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 10_000) return n.toLocaleString();
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs < 1_000_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  return `${(n / 1_000_000_000_000).toFixed(2)}T`;
}
