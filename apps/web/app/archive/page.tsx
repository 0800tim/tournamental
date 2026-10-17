/**
 * Archive home for an archived tournament (fwc2026.tournamental.com/).
 *
 * Middleware rewrites `/` on an archive host to this page and stamps
 * `x-tnm-archive: <slug>`. Everything here is read-only: the final
 * result, the podium, how the tournament played (percentages only, per
 * Tim 2026-10-15: no real player numbers), the final standings as
 * ranks and percent-correct, the knockout results, and links into the
 * rest of the archived app. No sign-up, no save, no join.
 */

import type { Metadata } from "next";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { AppShell } from "@/components/shell";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { archiveSlug } from "@/lib/archive/server";
import { loadFinalStandings, loadKnockoutResults } from "@/lib/archive/final-standings";
import { knockoutLinkLabel, knockoutScoreText } from "@/lib/archive/labels";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import { tournamentBySlug, upcomingTournament } from "@/lib/tournaments/registry";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import "./archive.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FIFA World Cup 2026™ archive · Tournamental",
  description:
    "The FIFA World Cup 2026™ on Tournamental, kept as it finished: Spain beat Argentina 1-0 after extra time in the final. Final standings, every settled match and the bracket, read-only.",
  openGraph: {
    title: "FIFA World Cup 2026™ archive · Tournamental",
    description: "Spain, champions. The final standings and every settled match, kept read-only.",
    images: [{ url: "/og/bracket/default.png", width: 1200, height: 630, alt: "Tournamental FWC 2026 archive" }],
    type: "website",
  },
};

const STAGE_LABEL: Record<string, string> = {
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  tp: "Third place",
  f: "Final",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ArchiveHomePage(): Promise<JSX.Element> {
  const slug = (await archiveSlug()) ?? "fwc2026";
  const t = tournamentBySlug(slug) ?? tournamentBySlug("fwc2026")!;
  const next = upcomingTournament();

  const base = loadFixtures2026();
  const tournament = enrichTournamentTeams(base, canonicalTeamsRaw as CanonicalTeamsFile);
  const teamName = (code: string | null): string =>
    (code && tournament.teams.find((x) => x.id === code)?.name) || code || "TBD";
  const flagOf = (code: string | null): string => {
    const raw = (canonicalTeamsRaw as { teams: Array<{ code: string; flag_emoji: string }> }).teams;
    return raw.find((x) => x.code === code)?.flag_emoji ?? "";
  };

  const standings = loadFinalStandings(t.id, t.matches ?? 104, 10);
  const knockouts = loadKnockoutResults(t.id);
  const byStage = new Map<string, typeof knockouts>();
  for (const k of knockouts) {
    const list = byStage.get(k.stage) ?? [];
    list.push(k);
    byStage.set(k.stage, list);
  }
  const stageOrder = ["f", "tp", "sf", "qf", "r16"];

  return (
    <AppShell title={t.shortName}>
      <main className="vt-arc">
        <section className="vt-arc-hero">
          <p className="vt-arc-dateline">
            {fmtDate(t.startsUtc)} to {fmtDate(t.endsUtc)} · {t.hostCountry} · Archived
          </p>
          <h1 className="vt-arc-headline">
            <span className="vt-arc-headline-line">{t.name}</span>
            {t.winner ? (
              <span className="vt-arc-headline-line vt-arc-headline-sub">
                {flagOf(t.winner.code)} {t.winner.name}, champions.
              </span>
            ) : null}
          </h1>
          {t.finalScoreline ? (
            <p className="vt-arc-lede">
              Final: {t.finalScoreline}. {t.third ? `${t.third.name} took third place.` : ""} Every one of the {t.matches} matches settled on the Tournamental ledger. This archive is the read-only record of how it played.
            </p>
          ) : null}
          {t.winner && t.runnerUp && t.third ? (
            <ol className="vt-arc-podium" aria-label="Podium">
              <li className="vt-arc-podium-2"><span className="vt-arc-podium-rank">2</span><span className="vt-arc-podium-flag">{flagOf(t.runnerUp.code)}</span><span className="vt-arc-podium-name">{t.runnerUp.name}</span></li>
              <li className="vt-arc-podium-1"><span className="vt-arc-podium-rank">1</span><span className="vt-arc-podium-flag">{flagOf(t.winner.code)}</span><span className="vt-arc-podium-name">{t.winner.name}</span></li>
              <li className="vt-arc-podium-3"><span className="vt-arc-podium-rank">3</span><span className="vt-arc-podium-flag">{flagOf(t.third.code)}</span><span className="vt-arc-podium-name">{t.third.name}</span></li>
            </ol>
          ) : null}
          <nav className="vt-arc-actions" aria-label="Explore the archive">
            <a className="vt-arc-btn vt-arc-btn-primary" href="/world-cup-2026/calendar">All 104 results</a>
            <a className="vt-arc-btn vt-arc-btn-ghost" href="/world-cup-2026">The bracket</a>
            <a className="vt-arc-btn vt-arc-btn-ghost" href="/players">Players</a>
            <a className="vt-arc-btn vt-arc-btn-ghost" href="/bot-arena">Bot Arena</a>
          </nav>
        </section>

        {t.stats ? (
          <RevealOnScroll as="section" className="vt-arc-section">
            <p className="vt-arc-step-tag">How it played</p>
            <h2 className="vt-arc-h2">High engagement, first whistle to final.</h2>
            <p className="vt-arc-p">
              Players kept saving and changing picks every week of the tournament, most of them inside a pool with
              friends, an office or a creator audience. The numbers below are shares of the people who played.
            </p>
            <ul className="vt-arc-stats" aria-label="Engagement, as percentages">
              {t.stats.map((s) => (
                <li key={s.label}>
                  <span className="vt-arc-stat-num">{s.value}</span>
                  <span className="vt-arc-stat-label">{s.label}</span>
                  {s.note ? <span className="vt-arc-stat-note">{s.note}</span> : null}
                </li>
              ))}
            </ul>
          </RevealOnScroll>
        ) : null}

        {standings.length > 0 ? (
          <RevealOnScroll as="section" className="vt-arc-section" id="standings">
            <p className="vt-arc-step-tag">Final standings</p>
            <h2 className="vt-arc-h2">The global top ten.</h2>
            <p className="vt-arc-p">Ranked by points on the ledger. Percent is the share of the {t.matches} matches each bracket called correctly.</p>
            <ol className="vt-arc-standings" aria-label="Final global standings">
              {standings.map((r) => (
                <li key={r.rank} className="vt-arc-standing" data-rank={r.rank}>
                  <span className="vt-arc-standing-rank">{r.rank}</span>
                  <span className="vt-arc-standing-name">{r.name}</span>
                  <span className="vt-arc-standing-pct">{r.percentCorrect}% correct</span>
                  <span className="vt-arc-standing-pts">{r.points.toLocaleString("en-NZ")} pts</span>
                </li>
              ))}
            </ol>
          </RevealOnScroll>
        ) : null}

        {knockouts.length > 0 ? (
          <RevealOnScroll as="section" className="vt-arc-section" id="results">
            <p className="vt-arc-step-tag">Road to the final</p>
            <h2 className="vt-arc-h2">Knockout results.</h2>
            <div className="vt-arc-ko">
              {stageOrder.filter((s) => byStage.has(s)).map((s) => (
                <div key={s} className="vt-arc-ko-stage">
                  <h3 className="vt-arc-ko-stage-head">{STAGE_LABEL[s] ?? s}</h3>
                  <ul className="vt-arc-ko-list">
                    {(byStage.get(s) ?? []).map((k) => (
                      <li key={k.matchId} className="vt-arc-ko-match">
                        <span className="vt-arc-ko-winner"><span aria-hidden="true">{flagOf(k.winner)}</span> {teamName(k.winner)}</span>
                        <span className="vt-arc-ko-score">{knockoutScoreText(k)}</span>
                        <a
                          className="vt-arc-ko-link"
                          href={`/match/${encodeURIComponent(k.matchId)}`}
                          aria-label={knockoutLinkLabel(STAGE_LABEL[s] ?? s, teamName(k.winner), k)}
                        >
                          Match
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="vt-arc-note">Winners shown with the final score. Open the calendar for every match, including the group stage.</p>
          </RevealOnScroll>
        ) : null}

        {next ? (
          <RevealOnScroll as="section" className="vt-arc-section vt-arc-next">
            <p className="vt-arc-step-tag">What&apos;s next</p>
            <h2 className="vt-arc-h2">{next.name} in {next.hostCountry}.</h2>
            <p className="vt-arc-p">
              {fmtDate(next.startsUtc)} to {fmtDate(next.endsUtc)}. Register your interest now and be first in when picks open.
            </p>
            <a className="vt-arc-btn vt-arc-btn-primary" href="https://play.tournamental.com/#register">Register interest →</a>
          </RevealOnScroll>
        ) : null}

        <p className="vt-arc-disclaimer">{t.trademarkLine}</p>
      </main>
    </AppShell>
  );
}
