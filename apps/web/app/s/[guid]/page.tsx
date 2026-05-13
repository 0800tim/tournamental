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

// Legacy URLs from before 2026-05-13 used the full server `bracketId`
// (shape `bk_<userId-uuid>_<tournamentId>_<timestamp>`) as the share
// guid, which the new resolver doesn't recognise. Normalise back to the
// embedded userId UUID so old links resolve cleanly.
function normaliseGuid(raw: string): string {
  const m = (raw ?? "").match(
    /^bk_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_/i,
  );
  return m ? m[1] : raw;
}

export async function generateMetadata(
  { params }: PageProps,
): Promise<Metadata> {
  // Metadata fetch doesn't need the heavy payload; just the summary.
  const resolved = await resolveShareGuid(normaliseGuid(params.guid));
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
  const resolved = await resolveShareGuid(normaliseGuid(params.guid), {
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

      {/* v6.1, "viral share landing" follow-up (2026-05-11). Tim's
        * brief calls out: the runner-up + 3rd-place flags must be
        * BIG (not buried inside a knockout list) so anyone glancing
        * at the page from across the room sees "gold X, silver Y,
        * bronze Z" in one beat. This row is the hero, sitting above
        * the molecule embed. The static OG `<img>` is gone — the
        * embedded MoleculeScene IS the live equivalent. */}
      <div
        className="vt-share-podium-hero"
        data-testid="share-podium-hero"
        aria-label="Predicted podium"
      >
        <PodiumHeroTile rank="silver" team={runner_up} ordinal="2ND" cup="🥈" />
        <PodiumHeroTile rank="gold" team={champion} ordinal="1ST" cup="🥇" />
        <PodiumHeroTile rank="bronze" team={third_place} ordinal="3RD" cup="🥉" />
      </div>

      {/* Live 3D molecule. Tim 2026-05-11: every share landing should
        * embed the owner's actual predicted molecule, not just a flat
        * podium image. Read-only — the viewer can rotate / zoom but
        * can't edit picks. The MoleculeScene auto-selects the predicted
        * champion on mount (PR #159) so the panel is open by default
        * and visitors land on the exact pyramid + champion-panel
        * composition Tim ships as the share image. */}
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

/**
 * v6.1, "viral share landing" follow-up (2026-05-11). The hero podium
 * tile is the BIG, scan-from-across-the-room rendering of one medal
 * position. Each tile:
 *
 *   - 80px flag emoji
 *   - 28px bold team code
 *   - "1ST / 2ND / 3RD" pill in the medal accent colour
 *   - team name in 16px under the pill
 *
 * The gold tile sits 12px higher than silver / bronze so the eye
 * naturally lands on it first (same trick the old `.vt-share-podium`
 * row used). On mobile the row collapses to a stacked column with
 * the gold tile slightly enlarged.
 */
function PodiumHeroTile({
  rank,
  team,
  ordinal,
  cup,
}: {
  rank: "gold" | "silver" | "bronze";
  team: { code: string; name: string; flag_emoji: string };
  ordinal: "1ST" | "2ND" | "3RD";
  cup: string;
}) {
  const ariaLabel =
    rank === "gold"
      ? `Champion ${team.name}`
      : rank === "silver"
        ? `Runner-up ${team.name}`
        : `Third place ${team.name}`;
  return (
    <div
      className="vt-share-podium-hero-tile"
      data-rank={rank}
      data-testid={`share-podium-tile-${rank}`}
      aria-label={ariaLabel}
    >
      <span className="vt-share-podium-hero-cup" aria-hidden>
        {cup}
      </span>
      <span className="vt-share-podium-hero-flag" aria-hidden>
        {team.flag_emoji}
      </span>
      <span className="vt-share-podium-hero-code">{team.code}</span>
      <span className="vt-share-podium-hero-pill">{ordinal}</span>
      <span className="vt-share-podium-hero-name">{team.name}</span>
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

      <PrizePoolBlock syndicate={syndicate} />

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

// ── Prize-pool block (shared by syndicate landing) ─────────────────

function formatMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-NZ", {
      style: "currency",
      currency,
      minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    }).format(dollars);
  } catch {
    return `${currency} ${dollars.toFixed(2)}`;
  }
}

function ordinal(rank: number): string {
  const v = rank % 100;
  if (v >= 11 && v <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

function PrizePoolBlock({ syndicate }: { syndicate: SyndicateRecord }) {
  const fee = syndicate.entry_fee_cents ?? 0;
  const currency = syndicate.entry_fee_currency ?? "NZD";
  const split = syndicate.prize_split ?? null;
  const bonus = syndicate.bonus_prize_text?.trim() || null;
  const prizeText = syndicate.prize_text?.trim() || null;

  // Nothing configured → don't render at all. The owner is still in free
  // tier with no fee, no split, no bonus, no prize copy.
  if (fee <= 0 && (!split || split.length === 0) && !bonus && !prizeText) {
    return null;
  }

  const memberCount = Math.max(1, syndicate.members.length);
  const pool = fee > 0 ? fee * memberCount : 0;

  return (
    <section className="vt-share-prize" aria-labelledby="vt-share-prize-title">
      <h2 id="vt-share-prize-title" className="vt-share-syn-section-title">
        Prize pool
      </h2>
      <div className="vt-share-prize-grid">
        {fee > 0 && (
          <div className="vt-share-prize-fee">
            <span className="vt-share-prize-fee-label">Entry fee</span>
            <span className="vt-share-prize-fee-value">
              {formatMoney(fee, currency)}
            </span>
            <span className="vt-share-prize-fee-note">
              per member · pool {formatMoney(pool, currency)} at{" "}
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {split && split.length > 0 && (
          <ol className="vt-share-prize-split" aria-label="Prize split">
            {[...split]
              .sort((a, b) => a.rank - b.rank)
              .map((row) => {
                const share = fee > 0 ? (pool * row.percent) / 100 : 0;
                return (
                  <li className="vt-share-prize-row" key={`${row.rank}-${row.label ?? ""}`}>
                    <span className="vt-share-prize-rank">
                      {row.label?.trim() ? row.label : ordinal(row.rank)}
                    </span>
                    <span className="vt-share-prize-pct">
                      {Math.round(row.percent * 10) / 10}%
                    </span>
                    {fee > 0 && (
                      <span className="vt-share-prize-amount">
                        {formatMoney(share, currency)}
                      </span>
                    )}
                  </li>
                );
              })}
          </ol>
        )}
      </div>
      {prizeText && !split && (
        <p className="vt-share-prize-copy">{prizeText}</p>
      )}
      {bonus && (
        <p className="vt-share-prize-bonus">
          <span className="vt-share-prize-bonus-label">Bonus prize</span>
          <span className="vt-share-prize-bonus-text">{bonus}</span>
        </p>
      )}
      <p className="vt-share-prize-fineprint">
        Tournamental doesn&apos;t handle the money. {fee > 0 ? "The host collects entry fees and pays out the pool." : "Bragging rights only."}
      </p>
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
