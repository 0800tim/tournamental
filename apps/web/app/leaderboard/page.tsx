/*
 * Copyright 2026 Tournamental
 * Apache 2.0 (see LICENSE).
 */

/**
 * /leaderboard, pool cycler.
 *
 * Tim 2026-06-12 rework: the previous Humans / Bots / Global / Country /
 * My Pools tab strip is gone. The leaderboard is now scoped to the
 * viewer's own pools, with a chip strip across the top, one chip per
 * pool the viewer owns or is a member of. Tapping a chip selects that
 * pool via `?pool=<slug>` and renders its full leaderboard inline,
 * matching the row treatment used on /s/<slug>: rank, avatar with
 * country flag overlay, name + handle, and X / Y predictions count.
 *
 * Bot Arena, the pundit rail, the kickoff hero stats, and the points-
 * vs-pool chart all dropped on the same pass to keep this surface
 * laser-focused on "your pools, your standings".
 *
 * For a signed-out viewer or a signed-in viewer with zero pools we
 * render a polite empty state pointing at the pools index.
 *
 * Data flow:
 *   - User's pools are sourced from /api/v1/profile/syndicates via an
 *     internal fetch with the inbound cookies forwarded so the session
 *     resolves on the server.
 *   - The active pool's record is loaded directly via loadSyndicateBySlug
 *     and members are enriched server-side; this is the same chain that
 *     powers /s/<slug>.
 *   - Y (matches available) per pool comes from the syndicate-scoped
 *     leaderboard route in the game service, taking the global max
 *     across rows so pre-kickoff pools render a clean 0 / 0 (which
 *     hides the badge) and post-kickoff pools render the right denom.
 */

import { cookies, headers } from "next/headers";
import Link from "next/link";

import { AppShell } from "@/components/shell";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { DEFAULT_AVATAR_DATA_URI } from "@/lib/profile/avatar";
import { fetchSyndicateLeaderboard } from "@/lib/leaderboard/fetch";
import { slugifyDisplayName } from "@/lib/share/handle-slug";
import { enrichSyndicateMembers } from "@/lib/syndicate/enrich-members";
import { loadSyndicateBySlug } from "@/lib/syndicate/store";

// share-landing.css owns the `.vt-share-pool-lb-*` row treatment used
// by the per-pool body. Importing it here also brings those rules into
// the /leaderboard route's CSS bundle so the rows render identically to
// the ones on /s/<slug>.
import "@/components/share-landing/share-landing.css";
import "./leaderboard.css";

export const dynamic = "force-dynamic";

interface MyPool {
  readonly slug: string;
  readonly name: string;
  readonly role: "owner" | "member";
  readonly member_count: number;
  readonly tournament_id: string;
}

interface PageSearchParams {
  readonly pool?: string | string[];
}

/**
 * Resolve the absolute origin we should call our own API routes on.
 * In a server component the host header is the user's request host;
 * `x-forwarded-proto` carries the scheme behind the prod tunnel.
 */
function selfOrigin(): string {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3300";
  return `${proto}://${host}`;
}

async function loadMyPools(): Promise<MyPool[]> {
  const url = `${selfOrigin()}/api/v1/profile/syndicates`;
  try {
    const r = await fetch(url, {
      headers: {
        cookie: cookies().toString(),
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!r.ok) return [];
    const body = (await r.json()) as { syndicates?: MyPool[] };
    return body.syndicates ?? [];
  } catch {
    return [];
  }
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: PageSearchParams;
}): Promise<JSX.Element> {
  const myPools = await loadMyPools();

  // No pools / signed out: friendly empty state.
  if (myPools.length === 0) {
    return (
      <AppShell title="Leaderboard">
        <div className="vt-page-content vt-lb-page vt-lb-empty">
          <RevealOnScroll as="section" className="vt-lb-empty-card">
            <p className="vt-dateline">Leaderboard</p>
            <h2 className="vt-lb-empty-head">
              Your pool leaderboards land here.
            </h2>
            <p className="vt-lb-empty-body">
              You are not in a pool yet. Join one (or run your own) and
              this page will list your standings, match by match.
            </p>
            <div className="vt-lb-empty-actions">
              <Link href="/pools" className="vt-lb-empty-cta">
                Browse pools
                <span aria-hidden="true"> →</span>
              </Link>
              <Link
                href="/pools/new"
                className="vt-lb-empty-cta vt-lb-empty-cta--ghost"
              >
                Run my own pool
                <span aria-hidden="true"> →</span>
              </Link>
            </div>
          </RevealOnScroll>
        </div>
      </AppShell>
    );
  }

  // Resolve the active pool. Default is the first pool the viewer is
  // in; the `?pool=<slug>` query overrides for the chip clicks.
  const wantedSlugRaw = Array.isArray(searchParams?.pool)
    ? searchParams!.pool[0]
    : searchParams?.pool;
  const wantedSlug = (wantedSlugRaw ?? "").trim().toLowerCase();
  const activePool =
    myPools.find((p) => p.slug === wantedSlug) ?? myPools[0];

  // Load the active pool's full record so we can enrich members
  // server-side. The slug-resolver is the same one that powers
  // /s/<slug>, so this is a known-cheap call.
  const activeRecord = await loadSyndicateBySlug(activePool.slug);

  // Build the body. If the record fails to load (rare; would indicate
  // the pool was archived between profile-fetch and now), fall through
  // to an inline note rather than 500-ing.
  let body: JSX.Element;
  if (!activeRecord) {
    body = (
      <p className="vt-lb-empty-body">
        We could not load the {activePool.name} leaderboard right now.
        Please refresh or check back in a minute.
      </p>
    );
  } else {
    const enrichedMembers = await enrichSyndicateMembers({
      members: activeRecord.members,
      tournamentId: activeRecord.tournament_id,
    });
    const lbSorted = [...enrichedMembers].sort(
      (a, b) =>
        b.points - a.points || a.joined_at.localeCompare(b.joined_at),
    );
    let lbRank = 0;
    let lbPrevPoints: number | null = null;
    const leaderboardRows = lbSorted.map((m, i) => {
      if (lbPrevPoints === null || m.points !== lbPrevPoints) {
        lbRank = i + 1;
        lbPrevPoints = m.points;
      }
      return { m, rank: lbRank };
    });

    // Y for the X / Y predictions column. Sourced from the game
    // service's syndicate leaderboard; max across rows is the pool's
    // Y. If the service is unreachable we fall back to 0 and the
    // badge hides itself per the same rule as /s/<slug>.
    let matchesAvailableForPool = 0;
    try {
      const lb = await fetchSyndicateLeaderboard(
        activeRecord.tournament_id,
        activeRecord.slug,
      );
      for (const r of lb.rows) {
        if (r.matches_available_to_user > matchesAvailableForPool) {
          matchesAvailableForPool = r.matches_available_to_user;
        }
      }
    } catch {
      /* game service unreachable, skip the X / Y badge */
    }

    body = (
      <div className="vt-share-pool-lb" role="list">
        {leaderboardRows.map(({ m, rank }) => {
          const label = m.display_name?.trim() || m.handle;
          const avatarSrc = m.avatar_url ?? DEFAULT_AVATAR_DATA_URI;
          const slug =
            slugifyDisplayName(m.display_name) ??
            slugifyDisplayName(m.handle) ??
            null;
          const isPermalinkUser =
            !!m.user_id && /^u_[0-9a-f]+$/i.test(m.user_id);
          const profileHref = slug
            ? `/s/${slug}`
            : isPermalinkUser
              ? `/s/${m.user_id}`
              : null;
          const cardKey = m.user_id ?? m.handle;
          const inner = (
            <>
              <span className="vt-share-pool-lb-rank">{rank}</span>
              <span className="vt-share-pool-lb-avatar-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="vt-share-pool-lb-avatar"
                  src={avatarSrc}
                  alt=""
                  width={128}
                  height={128}
                  loading="lazy"
                />
                {m.flag_emoji && (
                  <span className="vt-share-pool-lb-flag" aria-hidden="true">
                    {m.flag_emoji}
                  </span>
                )}
              </span>
              <span className="vt-share-pool-lb-name">
                {label}
                {m.display_name && (
                  <span className="vt-share-pool-lb-handle">@{m.handle}</span>
                )}
              </span>
              {matchesAvailableForPool > 0 && (
                <span
                  className="vt-share-pool-lb-score"
                  aria-label={`${m.points} correct of ${matchesAvailableForPool}`}
                >
                  <span className="vt-share-pool-lb-score-x">{m.points}</span>
                  <span className="vt-share-pool-lb-score-sep">/</span>
                  <span className="vt-share-pool-lb-score-y">
                    {matchesAvailableForPool}
                  </span>
                </span>
              )}
            </>
          );
          return profileHref ? (
            <a
              key={cardKey}
              className="vt-share-pool-lb-row vt-share-pool-lb-row--link"
              href={profileHref}
              role="listitem"
              aria-label={`View ${label}'s bracket`}
            >
              {inner}
            </a>
          ) : (
            <div
              key={cardKey}
              className="vt-share-pool-lb-row"
              role="listitem"
            >
              {inner}
            </div>
          );
        })}
      </div>
    );
  }

  // Single-pool shortcut: skip the chip strip when there's only one
  // pool to choose. The hero still reads "<pool> leaderboard" so the
  // viewer knows which surface they are on.
  const showChips = myPools.length > 1;

  return (
    <AppShell title="Leaderboard">
      <div className="vt-page-content vt-lb-page">
        <RevealOnScroll as="section" className="vt-lb-pool-header">
          <p className="vt-dateline">Pool leaderboard</p>
          <h1 className="vt-lb-pool-title">{activePool.name}</h1>
        </RevealOnScroll>

        {showChips && (
          <nav className="vt-lb-pool-chips" aria-label="Your pools">
            {myPools.map((p) => {
              const active = p.slug === activePool.slug;
              const href = active ? "/leaderboard" : `/leaderboard?pool=${p.slug}`;
              return (
                <Link
                  key={p.slug}
                  href={href}
                  className="vt-lb-pool-chip"
                  data-active={active ? "1" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {p.name}
                </Link>
              );
            })}
          </nav>
        )}

        <section className="vt-lb-pool-body">{body}</section>
      </div>
    </AppShell>
  );
}
