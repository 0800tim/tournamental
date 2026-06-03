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
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/shell";

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
// Aliased to avoid colliding with the route-level `export const dynamic`
// (Next.js segment-config flag) further down.
import nextDynamic from "next/dynamic";

import { ShareActions } from "@/components/share-landing/ShareActions";

// Tim 2026-06-04: every heavy client component on this page loads
// via `nextDynamic({ ssr: false })`. The first pass wrapped only
// `ReadOnlyBracket` to fix the webpack `options.factory` runtime
// error on /s/<handle> landings; Tim then hit the same crash on
// /s/mollytournamentaloracle with the molecule rendering, which
// confirmed the chunk-split bug affects every large client component
// on this page, not just one. Isolating each in its own client chunk
// after hydration sidesteps it without changing the components.
const ReadOnlyBracket = nextDynamic(
  () =>
    import("@/components/share-landing/ReadOnlyBracket").then(
      (mod) => mod.ReadOnlyBracket,
    ),
  { ssr: false, loading: () => null },
);
const ShareMoleculeEmbed = nextDynamic(
  () =>
    import("@/components/share-landing/ShareMoleculeEmbed").then(
      (mod) => mod.ShareMoleculeEmbed,
    ),
  { ssr: false, loading: () => null },
);
const JoinSyndicate = nextDynamic(
  () =>
    import("@/components/share-landing/JoinSyndicate").then(
      (mod) => mod.JoinSyndicate,
    ),
  { ssr: false, loading: () => null },
);
const SyndicateLeaderboardRows = nextDynamic(
  () =>
    import("@/components/share-landing/SyndicateLeaderboardRows").then(
      (mod) => mod.SyndicateLeaderboardRows,
    ),
  { ssr: false, loading: () => null },
);
const BracketPosterCallout = nextDynamic(
  () =>
    import("@/components/share-landing/BracketPosterCallout").then(
      (mod) => mod.BracketPosterCallout,
    ),
  { ssr: false, loading: () => null },
);
const ShareBracketButton = nextDynamic(
  () =>
    import("@/components/share-landing/ShareBracketButton").then(
      (mod) => mod.ShareBracketButton,
    ),
  { ssr: false, loading: () => null },
);
import { resolveShareGuid } from "@/lib/share/resolve-guid";
import type { BracketByGuid } from "@/lib/bracket/by-guid";
import type { SyndicateRecord } from "@/lib/syndicate/store";
import { enrichSyndicateMembers } from "@/lib/syndicate/enrich-members";
import { DEFAULT_AVATAR_DATA_URI } from "@/lib/profile/avatar";
import { slugifyDisplayName } from "@/lib/share/handle-slug";

import "@/components/share-landing/share-landing.css";

// 60-second edge revalidation mirrors the upstream game-service's
// `s-maxage=60`. Re-shares (the common case, one tweet -> thousands of
// clicks) hit the CDN; the bracket owner's re-saves bust the cache
// inside a minute.
// Force dynamic so the locale resolves per request. The page was
// revalidate=60 before i18n, but a single cached HTML can't serve
// 22 locales -- per-locale cache keys would multiply the cache by
// 22x for little gain.
export const dynamic = "force-dynamic";

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
  if (resolved.kind === "user_no_bracket") {
    const name = resolved.displayName?.trim() || `@${resolved.handle}`;
    return {
      title: `${name} hasn't shared a bracket yet, Tournamental`,
      description: `${name} hasn't locked in their World Cup picks yet. Build your own bracket in 60 seconds.`,
    };
  }
  if (resolved.kind === "user") {
    const b = resolved.bracket;
    // Pass champion + runner-up + third codes so the OG renderer paints
    // the actual predicted podium in social previews. Without these, the
    // unfurl falls back to a generic football glyph (Tim 2026-05-24).
    const ogParams = new URLSearchParams({
      bracket_id: b.bracket_id,
      handle: b.handle,
      winner: b.champion.code,
      runner_up: b.runner_up.code,
      third: b.third_place.code,
    });
    if (b.avatar_url) ogParams.set("avatar", b.avatar_url);
    const ogUrl = `/api/og/bracket?${ogParams.toString()}`;
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

  if (resolved.kind === "user_no_bracket") {
    return (
      <AppShell title="Tournamental">
        <UserNoBracketView
          handle={resolved.handle}
          displayName={resolved.displayName}
        />
      </AppShell>
    );
  }

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
        {await SyndicateLanding({ syndicate: resolved.syndicate })}
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
  const {
    handle,
    display_name,
    avatar_url,
    user_id,
    champion,
    runner_up,
    third_place,
    path_to_gold,
    tournament_label,
    saved_at,
  } = bracket;
  const savedDisplay = formatSavedAt(saved_at);

  return (
    <section className="vt-share vt-share-user" data-testid="share-user-landing">
      <header className="vt-share-hero vt-share-hero-user">
        {/* Tim 2026-05-14: the owner is the hero of the share landing.
          * Big avatar + handle so creators feel featured when they
          * post these to their audience. */}
        <div className="vt-share-owner" data-testid="share-owner">
          <UserAvatar src={avatar_url} alt={display_name ?? handle} />
          <div className="vt-share-owner-text">
            <span className="vt-share-owner-handle">
              {display_name ? display_name : `@${handle}`}
            </span>
            {display_name ? (
              <span className="vt-share-owner-sub">@{handle}</span>
            ) : null}
            <span className="vt-share-hero-eyebrow">{tournament_label}</span>
          </div>
          <ShareBracketButton
            ownerUserId={user_id}
            handle={handle}
            championName={champion.name}
            tournamentLabel={tournament_label}
          />
        </div>
        <h1 className="vt-share-hero-title">
          <span className="vt-share-flag" aria-hidden>
            {champion.flag_emoji}
          </span>
          <span>{champion.name}</span>
        </h1>
        <p className="vt-share-hero-subhead">
          picked {champion.name} to lift the trophy
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
        <ShareMoleculeEmbed
          bracket={bracket.payload}
          championCode={champion.code}
        />
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

      {/* Read-only full bracket. Tim 2026-06-03: under the molecule +
        * path-to-gold summary, show every match the owner predicted as
        * a static view (group stage + thirds + R32 -> Final). The
        * "Manage my bracket" CTA at the top only renders when the
        * viewer is the bracket owner (useUser() === bracket.user_id);
        * everyone else just sees the read-only view. */}
      {bracket.payload ? (
        <ReadOnlyBracket
          bracket={bracket.payload}
          ownerUserId={bracket.user_id}
          ownerHandle={handle}
        />
      ) : null}

      {/* Bracket poster CTA. Tim 2026-06-01: every shared bracket is by
        * definition fully saved (104 picks), so this surface always shows
        * the download button. The /api/og/bracket-poster route renders
        * a 2400×3600 light-theme A3 print-quality PNG keyed by
        * bracket_id; the thumbnail uses the same URL via the browser's
        * native image scaling. Clicking "Download" opens the full-res
        * PNG in a new tab where the user can right-click → save. */}
      <BracketPosterCallout
        bracketId={bracket.bracket_id}
        handle={handle}
        championName={champion.name}
      />

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
/**
 * Big circular avatar for the share-landing hero. Falls back to a
 * neutral silhouette when the owner hasn't uploaded one (so we never
 * flash a broken-image icon when a stranger lands here).
 */
function UserAvatar({ src, alt }: { src: string | null; alt: string }) {
  return (
    <span className="vt-share-owner-avatar" data-has-image={src ? "1" : "0"}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} width={96} height={96} loading="eager" />
      ) : (
        <svg
          viewBox="0 0 96 96"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="vt-avatar-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#26314a" />
              <stop offset="1" stopColor="#0f1422" />
            </linearGradient>
          </defs>
          <rect width="96" height="96" rx="48" fill="url(#vt-avatar-grad)" />
          <circle cx="48" cy="38" r="14" fill="#94a3b8" opacity="0.6" />
          <path
            d="M16 88c4-18 18-26 32-26s28 8 32 26z"
            fill="#94a3b8"
            opacity="0.55"
          />
        </svg>
      )}
    </span>
  );
}

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

async function SyndicateLanding({ syndicate }: { syndicate: SyndicateRecord }) {
  const [
    leaderboardEyebrow, standings, leaderboardEmpty,
    joinFootnote, recentMembersEyebrow, thePool,
    prizeEyebrow,
  ] = await Promise.all([
    safeT("share_landing.syndicate.leaderboard_dateline", "Leaderboard top 5"),
    safeT("share_landing.syndicate.leaderboard_title", "Standings"),
    safeT("share_landing.syndicate.leaderboard_empty", "Leaderboard activates at kickoff, first match Mexico vs the world, 11 Jun 2026."),
    safeT("syndicate.join_footnote", "Free to play, change picks until kickoff."),
    safeT("share_landing.syndicate.members_dateline", "Pool members"),
    safeT("share_landing.syndicate.members_title", "The pool"),
    safeT("share_landing.syndicate.prize_dateline", "Prize pool"),
  ]);
  // Tim 2026-06-02: enrich each member with avatar + display_name +
  // predicted-winner + favourite-team + ISO-2 country so the pool-
  // members section can show a real flag (priority chain: predicted
  // winner > favourite team > country of origin) and a real profile
  // photo. Inline so the page stays one DB round-trip away from a
  // cold render.
  const enrichedMembers = enrichSyndicateMembers({
    members: syndicate.members,
    tournamentId: syndicate.tournament_id,
  });
  const topFive = [...enrichedMembers]
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  const allPointsZero = topFive.every((m) => m.points === 0);
  // "Recent members" is now "Pool members" (Tim 2026-06-02). Sorted by
  // joined_at descending so the most recent joiner heads the grid.
  const poolMembers = [...enrichedMembers]
    .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
    .slice(0, 12);
  const memberCount = syndicate.members.length;
  const sponsor = syndicate.sponsor ?? null;
  const sponsorPresent =
    !!sponsor && (!!sponsor.name?.trim() || !!sponsor.logo_url?.trim());

  // Tim 2026-05-21 (editorial rebuild). The dateline is the tournament
  // label upper-cased + the owner handle, sat in a single mono line
  // above the headline (matches docs/BRAND.md section 3 "dateline"
  // pattern). Tournament label is kept lower-noise here; the headline
  // does the heavy lifting.
  const datelineTournament = syndicate.tournament_label.toUpperCase();

  // Lede priority: pool owner's own description (the `topic` field set
  // at creation) wins when present. Otherwise fall back to the
  // auto-generated stats line so empty / legacy pools don't show a
  // blank space (Tim 2026-05-22).
  const ownerLede = (syndicate.topic ?? "").trim();
  const lede =
    ownerLede ||
    buildSyndicateLede({
      ownerHandle: syndicate.owner_handle,
      memberCount,
      picksMade: syndicate.picks_made,
      tournamentLabel: syndicate.tournament_label,
    });

  // Facebook-style page header: banner image as the tinted background,
  // logo chip + pool name overlaid. Only renders when at least one of
  // logo / hero is present so unbranded pools fall back to the plain
  // editorial header (Tim 2026-05-22, see ref screenshot).
  const heroUrl = syndicate.branding?.hero_url ?? null;
  const logoUrl = syndicate.branding?.logo_url ?? null;
  const hasBrandedHeader = !!heroUrl || !!logoUrl;

  return (
    <section
      className="vt-share vt-share-syn vt-editorial"
      data-testid="share-syndicate-landing"
    >
      {hasBrandedHeader ? (
        <header
          className="vt-share-syn-pageheader"
          data-has-banner={heroUrl ? "1" : "0"}
          data-has-logo={logoUrl ? "1" : "0"}
        >
          {heroUrl ? (
            <div
              className="vt-share-syn-pageheader-banner"
              role="img"
              aria-label={`${syndicate.name} banner`}
              style={{ backgroundImage: `url(${JSON.stringify(heroUrl).slice(1, -1)})` }}
            />
          ) : null}
          <div className="vt-share-syn-pageheader-scrim" aria-hidden />
          <div className="vt-share-syn-pageheader-row">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="vt-share-syn-pageheader-logo"
                src={logoUrl}
                alt={`${syndicate.name} logo`}
                width={84}
                height={84}
                loading="eager"
              />
            ) : null}
            <div className="vt-share-syn-pageheader-text">
              <p className="vt-dateline vt-share-syn-pageheader-eyebrow">
                <span>{datelineTournament}</span>
                <span aria-hidden className="vt-share-syn-dateline-sep">·</span>
                <span>@{syndicate.owner_handle}</span>
              </p>
              <h1 className="vt-headline vt-share-syn-pageheader-name">
                {syndicate.name}
              </h1>
            </div>
          </div>
          {lede ? (
            <p className="vt-lede vt-share-syn-pageheader-lede">{lede}</p>
          ) : null}
        </header>
      ) : (
        <header className="vt-share-syn-hero">
          <p className="vt-dateline vt-share-syn-dateline">
            <span>{datelineTournament}</span>
            <span aria-hidden className="vt-share-syn-dateline-sep">·</span>
            <span>@{syndicate.owner_handle}</span>
          </p>
          <h1 className="vt-headline vt-share-syn-headline">{syndicate.name}</h1>
          <p className="vt-lede vt-share-syn-lede">{lede}</p>
        </header>
      )}

      {/* The OG preview image used to render inline here, which
       * read as a duplicate hero ("Tournamental" wordmark + member
       * count + sky-blue Free-To-Play badge) sitting directly under
       * the editorial header. The 1200x630 PNG belongs in <meta
       * og:image>, not in the visible body. Removed 2026-05-21. */}

      {/* Owner-authored long-form description. Renders directly under
          the banner, above the prize block. Tim 2026-06-03: split out
          from the old `topic` field so the banner overlay (still
          `topic`) can stay short while this carries the paragraph(s)
          of pool / brand detail. */}
      {syndicate.description_text?.trim() ? (
        <RevealOnScroll as="section" className="vt-share-syn-description">
          <p className="vt-share-syn-description-copy">
            {syndicate.description_text}
          </p>
        </RevealOnScroll>
      ) : null}

      <RevealOnScroll>
        <PrizePoolBlock syndicate={syndicate} prizeEyebrow={prizeEyebrow} />
      </RevealOnScroll>

      <RevealOnScroll
        as="section"
        className="vt-share-syn-section"
        aria-labelledby="vt-share-leaderboard-title"
      >
        <p className="vt-dateline">{leaderboardEyebrow}</p>
        <h2
          id="vt-share-leaderboard-title"
          className="vt-share-syn-section-head"
        >
          {standings}
        </h2>
        {allPointsZero ? (
          <p className="vt-share-leaderboard-empty">
            {leaderboardEmpty}
          </p>
        ) : (
          <SyndicateLeaderboardRows
            rows={topFive.map((m) => ({
              handle: m.handle,
              points: m.points,
              flag_emoji: m.flag_emoji,
            }))}
          />
        )}
      </RevealOnScroll>

      <div className="vt-share-syn-join">
        <JoinSyndicate slug={syndicate.slug} syndicateName={syndicate.name} />
        <p className="vt-footnote vt-share-syn-join-note">
          {joinFootnote}
        </p>
      </div>

      {/* Pool-owner share row. Same competitive-psychology line goes
        * into both the OG image (rendered server-side) and the share
        * text body, so what people see in their inbox / WhatsApp
        * matches what they see on the page (Tim 2026-05-22). */}
      <ShareActions
        shareTitle={`${syndicate.name} on Tournamental`}
        shareText={`Do you think you can predict the outcome of the FIFA World Cup better than I can? Join my pool "${syndicate.name}" and let's find out.`}
      />

      <RevealOnScroll
        as="section"
        className="vt-share-syn-section"
        aria-labelledby="vt-share-members-title"
      >
        <p className="vt-dateline">{recentMembersEyebrow}</p>
        <h2
          id="vt-share-members-title"
          className="vt-share-syn-section-head vt-share-syn-section-head-quiet"
        >
          {thePool}
        </h2>
        <div className="vt-share-members-grid" role="list">
          {poolMembers.map((m) => {
            const label = m.display_name?.trim() || m.handle;
            // Pre-rendered avatar; the route serves a 404 when the
            // user hasn't uploaded one, so we only emit the URL when
            // the enrichment confirmed the file exists on disk -
            // otherwise we fall back to the neutral silhouette.
            const avatarSrc = m.avatar_url ?? DEFAULT_AVATAR_DATA_URI;
            // Resolve a pretty URL that routes to this member's bracket
            // landing.  Tim 2026-06-04: prefer the slugified display
            // name (pretty URL) over the u_<hex> permalink.  Trade-off
            // accepted: a user who renames will break any old shared
            // /s/<oldname> links, but display-name uniqueness is
            // enforced server-side at PATCH /v1/auth/me time so the
            // current-name slug always resolves cleanly.  Permalink
            // form is the fallback for legacy anon joins (no user_id).
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
                <div className="vt-share-member-avatar-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="vt-share-member-avatar"
                    src={avatarSrc}
                    alt=""
                    width={96}
                    height={96}
                    loading="lazy"
                  />
                  <span
                    className="vt-share-member-flag-badge"
                    aria-hidden="true"
                    title={
                      m.predicted_winner_code
                        ? `Predicted winner: ${m.predicted_winner_code}`
                        : m.favourite_team_code
                          ? `Favourite team: ${m.favourite_team_code}`
                          : m.country_iso2
                            ? `From ${m.country_iso2}`
                            : "Country"
                    }
                  >
                    {m.flag_emoji}
                  </span>
                </div>
                <span className="vt-share-member-name">{label}</span>
                {m.display_name && (
                  <span className="vt-share-member-handle">@{m.handle}</span>
                )}
              </>
            );
            return profileHref ? (
              <a
                key={cardKey}
                className="vt-share-member-card vt-share-member-card--link"
                href={profileHref}
                role="listitem"
                aria-label={`View ${label}'s bracket`}
              >
                {inner}
              </a>
            ) : (
              <div
                key={cardKey}
                className="vt-share-member-card"
                role="listitem"
              >
                {inner}
              </div>
            );
          })}
        </div>
      </RevealOnScroll>

      {sponsorPresent ? (
        <SponsorLine sponsor={sponsor!} />
      ) : null}

      <footer className="vt-share-syn-colophon vt-footnote">
        <span>Founded {formatFoundedDate(syndicate.created_at)}</span>
        <span aria-hidden className="vt-share-syn-colophon-sep">·</span>
        <span>play.tournamental.com/s/{syndicate.slug}</span>
      </footer>
    </section>
  );
}

/**
 * Compress the old "hosted by · N members · M picks made" stat triple
 * into one editorial voice line. Cadence rules from docs/BRAND.md §5,
 * short declarative, numerals not words, no superlatives.
 */
function buildSyndicateLede(args: {
  ownerHandle: string;
  memberCount: number;
  picksMade: number;
  tournamentLabel: string;
}): string {
  const { ownerHandle, memberCount, picksMade, tournamentLabel } = args;
  const memberPhrase =
    memberCount === 1
      ? "Just the host so far"
      : memberCount === 2
        ? "Two friends"
        : memberCount === 3
          ? "Three friends"
          : `${memberCount} friends`;
  const tail = picksMade > 0
    ? `${memberPhrase} predicting every match of ${tournamentLabel}.`
    : `${memberPhrase} predicting every match of ${tournamentLabel}, picks open now.`;
  return memberCount === 1
    ? `${memberPhrase}, hosted by @${ownerHandle}. Predicting every match of ${tournamentLabel}.`
    : tail;
}

/**
 * Editorial "Sponsored by" line. NOT a card, NOT a logo wall.
 *
 * Renders as a two-row editorial caption:
 *
 *   ── SPONSORED BY      (gold mono dateline, leading hairline)
 *   [logo] Sponsor Name  (Fraunces italic 500, optional logo)
 *
 * Omitted entirely when both sponsor.name and sponsor.logo_url are
 * empty. The optional sponsor.url wraps the bottom row in an <a>
 * with rel="noopener noreferrer sponsored", so search engines see
 * an honest sponsored-relationship signal and the syndicate owner
 * never inherits the sponsor's reputation by mistake.
 */
function SponsorLine({
  sponsor,
}: {
  sponsor: NonNullable<SyndicateRecord["sponsor"]>;
}) {
  const name = sponsor.name?.trim() ?? "";
  const logo = sponsor.logo_url?.trim() ?? "";
  const url = sponsor.url?.trim() ?? "";

  // The "interactive" row sits below the SPONSORED BY dateline. We
  // render logo + name inside it (whichever the owner provided) so
  // the linkout target is the whole row, not just the text.
  const innerRow = (
    <>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={name ? `${name} logo` : "Sponsor logo"}
          className="vt-share-sponsor-logo"
          loading="lazy"
        />
      ) : null}
      {name ? <span className="vt-share-sponsor-name">{name}</span> : null}
    </>
  );

  return (
    <aside
      className="vt-share-sponsor"
      data-testid="share-sponsor-line"
      aria-label={name ? `Sponsored by ${name}` : "Sponsored"}
    >
      <span className="vt-share-sponsor-label">Sponsored by</span>
      {url ? (
        <a
          className="vt-share-sponsor-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer sponsored"
        >
          {innerRow}
        </a>
      ) : (
        <span className="vt-share-sponsor-link">{innerRow}</span>
      )}
    </aside>
  );
}

/**
 * Shorter colophon date: YYYY-MM-DD only, drops the time-of-day so the
 * footer reads as a quiet imprint stamp rather than a server timestamp.
 */
function formatFoundedDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return iso;
  }
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

function PrizePoolBlock({ syndicate, prizeEyebrow }: { syndicate: SyndicateRecord; prizeEyebrow: string }) {
  const fee = syndicate.entry_fee_cents ?? 0;
  const currency = syndicate.entry_fee_currency ?? "NZD";
  const split = syndicate.prize_split ?? null;
  const bonus = syndicate.bonus_prize_text?.trim() || null;
  const prizeText = syndicate.prize_text?.trim() || null;
  // A free-to-enter pool can still award a (sponsor-funded) prize, so
  // "no entry fee" must not be conflated with "no prize" — the sponsor /
  // store-voucher model depends on exactly that case.
  const hasPrize = Boolean((split && split.length > 0) || bonus || prizeText);

  // Tim 2026-05-24: previously this block hid entirely when there was
  // no fee AND no prize. That made free pools feel half-finished on
  // the public landing -- no signal of who's in or how to compete.
  // Now we always render a minimal "Stake / Members" pair so the
  // public page reads as a real pool even on day-one creation.
  const memberCount = Math.max(1, syndicate.members.length);
  const pool = fee > 0 ? fee * memberCount : 0;

  return (
    <section className="vt-share-prize" aria-labelledby="vt-share-prize-title">
      <p className="vt-dateline">{prizeEyebrow}</p>
      <h2 id="vt-share-prize-title" className="vt-share-syn-section-head">
        {fee > 0 ? "The pot" : hasPrize ? "The prize" : "The pool"}
      </h2>
      <dl className="vt-share-prize-row" aria-label="Prize pool summary">
        {fee > 0 ? (
          <>
            <div className="vt-share-prize-cell">
              <dt className="vt-stat-label">Entry</dt>
              <dd className="vt-share-prize-num">
                {formatMoney(fee, currency)}
              </dd>
            </div>
            <div className="vt-share-prize-cell">
              <dt className="vt-stat-label">Pool</dt>
              <dd className="vt-share-prize-num">
                {formatMoney(pool, currency)}
              </dd>
            </div>
            <div className="vt-share-prize-cell">
              <dt className="vt-stat-label">Members</dt>
              <dd className="vt-share-prize-num">{memberCount}</dd>
            </div>
          </>
        ) : (
          <>
            <div className="vt-share-prize-cell">
              <dt className="vt-stat-label">Stake</dt>
              <dd className="vt-share-prize-num vt-share-prize-num-text">
                {hasPrize ? "Free to enter" : "Bragging rights"}
              </dd>
            </div>
            <div className="vt-share-prize-cell">
              <dt className="vt-stat-label">Members</dt>
              <dd className="vt-share-prize-num">{memberCount}</dd>
            </div>
          </>
        )}
      </dl>

      {split && split.length > 0 ? (
        <ol className="vt-share-prize-split" aria-label="Prize split">
          {[...split]
            .sort((a, b) => a.rank - b.rank)
            .map((row) => {
              const share = fee > 0 ? (pool * row.percent) / 100 : 0;
              return (
                <li
                  className="vt-share-prize-split-row"
                  key={`${row.rank}-${row.label ?? ""}`}
                  data-rank={row.rank}
                >
                  <span className="vt-share-prize-split-rank">
                    {row.label?.trim() ? row.label : ordinal(row.rank)}
                  </span>
                  <span className="vt-share-prize-split-pct">
                    {Math.round(row.percent * 10) / 10}%
                  </span>
                  {fee > 0 && (
                    <span className="vt-share-prize-split-amount">
                      {formatMoney(share, currency)}
                    </span>
                  )}
                </li>
              );
            })}
        </ol>
      ) : null}

      {prizeText ? (
        <div className="vt-share-prize-award">
          <p className="vt-stat-label">Prize</p>
          <PrizeTextLines text={prizeText} />
        </div>
      ) : null}

      {bonus ? (
        <p className="vt-share-prize-bonus">
          <em>Bonus prize, </em>
          {bonus}
        </p>
      ) : null}

      {/* Owner-authored T&Cs. Two separate sources because a pool can
          advertise BOTH paid-entry terms and brand-giveaway terms
          (Tim 2026-06-02):
            - join_fee_terms_text: paid-pool entry / payment terms
            - prize_terms_text:    brand / sponsor prize giveaway T&Cs
          Each rendered with the same compact "Terms" header so the
          two blocks read as a single conditions section on the page. */}
      {syndicate.prize_terms_text?.trim() ? (
        <div className="vt-share-prize-terms">
          <p className="vt-stat-label">Prize terms</p>
          <p className="vt-share-prize-terms-copy">
            {syndicate.prize_terms_text}
          </p>
        </div>
      ) : null}

      {syndicate.join_fee_terms_text?.trim() ? (
        <div className="vt-share-prize-terms">
          <p className="vt-stat-label">Entry terms</p>
          <p className="vt-share-prize-terms-copy">
            {syndicate.join_fee_terms_text}
          </p>
        </div>
      ) : null}

      <p className="vt-share-prize-fineprint">
        Tournamental doesn&apos;t handle any money or prize-promise
        contracts. Pool and syndicate admins must collect any money and
        honour prizes independently.{" "}
        <a className="vt-share-prize-terms-link" href="/terms">
          Read the terms
        </a>
        .
      </p>
    </section>
  );
}

/**
 * Render the owner-supplied free-text prize copy as styled rows that
 * match the prize-split block above. Each line break in the textarea
 * becomes its own row with a hairline divider; the first row is
 * gold-coloured (mirrors the data-rank="1" treatment in the split
 * block). A single-line prize renders as a plain paragraph - no
 * hairlines, no list. Tim 2026-06-02.
 */
function PrizeTextLines({ text }: { text: string }): JSX.Element {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) {
    return <p className="vt-share-prize-copy">{lines[0] ?? text}</p>;
  }
  return (
    <ol className="vt-share-prize-lines" aria-label="Prizes">
      {lines.map((line, idx) => (
        <li
          key={idx}
          className="vt-share-prize-lines-row"
          data-rank={idx + 1}
        >
          {line}
        </li>
      ))}
    </ol>
  );
}

// ── User exists, no saved bracket ──────────────────────────────────

function UserNoBracketView({
  handle,
  displayName,
}: {
  readonly handle: string;
  readonly displayName: string | null;
}) {
  const niceName = displayName?.trim() || `@${handle}`;
  return (
    <section
      className="vt-share vt-share-404"
      data-testid="share-user-no-bracket"
    >
      <div className="vt-share-404-emoji" aria-hidden>
        ⏳
      </div>
      <h1 className="vt-share-404-title">
        {niceName} hasn&apos;t locked in their picks yet
      </h1>
      <p className="vt-share-404-body">
        Their bracket will appear here once they save it. Beat them to it,
        share your own picks first.
      </p>
      <a className="vt-share-cta" data-variant="primary" href="/world-cup-2026">
        Make your bracket
      </a>
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
