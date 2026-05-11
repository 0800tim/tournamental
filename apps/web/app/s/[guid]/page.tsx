/**
 * /s/[guid], universal share-landing route.
 *
 * Single URL surface for every "share my bracket" / "join my syndicate"
 * CTA on the platform. Resolution order (see `lib/share/resolve-guid.ts`):
 *
 *   1. syndicate slug (`/s/argentina-pool`)        → syndicate landing
 *   2. user share guid (UUID v4 or 16-char nanoid) → user landing
 *   3. otherwise                                   → friendly 404
 *
 * Server component, runs on the edge of every share-link click. Sets
 * Cache-Control:
 *   - user landing:     public, s-maxage=300, stale-while-revalidate=86400
 *   - syndicate landing: public, s-maxage=60,  stale-while-revalidate=600
 * via the route handler `headers()` mechanic (Next 14 only honours static
 * `revalidate` on RSCs, so we mirror the cache hint in `<meta>` and rely
 * on the upstream CDN to set the actual `Cache-Control` from
 * `docs/22-deployment-and-tunnels.md`, the route is keyed by the guid
 * + (for user) bracket commit timestamp so re-saves bust cleanly).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/shell";
import { ShareActions } from "@/components/share-landing/ShareActions";
import { JoinSyndicate } from "@/components/share-landing/JoinSyndicate";
import { ShareMoleculeEmbed } from "@/components/share-landing/ShareMoleculeEmbed";
import { resolveShareGuid } from "@/lib/share/resolve-guid";
import type { BracketByGuid } from "@/lib/bracket/by-guid";
import type { SyndicateRecord } from "@/lib/syndicate/store";

import "@/components/share-landing/share-landing.css";

// 60-second edge revalidation mirrors the upstream game-service's
// `s-maxage=60`. Re-shares (the common case, one tweet -> thousands of
// clicks) hit the CDN; the bracket owner's re-saves bust the cache
// inside a minute.
export const revalidate = 60;

interface PageProps {
  readonly params: { readonly guid: string };
}

// ── Metadata ────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: PageProps,
): Promise<Metadata> {
  // Metadata fetch doesn't need the heavy payload; just the summary.
  const resolved = await resolveShareGuid(params.guid);
  if (resolved.kind === "syndicate") {
    const s = resolved.syndicate;
    const ogUrl = `/api/og/syndicate?slug=${encodeURIComponent(s.slug)}`;
    return {
      title: `${s.name} on Tournamental`,
      description: `${s.members.length} member${s.members.length === 1 ? "" : "s"} predicting the ${s.tournament_label}. Join the pool.`,
      openGraph: {
        title: `${s.name} on Tournamental`,
        description: `${s.members.length} member${s.members.length === 1 ? "" : "s"} predicting the ${s.tournament_label}. Join the pool.`,
        images: [{ url: ogUrl, width: 1200, height: 630, alt: s.name }],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: `${s.name} on Tournamental`,
        description: `${s.members.length} member${s.members.length === 1 ? "" : "s"} predicting the ${s.tournament_label}. Join the pool.`,
        images: [ogUrl],
      },
      other: {
        "cache-control":
          "public, s-maxage=60, stale-while-revalidate=600",
      },
    };
  }
  if (resolved.kind === "user") {
    const b = resolved.bracket;
    const ogUrl = `/api/og/bracket?bracket_id=${encodeURIComponent(b.bracket_id)}&handle=${encodeURIComponent(b.handle)}&winner=${encodeURIComponent(b.champion.name)}`;
    const title = `@${b.handle} picked ${b.champion.name} to lift the ${b.tournament_label} trophy`;
    return {
      title,
      description: `Predicted podium: ${b.champion.name} • ${b.runner_up.name} • ${b.third_place.name}. Build your own bracket on Tournamental.`,
      openGraph: {
        title,
        description: `Predicted podium: ${b.champion.name} • ${b.runner_up.name} • ${b.third_place.name}. Build your own bracket on Tournamental.`,
        images: [
          { url: ogUrl, width: 1200, height: 630, alt: `${b.handle}'s bracket` },
        ],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: `Predicted podium: ${b.champion.name} • ${b.runner_up.name} • ${b.third_place.name}.`,
        images: [ogUrl],
      },
      other: {
        "cache-control":
          "public, s-maxage=300, stale-while-revalidate=86400",
      },
    };
  }
  return {
    title: "Share link not found, Tournamental",
    description: "This share link doesn't resolve. Pick a fresh bracket.",
  };
}

// ── Page ────────────────────────────────────────────────────────────

export default async function SharePage({ params }: PageProps) {
  // The page (not the metadata) is the one that needs the full
  // bracket payload — the molecule embed lives in the page body.
  const resolved = await resolveShareGuid(params.guid, {
    includePayload: true,
  });

  if (resolved.kind === "not_found") {
    return (
      <AppShell title="Tournamental">
        <NotFoundView attempted={resolved.attempted} />
      </AppShell>
    );
  }

  if (resolved.kind === "syndicate") {
    return (
      <AppShell title="Tournamental">
        <SyndicateLanding syndicate={resolved.syndicate} />
      </AppShell>
    );
  }

  // resolved.kind === "user"
  return (
    <AppShell title="Tournamental">
      <UserLanding bracket={resolved.bracket} />
    </AppShell>
  );
}

// ── User landing ────────────────────────────────────────────────────

function UserLanding({ bracket }: { bracket: BracketByGuid }) {
  const { handle, champion, runner_up, third_place, path_to_gold, tournament_label, saved_at } =
    bracket;
  const ogSrc = `/api/og/bracket?bracket_id=${encodeURIComponent(bracket.bracket_id)}&handle=${encodeURIComponent(handle)}&winner=${encodeURIComponent(champion.name)}`;
  const savedDisplay = formatSavedAt(saved_at);

  return (
    <section className="vt-share vt-share-user" data-testid="share-user-landing">
      <header className="vt-share-hero">
        <span className="vt-share-hero-eyebrow">{tournament_label}</span>
        <h1 className="vt-share-hero-title">
          <span className="vt-share-flag" aria-hidden>
            {champion.flag_emoji}
          </span>
          <span>{champion.name}</span>
        </h1>
        <p className="vt-share-hero-subhead">
          @{handle} picked {champion.name} to lift the trophy
        </p>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="vt-share-og"
        src={ogSrc}
        alt={`${handle}'s podium prediction`}
        width={1200}
        height={630}
        loading="eager"
        decoding="async"
      />

      <div className="vt-share-podium" aria-label="Predicted podium">
        <PodiumCup rank="silver" team={runner_up} cup="🥈" />
        <PodiumCup rank="gold" team={champion} cup="🥇" />
        <PodiumCup rank="bronze" team={third_place} cup="🥉" />
      </div>

      {/* Live 3D molecule. Tim 2026-05-11: every share landing should
        * embed the owner's actual predicted molecule, not just a flat
        * podium image. Read-only — the viewer can rotate / zoom but
        * can't edit picks. */}
      {bracket.payload ? (
        <ShareMoleculeEmbed bracket={bracket.payload} />
      ) : null}

      <div className="vt-share-path" aria-label="Champion's path to gold">
        <h2 className="vt-share-path-title">Path to gold</h2>
        <ul className="vt-share-path-list">
          {path_to_gold.map((p) => (
            <li className="vt-share-path-row" key={p.stage}>
              <span className="vt-share-path-stage">{p.stage_label}</span>
              <span className="vt-share-path-opp">
                <span aria-hidden>{p.opponent_flag_emoji}</span>
                <span>beats {p.opponent_name}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ShareActions
        shareTitle={`@${handle}'s ${tournament_label} bracket`}
        shareText={`@${handle} picked ${champion.name} to lift the ${tournament_label} trophy.`}
      />

      <footer className="vt-share-footer">
        Saved {savedDisplay}, locked at kickoff.
      </footer>
    </section>
  );
}

function PodiumCup({
  rank,
  team,
  cup,
}: {
  rank: "gold" | "silver" | "bronze";
  team: { code: string; name: string; flag_emoji: string };
  cup: string;
}) {
  const label = rank === "gold" ? "Champion" : rank === "silver" ? "Runner-up" : "Third place";
  return (
    <div className="vt-share-podium-cup" data-rank={rank}>
      <span className="vt-share-podium-emoji" aria-hidden>
        {cup}
      </span>
      <span className="vt-share-podium-flag" aria-hidden>
        {team.flag_emoji}
      </span>
      <span className="vt-share-podium-name">{team.name}</span>
      <span className="vt-share-podium-rank-label">{label}</span>
    </div>
  );
}

function formatSavedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm} UTC`;
  } catch {
    return iso;
  }
}

// ── Syndicate landing ───────────────────────────────────────────────

function SyndicateLanding({ syndicate }: { syndicate: SyndicateRecord }) {
  const ogSrc = `/api/og/syndicate?slug=${encodeURIComponent(syndicate.slug)}`;
  const topFive = [...syndicate.members]
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  const allPointsZero = topFive.every((m) => m.points === 0);
  const recentMembers = [...syndicate.members]
    .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
    .slice(0, 12);

  return (
    <section className="vt-share vt-share-syn" data-testid="share-syndicate-landing">
      <header className="vt-share-hero">
        <span className="vt-share-hero-eyebrow">{syndicate.tournament_label}</span>
        <h1 className="vt-share-hero-title vt-share-syn-title">
          <span className="vt-share-flag" aria-hidden>
            {syndicate.owner_country_emoji}
          </span>
          <span>{syndicate.name}</span>
        </h1>
        <p className="vt-share-hero-subhead">
          hosted by @{syndicate.owner_handle}
        </p>
        <div className="vt-share-stats-row" role="list">
          <span className="vt-share-stat" role="listitem">
            <span className="vt-share-stat-value">{syndicate.members.length}</span>{" "}
            member{syndicate.members.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden>·</span>
          <span className="vt-share-stat" role="listitem">
            <span className="vt-share-stat-value">{syndicate.picks_made}</span>{" "}
            pick{syndicate.picks_made === 1 ? "" : "s"} made
          </span>
        </div>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="vt-share-og"
        src={ogSrc}
        alt={`${syndicate.name} on Tournamental`}
        width={1200}
        height={630}
        loading="eager"
        decoding="async"
      />

      <div>
        <h2 className="vt-share-syn-section-title">Leaderboard top 5</h2>
        {allPointsZero ? (
          <div className="vt-share-leaderboard-empty">
            Leaderboard activates at kickoff, first match Mexico vs the world, 11 Jun 2026.
          </div>
        ) : (
          <ol className="vt-share-leaderboard" aria-label="Leaderboard top 5">
            {topFive.map((m, i) => (
              <li className="vt-share-leaderboard-row" key={m.handle}>
                <span className="vt-share-leaderboard-rank">{i + 1}</span>
                <span className="vt-share-leaderboard-flag" aria-hidden>
                  {m.flag_emoji}
                </span>
                <span className="vt-share-leaderboard-handle">@{m.handle}</span>
                <span className="vt-share-leaderboard-pts">{m.points}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="vt-share-ctas">
        <JoinSyndicate slug={syndicate.slug} syndicateName={syndicate.name} />
        <a
          className="vt-share-cta"
          data-variant="secondary"
          href="/world-cup-2026"
        >
          Make your bracket first
        </a>
      </div>

      <div>
        <h2 className="vt-share-syn-section-title">Recent members</h2>
        <div className="vt-share-members-grid" role="list">
          {recentMembers.map((m) => (
            <div className="vt-share-member-tile" key={m.handle} role="listitem">
              <span className="vt-share-member-flag" aria-hidden>
                {m.flag_emoji}
              </span>
              <span className="vt-share-member-handle">@{m.handle}</span>
            </div>
          ))}
        </div>
      </div>

      <footer className="vt-share-footer">
        Founded {formatSavedAt(syndicate.created_at)}.
      </footer>
    </section>
  );
}

// ── 404 ─────────────────────────────────────────────────────────────

function NotFoundView({ attempted }: { attempted: string }) {
  // Keep the page 200 so social previewers still see a friendly card.
  // Calling notFound() here would emit a 404 status; we intentionally
  // do NOT call it so embeds render the fallback hero.
  void notFound; // keep import referenced
  void attempted;
  return (
    <section className="vt-share vt-share-404" data-testid="share-not-found">
      <div className="vt-share-404-emoji" aria-hidden>
        🧭
      </div>
      <h1 className="vt-share-404-title">Share link not found</h1>
      <p className="vt-share-404-body">
        We couldn&apos;t find that prediction or syndicate. Pick a fresh
        bracket instead, kick-off is closer than you think.
      </p>
      <a className="vt-share-cta" data-variant="primary" href="/world-cup-2026">
        Make a fresh bracket
      </a>
    </section>
  );
}
