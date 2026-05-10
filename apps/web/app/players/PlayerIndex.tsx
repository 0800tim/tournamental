"use client";

/**
 * Client-side interactive index. Holds the search/filter state, applies
 * the same `searchPlayers()` helpers used by tests, paginates 24 rows.
 *
 * Why a client component? With ~1056 records the search is comfortably
 * in-memory — no need to round-trip a server every keystroke.
 */

import { useDeferredValue, useMemo, useState } from "react";

import { PlayerCard } from "@/components/player/PlayerCard";
import {
  searchPlayers,
  type PlayerPosition,
  type PlayerRecord,
} from "@/lib/players";

const PAGE_SIZE = 24;

export interface PlayerIndexProps {
  readonly players: readonly PlayerRecord[];
  readonly teamOptions: ReadonlyArray<{ readonly code: string; readonly name: string; readonly flag: string }>;
  readonly clubOptions: readonly string[];
}

const POSITIONS: ReadonlyArray<PlayerPosition | "ALL"> = ["ALL", "GK", "DEF", "MID", "FWD"];

export function PlayerIndex({ players, teamOptions, clubOptions }: PlayerIndexProps) {
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [pos, setPos] = useState<PlayerPosition | "ALL">("ALL");
  const [club, setClub] = useState("");
  const [page, setPage] = useState(0);
  const deferred = useDeferredValue(q);

  const filtered = useMemo(
    () => searchPlayers({ q: deferred, code, position: pos, club }, players),
    [deferred, code, pos, club, players],
  );
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <>
      <div className="player-index-toolbar" role="search">
        <div className="player-index-search">
          <label htmlFor="player-search-q">Search</label>
          <input
            id="player-search-q"
            type="search"
            placeholder="Player name, team, club…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            data-testid="player-search-input"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="player-filter-team">Team</label>
          <select
            id="player-filter-team"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setPage(0);
            }}
            data-testid="player-filter-team"
          >
            <option value="">All teams</option>
            {teamOptions.map((t) => (
              <option key={t.code} value={t.code}>
                {t.flag ? `${t.flag} ` : ""}
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="player-filter-position">Position</label>
          <select
            id="player-filter-position"
            value={pos}
            onChange={(e) => {
              setPos(e.target.value as PlayerPosition | "ALL");
              setPage(0);
            }}
            data-testid="player-filter-position"
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p === "ALL" ? "All positions" : p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="player-filter-club">Club</label>
          <select
            id="player-filter-club"
            value={club}
            onChange={(e) => {
              setClub(e.target.value);
              setPage(0);
            }}
            data-testid="player-filter-club"
          >
            <option value="">All clubs</option>
            {clubOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="player-index-result-count" data-testid="player-index-count">
        {filtered.length.toLocaleString()} player{filtered.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <div className="player-index-empty" data-testid="player-index-empty">
          No players match your filters. Try clearing one.
        </div>
      ) : (
        <ul className="player-grid" data-testid="player-grid">
          {visible.map((p) => (
            <li key={p.id}>
              <PlayerCard player={p} />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="player-index-pager" aria-label="Pagination">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
            data-testid="player-index-prev"
          >
            ← Prev
          </button>
          <span data-testid="player-index-page-indicator">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((n) => Math.min(totalPages - 1, n + 1))}
            data-testid="player-index-next"
          >
            Next →
          </button>
        </nav>
      )}
    </>
  );
}
