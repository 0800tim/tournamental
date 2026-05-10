/**
 * Home feed — the first thing a user sees when landing on the PWA.
 *
 * Composition (top to bottom):
 *   - CountdownBanner pinned to the FIFA WC 2026 kickoff.
 *   - StoriesStrip: featured matches and pundits (mocked for v0.1).
 *   - HeroCard: "Watch the AR-FR 2022 final" — tappable, opens the
 *     replay route.
 *   - "Up next" section: 5 MatchCards (mocked schedule).
 *   - "From the desk" section: 2 NewsCards.
 *
 * Wrapped in `<AppShell>` so the chrome (top app-bar, bottom nav on
 * mobile, side rail on desktop) renders consistently.
 */

import { AppShell } from "@/components/shell";
import { NewsStrip } from "@/components/home/NewsStrip";
import {
  CountdownBanner,
  HeroCard,
  MatchCard,
  NewsCard,
  StoriesStrip,
} from "@/components/ui";

const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";
// FIFA World Cup 2026 official kickoff (Mexico City, 11 June 2026 18:00 UTC-6).
const WC_2026_KICKOFF_UTC = "2026-06-11T18:00:00-06:00";

export default function HomePage() {
  return (
    <AppShell title="Tournamental" avatarInitials="V">
      <div className="vt-page-content">
        <CountdownBanner
          targetUtc={WC_2026_KICKOFF_UTC}
          eyebrow="FIFA World Cup 2026"
          title="Kickoff: Mexico vs the world"
        />

        <StoriesStrip
          items={[
            { id: "watch-arfr", label: "AR-FR 22", initials: "AR", progress: true, href: `/match/${DEMO_MATCH_ID}` },
            { id: "bracket", label: "Build bracket", initials: "B", href: "/world-cup-2026" },
            { id: "leaderboard", label: "Top picks", initials: "L", href: "/leaderboard" },
            { id: "team-arg", label: "Argentina", initials: "AR", href: "/team/ARG" },
            { id: "team-fra", label: "France", initials: "FR", href: "/team/FRA" },
            { id: "team-bra", label: "Brazil", initials: "BR", href: "/team/BRA" },
            { id: "team-eng", label: "England", initials: "EN", href: "/team/ENG" },
          ]}
        />

        <HeroCard
          title="Watch the AR-FR 2022 final, in 3D"
          category="Replay"
          subtitle="The full Argentina v France final, ball-by-ball, in our 3D renderer. 15 minutes at 10x speed."
          href={`/match/${DEMO_MATCH_ID}`}
        />

        <NewsStrip />

        <section className="vt-section">
          <h2 className="vt-section-title">Up next</h2>
          <div className="vt-fixture-list">
            {SAMPLE_FIXTURES.map((f) => (
              <MatchCard
                key={f.id}
                home={{ code: f.home.code, name: f.home.name }}
                away={{ code: f.away.code, name: f.away.name }}
                state="pre"
                kickoffUtc={f.kickoffUtc}
                groupId={f.groupId}
                stage={f.stage}
                venue={f.venue}
                href={`/world-cup-2026#match-${f.id}`}
              />
            ))}
          </div>
        </section>

        <section className="vt-section">
          <h2 className="vt-section-title">From the desk</h2>
          <div className="vt-news-list">
            <NewsCard
              category="Tournamental lab"
              title="How the cascade engine scores long-shots"
              meta="3 min read"
              href="/blog/cascade-scoring"
            />
            <NewsCard
              category="Open source"
              title="The renderer ships under Apache 2.0"
              meta="5 min read"
              href="/blog/open-source-renderer"
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

/** Mocked fixtures for the home feed. Replaced with the live schedule
 *  once the game-service is wired (per docs/12). */
const SAMPLE_FIXTURES = [
  {
    id: "wc26-m01",
    groupId: "A",
    stage: "Group stage",
    home: { code: "MEX", name: "Mexico" },
    away: { code: "CAN", name: "Canada" },
    kickoffUtc: "2026-06-11T18:00:00-06:00",
    venue: "Estadio Azteca, Mexico City",
  },
  {
    id: "wc26-m02",
    groupId: "B",
    stage: "Group stage",
    home: { code: "USA", name: "United States" },
    away: { code: "JPN", name: "Japan" },
    kickoffUtc: "2026-06-12T17:00:00-04:00",
    venue: "MetLife Stadium, New York",
  },
  {
    id: "wc26-m03",
    groupId: "C",
    stage: "Group stage",
    home: { code: "ARG", name: "Argentina" },
    away: { code: "MEX", name: "Mexico" },
    kickoffUtc: "2026-06-15T18:00:00-06:00",
    venue: "Estadio Azteca, Mexico City",
  },
  {
    id: "wc26-m04",
    groupId: "D",
    stage: "Group stage",
    home: { code: "FRA", name: "France" },
    away: { code: "CRO", name: "Croatia" },
    kickoffUtc: "2026-06-16T20:00:00-04:00",
    venue: "AT&T Stadium, Dallas",
  },
  {
    id: "wc26-m05",
    groupId: "E",
    stage: "Group stage",
    home: { code: "BRA", name: "Brazil" },
    away: { code: "ENG", name: "England" },
    kickoffUtc: "2026-06-17T15:00:00-04:00",
    venue: "SoFi Stadium, Los Angeles",
  },
] as const;
