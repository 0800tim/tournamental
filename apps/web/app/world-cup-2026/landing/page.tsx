/**
 * /world-cup-2026/landing, the WC 2026 hype/marketing landing page.
 *
 * This is the host-aware apex for `play.tournamental.com` and
 * `play.tournamental.com` (rewritten from `/` in `apps/web/middleware.ts`). It
 * does NOT replace `/world-cup-2026` (the bracket builder), that route is
 * still the destination of every "Play the bracket game" CTA.
 *
 * Architecture: server component shell (deterministic SSR for instant
 * paint, low LCP) with client islands for the countdown, group drawer,
 * leaderboards tabs, syndicate form, and ICS download.
 *
 * Cache policy: this is marketing-flavoured and identical for every
 * unauthenticated visitor, `Cache-Control: public, s-maxage=300,
 * stale-while-revalidate=86400` (5-min edge cache + 24h SWR), per the
 * standing rule in CLAUDE.md.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { Countdown } from "./_components/Countdown";
import { HeroFlagGrid } from "./_components/HeroFlagGrid";
import { TeamGroupGrid } from "./_components/TeamGroupGrid";
import { HowItWorks } from "./_components/HowItWorks";
import { WhyDifferent } from "./_components/WhyDifferent";
import { SyndicateSignup } from "./_components/SyndicateSignup";
import { LeaderboardPreview } from "./_components/LeaderboardPreview";
import { UpcomingMatches } from "./_components/UpcomingMatches";
import { GroupCharts } from "./_components/GroupCharts";
import { OpenSourceCallout } from "./_components/OpenSourceCallout";
import { DataPlaceholder } from "./_components/DataPlaceholder";
import { countdownTo, TOURNAMENT_KICKOFF_UTC } from "./_lib/countdown";
import "./landing.css";

export const dynamic = "force-static";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Tournamental, 33 days until the world predicts the World Cup.",
  description:
    "Tournamental is the prediction game for the 2026 FIFA World Cup. Free to play. Save your bracket now and tweak it match by match, earlier-saved picks score bigger, and you can change any pick until that match kicks off. 48 teams, 104 matches, one open-source bracket.",
  openGraph: {
    title: "Tournamental, FIFA World Cup 2026 prediction game",
    description:
      "Save your bracket. Change any pick until that match kicks off. Earlier-saved long-shots earn the most.",
    url: "https://play.tournamental.com/",
    siteName: "Tournamental",
    type: "website",
    images: [
      {
        url: "/og/bracket/default.png",
        width: 1200,
        height: 630,
        alt: "Tournamental, predict the 2026 World Cup",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tournamental, FIFA World Cup 2026 prediction game",
    description:
      "Save your bracket. Change any pick until that match kicks off. Earlier-saved long-shots earn the most.",
    images: ["/og/bracket/default.png"],
  },
};

const FIFA_TO_CF_COUNTRY: Record<string, string> = {
  AR: "ARG", AU: "AUS", AT: "AUT", BE: "BEL", BR: "BRA", CA: "CAN",
  CH: "SUI", CL: "CHI", CO: "COL", CR: "CRC", DE: "GER", DZ: "ALG",
  EC: "ECU", EG: "EGY", ES: "ESP", FR: "FRA", GB: "ENG", GH: "GHA",
  HR: "CRO", HT: "HAI", IR: "IRN", IQ: "IRQ", JO: "JOR", JP: "JPN",
  KR: "KOR", MA: "MAR", MX: "MEX", NL: "NED", NO: "NOR", NZ: "NZL",
  PA: "PAN", PT: "POR", PY: "PAR", QA: "QAT", SA: "KSA", SE: "SWE",
  SN: "SEN", TN: "TUN", TR: "TUR", UY: "URU", US: "USA", UZ: "UZB",
  ZA: "RSA",
};

function deriveCountry(): string {
  // Cloudflare sets `cf-ipcountry`; the tunnel forwards it through.
  const h = headers();
  const cf = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? "";
  return FIFA_TO_CF_COUNTRY[cf.toUpperCase()] ?? "NZL";
}

export default function LandingPage() {
  const initialCountdown = countdownTo(TOURNAMENT_KICKOFF_UTC);
  const country = deriveCountry();

  // Marquee day count for the headline. Pluralisation friendly.
  const days = initialCountdown.days;

  return (
    <main className="wc-page">
      {/* ---------- HERO ---------- */}
      <section className="wc-hero" aria-labelledby="wc-hero-h1">
        <HeroFlagGrid />
        <div className="wc-hero-inner">
          <span className="wc-hero-pulse">2026 FIFA World Cup &middot; June 11 kickoff</span>
          <h1 id="wc-hero-h1">
            <em>{days}</em> {days === 1 ? "day" : "days"} until the world
            <br />
            predicts the World Cup.
          </h1>
          <p className="wc-hero-sub">
            Tournamental is the open-source prediction game for the 2026 FIFA
            World Cup. Free to play, free to syndicate, free to share.
            Save your bracket now and tweak it match by match, the
            earlier your saved pick, the bigger the multiplier. You can
            change any pick right up until that match kicks off.
          </p>
          <Countdown initial={initialCountdown} />
          <div className="wc-cta-row">
            <Link className="wc-btn wc-btn-primary" href="/world-cup-2026">
              Play the bracket game →
            </Link>
            <a className="wc-btn wc-btn-ghost" href="#how-it-works">
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* ---------- LIVE PREVIEW ---------- */}
      <section className="wc-section" aria-labelledby="wc-dashboard-h2">
        <span className="wc-eyebrow">Right now</span>
        <h2 id="wc-dashboard-h2">0 brackets saved. Be first.</h2>
        <p className="wc-lede">
          Every market tick, every saved pick, every country leaderboard
          flows into the live tournament dashboard the moment a match
          kicks off. Here&apos;s a peek.
        </p>
        <div className="wc-dashboard-preview">
          <div className="wc-card">
            <h3>Picks saved, last 24h</h3>
            <Sparkline />
            <p
              style={{
                color: "var(--wc-text-dim)",
                fontSize: 12,
                margin: "8px 0 0",
              }}
            >
              <DataPlaceholder>preview</DataPlaceholder> Goes live the
              moment the first user saves a pick.
            </p>
          </div>
          <div className="wc-card">
            <h3>Tournament-winner odds</h3>
            <div className="wc-stat-row">
              <span className="wc-stat-name">Argentina</span>
              <span className="wc-stat-value">
                <DataPlaceholder>-</DataPlaceholder>
              </span>
            </div>
            <div className="wc-stat-row">
              <span className="wc-stat-name">France</span>
              <span className="wc-stat-value">
                <DataPlaceholder>-</DataPlaceholder>
              </span>
            </div>
            <div className="wc-stat-row">
              <span className="wc-stat-name">Brazil</span>
              <span className="wc-stat-value">
                <DataPlaceholder>-</DataPlaceholder>
              </span>
            </div>
            <div className="wc-stat-row">
              <span className="wc-stat-name">England</span>
              <span className="wc-stat-value">
                <DataPlaceholder>-</DataPlaceholder>
              </span>
            </div>
            <p
              style={{
                color: "var(--wc-text-dim)",
                fontSize: 12,
                margin: "12px 0 0",
              }}
            >
              Powered by Polymarket, wires up before kickoff.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- ALL 48 TEAMS ---------- */}
      <section className="wc-section" aria-labelledby="wc-teams-h2">
        <span className="wc-eyebrow">12 groups · 48 teams</span>
        <h2 id="wc-teams-h2">Every nation, every group.</h2>
        <p className="wc-lede">
          The Final Draw is in. Click any team for kit colours, FIFA
          rank, first three fixtures, and live tournament-winner odds.
        </p>
        <TeamGroupGrid />
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section className="wc-section" id="how-it-works" aria-labelledby="wc-hiw-h2">
        <span className="wc-eyebrow">How it works</span>
        <h2 id="wc-hiw-h2">Three steps. Free forever.</h2>
        <HowItWorks />
      </section>

      {/* ---------- WHY DIFFERENT ---------- */}
      <section className="wc-section" id="why-different" aria-labelledby="wc-why-h2">
        <span className="wc-eyebrow">Why a new bracket game</span>
        <h2 id="wc-why-h2">Every other bracket game locks you in at first kickoff.</h2>
        <p className="wc-lede">
          We don&apos;t. We also ship the 3D watch-along, on-chain
          prediction receipts, and a contributor revenue split, none of
          which the household-name products do.
        </p>
        <WhyDifferent />
      </section>

      {/* ---------- SYNDICATES ---------- */}
      <section className="wc-section" aria-labelledby="wc-syn-h2">
        <span className="wc-eyebrow">Pre-launch signups</span>
        <h2 id="wc-syn-h2">Run a syndicate. Friends, office, public.</h2>
        <p className="wc-lede">
          Reserve your syndicate name now and we&apos;ll email you an
          invite link before kickoff so you can rally everyone. Free until
          launch (and free after, if you keep it small).
        </p>
        <SyndicateSignup defaultCountry={country} />
      </section>

      {/* ---------- LEADERBOARDS ---------- */}
      <section className="wc-section" aria-labelledby="wc-lb-h2">
        <span className="wc-eyebrow">Leaderboards</span>
        <h2 id="wc-lb-h2">Climb the boards. Globally, locally, or in your pool.</h2>
        <p className="wc-lede">
          Compete against the world, your country, your friends, or your
          affiliate cohort. Every saved pick is verifiable on the
          VStamp ledger.
        </p>
        <LeaderboardPreview />
      </section>

      {/* ---------- UPCOMING MATCHES ---------- */}
      <section className="wc-section" aria-labelledby="wc-up-h2">
        <span className="wc-eyebrow">Matchday 1</span>
        <h2 id="wc-up-h2">First 12 kickoffs.</h2>
        <p className="wc-lede">
          Group stage opens June 11 with Mexico vs South Africa at the
          Estadio Azteca. All times shown in your local timezone.
        </p>
        <UpcomingMatches />
      </section>

      {/* ---------- CHARTS ---------- */}
      <section className="wc-section" aria-labelledby="wc-charts-h2">
        <span className="wc-eyebrow">Group winner probability</span>
        <h2 id="wc-charts-h2">Where the smart money is, today.</h2>
        <p className="wc-lede">
          Per-group winner probability, derived from FIFA rank for now,
          and re-derived daily from Polymarket once the integration ships.
        </p>
        <GroupCharts />
      </section>

      {/* ---------- OSS CALLOUT ---------- */}
      <section className="wc-section" aria-labelledby="wc-oss-h2">
        <OpenSourceCallout />
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="wc-footer">
        <div className="wc-footer-inner">
          <div>
            <h5>Tournamental</h5>
            <p style={{ margin: 0, maxWidth: "44ch" }}>
              The open-source prediction game and 3D watch-along for global
              football tournaments. Built in public, owned by VTorn
              Holdings, distributed via Drips.
            </p>
          </div>
          <div>
            <h5>Play</h5>
            <ul>
              <li><Link href="/world-cup-2026">Bracket builder</Link></li>
              <li><Link href="/match/fifa-wc-2022-final-arg-fra-2022-12-18">2022 final demo</Link></li>
              <li><a href="https://github.com/0800tim/tournamental" target="_blank" rel="noreferrer">GitHub</a></li>
            </ul>
          </div>
          <div>
            <h5>Legal &amp; safer-play</h5>
            <ul>
              <li>Free-to-play prediction game</li>
              <li>Affiliate disclosure: surfaces market data from Polymarket and stream subscriptions from local broadcasters.</li>
              <li>Adult content / responsible-gaming notes apply per jurisdiction.</li>
              <li>Apache 2.0, code; CC-BY 4.0, docs.</li>
            </ul>
          </div>
        </div>
      </footer>
    </main>
  );
}

/**
 * Tiny inline sparkline. Mock data for now, labelled via the parent
 * `<DataPlaceholder>`. Drawn in pure SVG; no chart library.
 */
function Sparkline() {
  const points = [3, 5, 4, 6, 7, 9, 8, 11, 14, 12, 18, 22, 26, 31, 38];
  const w = 280;
  const h = 80;
  const max = Math.max(...points);
  const step = w / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (p / max) * (h - 6) - 2).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="wc-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wc-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(251,191,36,0.4)" />
          <stop offset="100%" stopColor="rgba(251,191,36,0)" />
        </linearGradient>
      </defs>
      <path
        d={`${path} L ${w} ${h} L 0 ${h} Z`}
        fill="url(#wc-spark-fill)"
      />
      <path d={path} fill="none" stroke="#fbbf24" strokeWidth="2" />
    </svg>
  );
}
