/**
 * /next-stage-r32, the "group stage closing" explainer on the play app.
 *
 * Tells players what happens to their bracket when the group stage ends:
 * forecast Round of 32 matchups switch to the real qualifiers, the best
 * third-placed teams are resolved for them automatically, and their
 * home/away picks are preserved on the slot so nothing is lost. The one
 * ask: come back and review the Round of 32 before it kicks off.
 *
 * Matches the dark + gold editorial language used by /the-bet (Fraunces
 * display, JetBrains Mono eyebrow, hero scrim). Screenshot figures fall
 * back to a styled panel until the real images are dropped into
 * public/next-stage-r32/.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import "./next-stage-r32.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Group stage closing: your Round of 32 goes live · Tournamental",
  description:
    "When the group stage finishes this weekend, your forecast Round of 32 switches to the real matchups. The best third-placed teams are filled in for you. Your win picks are saved. Come back and check them before kickoff.",
  robots: { index: true, follow: true },
};

export default function NextStageR32Page(): JSX.Element {
  return (
    <AppShell title="Round of 32">
      <main className="vt-r32">
        <article className="vt-r32-article">
          {/* ============== HERO ============== */}
          <header className="vt-r32-hero">
            <div className="vt-r32-hero-bg" aria-hidden="true" />
            <div className="vt-r32-hero-scrim" aria-hidden="true" />
            <div className="vt-r32-hero-content">
              <p className="vt-r32-eyebrow">Group stage closing · Round of 32</p>
              <h1 className="vt-r32-title">
                Your Round of 32 is about to get <em>real</em>.
              </h1>
              <p className="vt-r32-lede">
                We have cleared every knockout matchup back to <em>TBD</em> and
                started filling in the <em>real</em> teams as each group
                finishes. The one thing that stays is your home or away pick.
                Here is exactly what happens, and what to do now.
              </p>
              <div className="vt-r32-hero-cta-row">
                <Link href="/world-cup-2026#r32" className="vt-r32-cta">
                  Open my Round of 32 <span aria-hidden="true">→</span>
                </Link>
                <Link
                  href="/world-cup-2026/calendar"
                  className="vt-r32-cta vt-r32-cta--ghost"
                >
                  See the schedule <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </header>

          {/* ============== TL;DR ============== */}
          <section className="vt-r32-tldr" aria-label="In short">
            <div className="vt-r32-tldr-item">
              <span className="vt-r32-tldr-num">01</span>
              <p>
                Every knockout matchup is now <strong>TBD</strong>. Real teams
                drop in automatically as each group finishes, so you only ever
                see actual teams, never a guess.
              </p>
            </div>
            <div className="vt-r32-tldr-item">
              <span className="vt-r32-tldr-num">02</span>
              <p>
                Your home or away pick is <strong>saved</strong> on every match.
                It is the one thing that persists when the teams change.
              </p>
            </div>
            <div className="vt-r32-tldr-item">
              <span className="vt-r32-tldr-num">03</span>
              <p>
                We will call you back when the group stage closes to check
                everything. Until then you can already confirm the{" "}
                <strong>matches that are set</strong> (73, 74, 75 …) before they
                kick off.
              </p>
            </div>
          </section>

          {/* ============== WHAT CHANGES ============== */}
          <section className="vt-r32-section">
            <p className="vt-r32-kicker">What changes</p>
            <h2 className="vt-r32-h2">
              Cleared to TBD, then filled with the <em>real</em> teams.
            </h2>
            <p className="vt-r32-p">
              We have reset every knockout matchup to TBD, so no forecast teams
              are shown anywhere. As each group finishes, its real winner and
              runner-up drop straight into the matches that use them. Take Round
              of 32 Match 73: the runner-up of Group A against the runner-up of
              Group B. Both groups are now played, so it already shows the two
              real teams, with your home or away pick still on it. Anything not
              yet known stays TBD.
            </p>

            <figure className="vt-r32-compare">
              {/* BEFORE: cleared to TBD until the groups close */}
              <div className="vt-r32-card vt-r32-card--forecast">
                <p className="vt-r32-card-tag">Before the groups close</p>
                <p className="vt-r32-card-match">Round of 32 · Match 73</p>
                <div className="vt-r32-slot">
                  <span className="vt-r32-slot-code">Runner-up, Group A</span>
                  <span className="vt-r32-slot-team">TBD</span>
                </div>
                <div className="vt-r32-slot vt-r32-slot--vs">v</div>
                <div className="vt-r32-slot">
                  <span className="vt-r32-slot-code">Runner-up, Group B</span>
                  <span className="vt-r32-slot-team">TBD</span>
                </div>
                <p className="vt-r32-card-pick">
                  Your call: <strong>HOME WIN</strong>{" "}
                  <span className="vt-r32-saved">saved</span>
                </p>
              </div>

              <div className="vt-r32-compare-arrow" aria-hidden="true">
                →
              </div>

              {/* AFTER: the real bracket */}
              <div className="vt-r32-card vt-r32-card--actual">
                <p className="vt-r32-card-tag">When both groups close</p>
                <p className="vt-r32-card-match">Round of 32 · Match 73</p>
                <div className="vt-r32-slot">
                  <span className="vt-r32-slot-code">Runner-up, Group A</span>
                  <span className="vt-r32-slot-team vt-r32-slot-team--real">
                    real team ✓
                  </span>
                </div>
                <div className="vt-r32-slot vt-r32-slot--vs">v</div>
                <div className="vt-r32-slot">
                  <span className="vt-r32-slot-code">Runner-up, Group B</span>
                  <span className="vt-r32-slot-team vt-r32-slot-team--real">
                    real team ✓
                  </span>
                </div>
                <p className="vt-r32-card-pick">
                  Your call: <strong>HOME WIN</strong>{" "}
                  <span className="vt-r32-saved">saved</span>
                </p>
              </div>
            </figure>
            <figcaption className="vt-r32-compare-cap">
              The match slot stays the same, so your win pick stays put. Only the
              teams in it change, filled in automatically from the real results
              as each group closes.
            </figcaption>
          </section>

          {/* ============== THIRD PLACE ============== */}
          <section className="vt-r32-section">
            <div className="vt-r32-callout">
              <p className="vt-r32-callout-head">
                Nothing to do about the best third-placed teams.
              </p>
              <p className="vt-r32-p">
                In the 48-team format, 8 of the 12 third-placed teams go through.
                Working out which 8, and which Round of 32 match each one drops
                into, is done automatically from the real results. There is
                nothing here for you to select.
              </p>
              <p className="vt-r32-p">
                It also sets the timing. A match between two group winners or
                runners-up, like Match 73, locks the moment both of its groups
                finish. A match that includes a best third-placed team can only
                be confirmed once <strong>every</strong> group has been played,
                so those stay marked TBC until the group stage is completely
                done. When your bracket updates, each slot is already filled with
                the right team.
              </p>
            </div>
          </section>

          {/* ============== PICKS ARE SAFE ============== */}
          <section className="vt-r32-section">
            <p className="vt-r32-kicker">Your predictions</p>
            <h2 className="vt-r32-h2">
              Only your <em>home or away</em> pick carries over.
            </h2>
            <p className="vt-r32-p">
              Every pick is stored against the match slot, not the team. So when
              we cleared the forecast teams back to TBD, your home or away
              selection stayed exactly as you set it. That is the one and only
              thing that persists.
            </p>
            <p className="vt-r32-p">
              When the group stage closes we will call you back to check every
              result. In the meantime, open the matches that are already set and
              confirm your pick against the real teams before they kick off,
              starting with Match 73, 74 and 75.
            </p>
          </section>

          {/* ============== TIMELINE ============== */}
          <section className="vt-r32-section">
            <p className="vt-r32-kicker">What happens, and when</p>
            <ol className="vt-r32-timeline">
              <li className="vt-r32-step">
                <span className="vt-r32-step-when">Now, as groups finish</span>
                <p>
                  Each group&apos;s real winner and runner-up drop into their
                  matches the moment that group ends. You can confirm any match
                  that is already set.
                </p>
              </li>
              <li className="vt-r32-step">
                <span className="vt-r32-step-when">After the last group</span>
                <p>
                  The best third-placed teams are resolved, and every Round of 32
                  match is confirmed with its real teams.
                </p>
              </li>
              <li className="vt-r32-step">
                <span className="vt-r32-step-when">Straight after</span>
                <p>
                  We message you by email, WhatsApp and SMS the moment your real
                  Round of 32 is ready.
                </p>
              </li>
              <li className="vt-r32-step">
                <span className="vt-r32-step-when">Before kickoff</span>
                <p>
                  Review and adjust your picks. Each one locks when its match
                  kicks off.
                </p>
              </li>
            </ol>
          </section>

          {/* ============== SCREENSHOT ============== */}
          <figure className="vt-r32-shot">
            <div className="vt-r32-shot-img" aria-hidden="true" />
            <figcaption className="vt-r32-shot-cap">
              Your live Round of 32. Confirmed teams appear as their groups
              finish; everything still to be decided stays TBD until it is
              known.
            </figcaption>
          </figure>

          {/* ============== LEADERBOARD REALITY ============== */}
          <section className="vt-r32-section">
            <p className="vt-r32-kicker">The leaderboard right now</p>
            <h2 className="vt-r32-h2">
              Auto-pick got people surprisingly far. Only <em>one</em> human
              has beaten it.
            </h2>
            <div className="vt-r32-stats">
              <div className="vt-r32-stat">
                <span className="vt-r32-stat-num">44</span>
                <span className="vt-r32-stat-lab">top human, out of 62</span>
              </div>
              <div className="vt-r32-stat">
                <span className="vt-r32-stat-num">43</span>
                <span className="vt-r32-stat-lab">
                  the auto-pick-and-forget pack
                </span>
              </div>
              <div className="vt-r32-stat">
                <span className="vt-r32-stat-num">1</span>
                <span className="vt-r32-stat-lab">
                  human ahead of doing nothing
                </span>
              </div>
            </div>
            <p className="vt-r32-p">
              A whole pack of players auto-picked their bracket, walked away,
              and are sitting on 43 out of 62. In a lot of pools, that is
              enough to be near the top.
            </p>
            <p className="vt-r32-p">
              Just one human has done better. John is out in front on 44, a
              single point clear of every set-and-forget bracket. Well played,
              John.
            </p>
            <p className="vt-r32-p">
              Here is the catch: the knockouts reset everything. From the Round
              of 32 your bracket switches to the real teams, and the upsets only
              get bigger. Auto-pick can still carry you, but only if you run it
              again before each round kicks off. This is your chance to leave the
              auto-pickers behind.
            </p>
          </section>

          {/* ============== FINAL CTA ============== */}
          <section className="vt-r32-final">
            <h2 className="vt-r32-final-head">
              Set once, then come back and make it real.
            </h2>
            <div className="vt-r32-cta-row">
              <Link href="/world-cup-2026#r32" className="vt-r32-cta">
                Open my Round of 32 <span aria-hidden="true">→</span>
              </Link>
              <Link
                href="/world-cup-2026/calendar"
                className="vt-r32-cta vt-r32-cta--ghost"
              >
                See the schedule <span aria-hidden="true">→</span>
              </Link>
            </div>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
