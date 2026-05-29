"use client";

/**
 * Client island for the public pool directory. Renders the pool grid and a
 * debounced search box that re-queries /api/v1/syndicates/public. Seeded
 * with the server-rendered `initialPools` so the first paint is instant and
 * SEO-friendly; typing swaps in live results.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { countriesFromAllowed } from "@/lib/syndicate/country-gate";
import {
  type PublicPoolDto,
  tournamentLabel,
} from "@/lib/syndicate/public-directory";

function monogram(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "");
  return (letters.join("") || name[0] || "?").toUpperCase();
}

/** Country-gate badge text + tooltip text per spec §3:
 *   1 country  → "🇳🇿 NZ only"
 *   2 countries→ "🇳🇿🇦🇺 NZ + AU only"
 *   3-4        → "🇳🇿🇦🇺🇬🇧 NZ + AU + UK only"
 *   5+         → "🇳🇿🇦🇺🇬🇧🇮🇪 +N countries only" (tooltip lists all)
 * Empty allow-list returns null so the badge is hidden entirely. */
function formatCountryBadge(dialCodes: string[]): { label: string; tooltip: string } | null {
  if (!dialCodes.length) return null;
  const countries = countriesFromAllowed(dialCodes);
  if (!countries.length) return null;
  const isoLabel = (n: number) => countries.slice(0, n).map((c) => c.iso).join(" + ");
  const flags4 = countries.slice(0, 4).map((c) => c.flag).join("");
  const tooltip = `${countries.map((c) => `${c.flag} ${c.name}`).join(", ")} only`;
  if (countries.length <= 4) {
    const flags = countries.map((c) => c.flag).join("");
    return { label: `${flags} ${isoLabel(countries.length)} only`, tooltip };
  }
  return { label: `${flags4} +${countries.length} countries only`, tooltip };
}

function PoolCard({ pool }: { pool: PublicPoolDto }) {
  const blurb = pool.prize_text?.trim() || pool.topic?.trim() || null;
  const country = formatCountryBadge(pool.allowed_phone_countries);
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
          {country ? (
            <span
              className="vt-pool-tag vt-pool-tag-country"
              title={country.tooltip}
              aria-label={country.tooltip}
            >
              {country.label}
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}

export function PoolDirectory({
  initialPools,
  eligibleFor,
}: {
  initialPools: PublicPoolDto[];
  /** Forwarded when the page was loaded with ?eligible_for=<phone>.
   * Search queries keep the same filter applied so the directory
   * never bounces back to "all pools" mid-typing. */
  eligibleFor?: string;
}) {
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
        const url = eligibleFor
          ? `/api/v1/syndicates/public?search=${encodeURIComponent(q)}&eligible_for=${encodeURIComponent(eligibleFor)}`
          : `/api/v1/syndicates/public?search=${encodeURIComponent(q)}`;
        const res = await fetch(url, { signal: ac.signal });
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
  }, [query, initialPools, eligibleFor]);

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

      <section className="vt-pools-types" aria-labelledby="vt-pools-types-h2">
        <p className="vt-pools-types-eyebrow">Run your own pool</p>
        <h2 id="vt-pools-types-h2" className="vt-pools-types-h2">
          Anyone can start one. Live in 5 minutes.
        </h2>
        <div className="vt-pools-types-grid">
          <article className="vt-pools-type">
            <h3 className="vt-pools-type-name">Private</h3>
            <p className="vt-pools-type-blurb">
              For your family or friends. Invite-only. No fee, no fuss, bragging
              rights for the winner.
            </p>
          </article>
          <article className="vt-pools-type">
            <h3 className="vt-pools-type-name">Office sweepstake</h3>
            <p className="vt-pools-type-blurb">
              Set an entry fee and a prize pool. Members chip in, you run it
              your way. We handle the bracket, scoring, and leaderboard.
            </p>
          </article>
          <article className="vt-pools-type">
            <h3 className="vt-pools-type-name">Open / brand</h3>
            <p className="vt-pools-type-blurb">
              Public to all. Use it to engage your audience or attract new
              signups around your prize. Branded with your logo and colours.
            </p>
          </article>
        </div>
        <Link href="/syndicates/new" className="vt-pools-types-cta">
          Start your pool →
        </Link>
      </section>

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
