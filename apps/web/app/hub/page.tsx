/**
 * play.tournamental.com hub.
 *
 * Rendered at `/` on the play host whenever the tournament registry
 * has no ACTIVE tournament (middleware.ts rewrites `/` to `/hub`).
 * Three jobs:
 *   1. What's next: the upcoming tournament hero + register interest.
 *   2. Previous tournaments: one card per archived tournament.
 *   3. Hand the play host back to the next active tournament with no
 *      page changes (flip status in lib/tournaments/registry.ts).
 *
 * Brief: docs/briefs/2026-10-15-archive-fwc2026-and-rwc2027-index.md.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppShell } from "@/components/shell";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { CountdownBanner } from "@/components/ui";
import {
  archivedTournaments,
  upcomingTournament,
} from "@/lib/tournaments/registry";

import { RegisterInterestForm } from "./RegisterInterestForm";
import "./hub.css";

export const dynamic = "force-dynamic";

const HUB_OG = "/rwc2027/og.png";

export const metadata: Metadata = {
  title: "Tournamental · Rugby World Cup 2027™ is next. Register your interest.",
  description:
    "Rugby World Cup 2027™ in Australia, 1 October to 13 November 2027. Register interest for the Tournamental prediction game: every match, pools for your club or office, leaderboards and verifiable picks. Browse the FIFA World Cup 2026™ archive.",
  openGraph: {
    title: "Rugby World Cup 2027™ is next on Tournamental",
    description:
      "Register interest and be first in when picks open. Every match, pools for your crew, verifiable picks.",
    images: [{ url: HUB_OG, width: 1200, height: 630, alt: "Rugby World Cup 2027 on Tournamental" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rugby World Cup 2027™ is next on Tournamental",
    description: "Register interest and be first in when picks open.",
    images: [HUB_OG],
  },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function HubPage(): Promise<JSX.Element> {
  const next = upcomingTournament();
  const archives = archivedTournaments();
  const h = await headers();
  const cfCountry = (h.get("cf-ipcountry") ?? "").toUpperCase();
  const defaultCountry = /^[A-Z]{2}$/.test(cfCountry) && cfCountry !== "XX" ? cfCountry : null;
  const inviteBase = (
    process.env.NEXT_PUBLIC_INVITE_BASE_URL ||
    process.env.NEXT_PUBLIC_PLAY_ORIGIN ||
    "https://play.tournamental.com"
  ).replace(/\/+$/, "");

  return (
    <AppShell title="Tournamental" showBottomNav={false}>
      <main className="vt-hub">
        {next ? (
          <section className="vt-hub-hero" id="next">
            <div className="vt-hub-hero-art">
              <img
                src="/rwc2027/hero.svg"
                alt="Original illustration: a gold and green rugby ball under the Southern Cross with goal posts on a night pitch"
                width={1200}
                height={800}
                decoding="async"
                fetchPriority="high"
              />
            </div>
            <div className="vt-hub-hero-copy">
              <p className="vt-hub-dateline">Coming next on Tournamental</p>
              <h1 className="vt-hub-headline">
                <span className="vt-hub-headline-line">{next.name}</span>
                <span className="vt-hub-headline-line vt-hub-headline-sub">{next.hostCountry}</span>
              </h1>
              <p className="vt-hub-lede">
                {fmtDate(next.startsUtc)} to {fmtDate(next.endsUtc)}. {next.teams} teams, {next.matches} matches,
                {" "}{next.hostCities?.length ?? 0} host cities. Predict every match, run a pool for your club,
                office or audience, and climb a leaderboard that settles on a public ledger.
              </p>
              <ul className="vt-hub-stat-row" aria-label="Tournament facts">
                <li><span className="vt-hub-stat-num">{next.teams}</span><span className="vt-hub-stat-label">Teams</span></li>
                <li><span className="vt-hub-stat-num">{next.matches}</span><span className="vt-hub-stat-label">Matches</span></li>
                <li><span className="vt-hub-stat-num">{next.hostCities?.length ?? 0}</span><span className="vt-hub-stat-label">Host cities</span></li>
                <li><span className="vt-hub-stat-num">6</span><span className="vt-hub-stat-label">Weeks</span></li>
              </ul>
              <CountdownBanner
                targetUtc={next.startsUtc}
                eyebrow="Kickoff"
                title="Opening match, Perth, 1 October 2027"
                pastLabel="Kicked off"
                compact
              />
            </div>
          </section>
        ) : null}

        {next ? (
          <RevealOnScroll as="section" className="vt-hub-section vt-hub-register" id="register">
            <div className="vt-hub-register-copy">
              <p className="vt-hub-step-tag">What you get</p>
              <h2 className="vt-hub-h2">Every match. Your crew. A record that proves it.</h2>
              <ul className="vt-hub-bullets">
                <li><strong>Predictions for all {next.matches} matches.</strong> Save early, change any pick until that match kicks off.</li>
                <li><strong>Pools for any crew.</strong> Rugby clubs, offices, creator audiences and group chats, each with a branded page and leaderboard.</li>
                <li><strong>Verifiable picks.</strong> Every pick is timestamped and committed to a public ledger before kickoff.</li>
                <li><strong>Invite friends, earn entries.</strong> Your personal link lands them in your pool and counts toward the launch prize draw (draft terms, coming soon).</li>
              </ul>
            </div>
            <RegisterInterestForm
              tournamentName={next.name}
              defaultCountry={defaultCountry}
              inviteBase={inviteBase}
            />
          </RevealOnScroll>
        ) : null}

        <RevealOnScroll as="section" className="vt-hub-section" id="archive">
          <p className="vt-hub-step-tag">Previous tournaments</p>
          <h2 className="vt-hub-h2">The archive.</h2>
          <p className="vt-hub-p">
            Every tournament we run is kept as it finished: the final result, the final boards and every
            settled match, read-only.
          </p>
          <ul className="vt-hub-archive-grid">
            {archives.map((t) => (
              <li key={t.id} className="vt-hub-archive-card">
                <p className="vt-hub-dateline">
                  {fmtDate(t.startsUtc)} to {fmtDate(t.endsUtc)} · Archived
                </p>
                <h3 className="vt-hub-archive-name">{t.name}</h3>
                {t.winner ? (
                  <p className="vt-hub-archive-result">
                    <strong>{t.winner.name}</strong>, champions. {t.finalScoreline}.
                  </p>
                ) : null}
                {t.stats ? (
                  <ul className="vt-hub-archive-stats" aria-label="How it played">
                    {t.stats.slice(0, 3).map((s) => (
                      <li key={s.label}>
                        <span className="vt-hub-stat-num">{s.value}</span>
                        <span className="vt-hub-stat-label">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <a
                  className="vt-hub-btn vt-hub-btn-ghost"
                  href={`https://${t.archiveHost ?? "play.tournamental.com"}/`}
                >
                  Open the {t.shortName} archive →
                </a>
              </li>
            ))}
          </ul>
        </RevealOnScroll>

        <RevealOnScroll as="section" className="vt-hub-section vt-hub-platform">
          <p className="vt-hub-step-tag">The platform</p>
          <h2 className="vt-hub-h2">We game-ify the tournament.</h2>
          <div className="vt-hub-feature-grid">
            <div className="vt-hub-feature"><h3>Predict</h3><p>Every match is its own call. No lock at the first whistle.</p></div>
            <div className="vt-hub-feature"><h3>Pool</h3><p>A branded pool at your own link, with an embed widget for any site.</p></div>
            <div className="vt-hub-feature"><h3>Climb</h3><p>Global, country and pool leaderboards that settle as results land.</p></div>
            <div className="vt-hub-feature"><h3>Prove it</h3><p>Picks on a public ledger. When you say you called it, the record agrees.</p></div>
          </div>
          <p className="vt-hub-p">
            Open source under Apache 2.0. <a className="vt-hub-link" href="https://tournamental.com/how-it-works">How it works</a> ·{" "}
            <a className="vt-hub-link" href="https://github.com/0800tim/tournamental">GitHub</a>
          </p>
        </RevealOnScroll>

        {next ? (
          <p className="vt-hub-disclaimer">{next.trademarkLine}</p>
        ) : null}
      </main>
    </AppShell>
  );
}
