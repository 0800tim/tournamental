/**
 * /watch, landing for the watch-along feature. Lists upcoming and
 * available replays. The replays-page shape comes online once the
 * stream-server (agent C, doc 03) ships; for now this is a stub.
 */

import Link from "next/link";

import { AppShell } from "@/components/shell";
import { HeroCard, MatchCard } from "@/components/ui";

export const metadata = {
  title: "Watch - Tournamental",
};

const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

export default function WatchPage() {
  return (
    <AppShell title="Watch">
      <div className="vt-page-content">
        <HeroCard
          title="AR-FR 2022 final, replayed in 3D"
          category="Featured replay"
          subtitle="Argentina v France, 18 December 2022. The full match in our 3D renderer."
          href={`/match/${DEMO_MATCH_ID}`}
        />
        <section className="vt-section">
          <h2 className="vt-section-title">More replays coming</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            We are wiring up the World Cup 2026 live producer next. Live
            watch-along plus rewinds will land here as soon as the
            stream-server is online.
          </p>
          <div className="vt-fixture-list">
            <MatchCard
              home={{ code: "ARG", name: "Argentina", score: 3 }}
              away={{ code: "FRA", name: "France", score: 3 }}
              state="final"
              kickoffUtc="2022-12-18T15:00:00Z"
              stage="World Cup Final 2022"
              venue="Lusail Iconic Stadium"
              href={`/match/${DEMO_MATCH_ID}`}
            />
          </div>
          <Link
            href="/world-cup-2026"
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: 999,
              border: "1px solid var(--vt-border-strong)",
              background: "transparent",
              color: "var(--vt-fg)",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Predict the next live match
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
