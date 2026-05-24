"use client";

/**
 * Client island for the public pool directory. Renders the pool grid and a
 * debounced search box that re-queries /api/v1/syndicates/public. Seeded
 * with the server-rendered `initialPools` so the first paint is instant and
 * SEO-friendly; typing swaps in live results.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  type PublicPoolDto,
  tournamentLabel,
} from "@/lib/syndicate/public-directory";

function monogram(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "");
  return (letters.join("") || name[0] || "?").toUpperCase();
}

function PoolCard({ pool }: { pool: PublicPoolDto }) {
  const blurb = pool.prize_text?.trim() || pool.topic?.trim() || null;
  return (
    <Link href={pool.share_url} className="vt-pool-card" prefetch={false}>
      <div className="vt-pool-card-head">
        {pool.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="vt-pool-card-logo" src={pool.logo_url} alt="" loading="lazy" />
        ) : (
          <span className="vt-pool-card-monogram" aria-hidden="true">
            {monogram(pool.name)}
          </span>
        )}
        <div className="vt-pool-card-titles">
          <h3 className="vt-pool-card-name">{pool.name}</h3>
          <p className="vt-pool-card-tournament">{tournamentLabel(pool.tournament_id)}</p>
        </div>
      </div>

      {blurb ? <p className="vt-pool-card-blurb">{blurb}</p> : null}

      <div className="vt-pool-card-foot">
        <span className="vt-pool-card-members">
          {pool.member_count} {pool.member_count === 1 ? "member" : "members"}
        </span>
        <span className="vt-pool-card-tags">
          {pool.is_free ? <span className="vt-pool-tag vt-pool-tag-free">Free to enter</span> : null}
          {pool.has_prize ? <span className="vt-pool-tag vt-pool-tag-prize">Prize</span> : null}
        </span>
      </div>
    </Link>
  );
}

export function PoolDirectory({ initialPools }: { initialPools: PublicPoolDto[] }) {
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<PublicPoolDto[]>(initialPools);
  const [loading, setLoading] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    // Empty query → restore the server-rendered list, no fetch.
    if (!q) {
      acRef.current?.abort();
      setPools(initialPools);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const res = await fetch(
          `/api/v1/syndicates/public?search=${encodeURIComponent(q)}`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { pools: PublicPoolDto[] };
        setPools(data.pools);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setPools([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, initialPools]);

  return (
    <main className="vt-pools">
      <header className="vt-pools-head">
        <p className="vt-pools-eyebrow">Public pools</p>
        <h1 className="vt-pools-title">Find a pool to join</h1>
        <p className="vt-pools-lede">
          Open prediction pools anyone can join in a tap. Free to enter, run by
          hosts, offices, and creators for the FIFA World Cup 2026.
        </p>
        <div className="vt-pools-actions">
          <Link href="/syndicates/new" className="vt-pools-cta">
            Start your own pool
          </Link>
          <Link href="/syndicates" className="vt-pools-link">
            How pools work
          </Link>
        </div>
      </header>

      <div className="vt-pools-searchbar">
        <input
          type="search"
          inputMode="search"
          className="vt-pools-search"
          placeholder="Search pools by name…"
          aria-label="Search public pools"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="vt-pools-count" aria-live="polite">
          {loading ? "Searching…" : `${pools.length} ${pools.length === 1 ? "pool" : "pools"}`}
        </span>
      </div>

      {pools.length > 0 ? (
        <ul className="vt-pools-grid">
          {pools.map((p) => (
            <li key={p.slug}>
              <PoolCard pool={p} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="vt-pools-empty">
          {query.trim() ? (
            <>
              <p>No public pools match “{query.trim()}”.</p>
              <p className="vt-pools-empty-sub">Try a different name, or start your own.</p>
            </>
          ) : (
            <>
              <p>No public pools yet.</p>
              <p className="vt-pools-empty-sub">Be the first: create one and make it public.</p>
            </>
          )}
          <Link href="/syndicates/new" className="vt-pools-cta">
            Start a pool
          </Link>
        </div>
      )}
    </main>
  );
}
