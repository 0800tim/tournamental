/**
 * /odds, the maths of going 104-for-104 on the 2026 FIFA World Cup.
 *
 * Specific to this tournament cycle (FIFA WC 2026), so it lives under
 * play.tournamental.com rather than the platform marketing site at
 * tournamental.com. Linked from the home-page hero lede ("the
 * astronomical odds of getting all 104 matches right") and from the
 * launch-campaign post templates in tournamental-business/.
 *
 * Cache policy: marketing-flavoured + identical for every visitor.
 * `public, s-maxage=300, stale-while-revalidate=86400` per the
 * standing CLAUDE.md rule.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import "./odds.css";

export const dynamic = "force-static";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "The odds of a perfect bracket, Tournamental",
  description:
    "Even the best predictor on Earth won't go 104-for-104 on the FIFA World Cup 2026. The maths, the cascade penalty that kills lock-everything-upfront games, and why the update-at-kickoff mechanic isn't a UX choice but the whole skill ceiling.",
};

export default function OddsPage(): JSX.Element {
  return (
    <AppShell title="The odds">
      <article className="vt-odds">
        <header className="vt-odds-hero">
          <p className="vt-odds-eyebrow">The maths</p>
          <h1 className="vt-odds-title">
            Nobody will pick all 104 matches of the World Cup correctly. Ever.
          </h1>
          <p className="vt-odds-lede">
            The compounding kills you, the coin-flip matches set a floor that
            information can&apos;t crack, and the lock-everything-upfront games
            are mathematically broken before the first whistle. Here&apos;s the
            working.
          </p>
        </header>

        <section className="vt-odds-section">
          <h2>The headline number</h2>
          <p>
            Picking the winner of every match in the 2026 FIFA World Cup&trade;,
            all 104 matches, group stage through final, by pure random guess
            sits at roughly <strong>1 in 10<sup>44</sup></strong>. That&apos;s
            a one followed by forty-four zeroes. The lottery, six consecutive
            draws, twice over.
          </p>
          <p>
            Most articles stop there because the number is impressive. But
            pure-random isn&apos;t how anyone actually plays. The realistic
            numbers are far more interesting.
          </p>
        </section>

        <section className="vt-odds-section">
          <h2>The realistic odds, by predictor quality</h2>
          <p>
            A skilled human lands around 55% on group-stage matches (three
            outcomes: win, lose, draw) and around 65% on knockouts (two
            outcomes). Updating picks just before kickoff bumps both by about
            5 percentage points. That gives you this:
          </p>

          <div className="vt-odds-table-wrap">
            <table className="vt-odds-table">
              <thead>
                <tr>
                  <th>Predictor</th>
                  <th>Group accuracy</th>
                  <th>KO accuracy</th>
                  <th>Odds of going 104-for-104</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Random guess</td>
                  <td>33%</td>
                  <td>50%</td>
                  <td>1 in 10<sup>44</sup></td>
                </tr>
                <tr>
                  <td>Bookmaker-grade skill, picks locked at first kickoff</td>
                  <td>55%</td>
                  <td>65%</td>
                  <td>1 in 10<sup>25</sup></td>
                </tr>
                <tr className="vt-odds-row-highlight">
                  <td>
                    <strong>Update picks at kickoff, skilled</strong>
                  </td>
                  <td>
                    <strong>60%</strong>
                  </td>
                  <td>
                    <strong>70%</strong>
                  </td>
                  <td>
                    <strong>
                      1 in 10<sup>21</sup>
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td>Elite, last-minute info, perfect lineups</td>
                  <td>65%</td>
                  <td>75%</td>
                  <td>1 in 10<sup>18</sup></td>
                </tr>
                <tr>
                  <td>Theoretical ceiling</td>
                  <td>70%</td>
                  <td>80%</td>
                  <td>1 in 10<sup>15</sup></td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            The best-case theoretical number is still{" "}
            <strong>
              1 in 10<sup>15</sup>
            </strong>
            . There are about 7.5 &times; 10<sup>18</sup> grains of sand on
            Earth. You&apos;d need that many predictors, each playing a
            perfect tournament, to expect one perfect bracket per cycle. We
            will have, at most, around ten million players.
          </p>
        </section>

        <section className="vt-odds-section">
          <h2>Why &ldquo;update at kickoff&rdquo; matters more than you&apos;d think</h2>
          <p>
            The familiar bracket games (Telegraph Predictor, ESPN Bracket
            Challenge, Yahoo Tournament Pick&apos;em) make you lock every
            prediction in <em>before</em> the first match. That model has a
            second penalty most players don&apos;t realise exists.
          </p>
          <p>
            When you lock everything upfront, you&apos;re not just predicting
            <em> outcomes</em>. You&apos;re predicting outcomes <em>conditional on
              matchups that don&apos;t exist yet</em>. A typical lock-upfront
            bracket commits something like:
          </p>
          <blockquote className="vt-odds-blockquote">
            &ldquo;Germany top Group E &rarr; meet the runner-up of Group F in
            the R16 &rarr; face the winner of the Group A vs Group D bracket in
            the QF...&rdquo;
          </blockquote>
          <p>
            If Germany finish <em>second</em> in Group E because a single
            group game went the other way, every downstream knockout prediction
            is now structurally wrong. Even if you correctly called
            &ldquo;Germany beat their R16 opponent&rdquo;, Germany&apos;s R16
            opponent isn&apos;t who you thought it would be. A single missed
            group result can invalidate a sub-tree of up to fifteen downstream
            picks.
          </p>
          <p>Plug that cascade into the maths and the picture changes:</p>

          <div className="vt-odds-table-wrap">
            <table className="vt-odds-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Group (of 72)</th>
                  <th>KO (of 32)</th>
                  <th>Expected total</th>
                  <th>Realistic best-case</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lock everything upfront, skilled</td>
                  <td>~40</td>
                  <td>~3</td>
                  <td>
                    <strong>~43 / 104</strong>
                  </td>
                  <td>~55 with luck</td>
                </tr>
                <tr className="vt-odds-row-highlight">
                  <td>Update at kickoff, skilled</td>
                  <td>~43</td>
                  <td>~22</td>
                  <td>
                    <strong>~65 / 104</strong>
                  </td>
                  <td>~75 with luck</td>
                </tr>
                <tr>
                  <td>Elite, late info</td>
                  <td>~46</td>
                  <td>~24</td>
                  <td>
                    <strong>~70 / 104</strong>
                  </td>
                  <td>~80 with luck</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            The mechanic that lets you update every pick until the moment the
            ref blows the whistle isn&apos;t a UX choice. It&apos;s a{" "}
            <strong>22-match swing</strong>. A fifth of the entire tournament
            hangs on the difference between &ldquo;lock at first kickoff&rdquo;
            and &ldquo;update at kickoff&rdquo;.
          </p>
        </section>

        <section className="vt-odds-section">
          <h2>The coin-flip floor</h2>
          <p>
            The reason perfect brackets stay impossible even with last-minute
            lineup news, late injury intel, weather, and tactical leaks is what
            we call the <em>coin-flip floor</em>. World Cup matches fall into
            three buckets:
          </p>

          <div className="vt-odds-table-wrap">
            <table className="vt-odds-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Approx count at WC 2026</th>
                  <th>Even elite accuracy</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lopsided fixtures (Brazil v Cape Verde, Argentina v Jordan)</td>
                  <td>~40</td>
                  <td>85 to 90%</td>
                </tr>
                <tr>
                  <td>Moderate gap (Germany v Switzerland, France v Senegal)</td>
                  <td>~40</td>
                  <td>65 to 70%</td>
                </tr>
                <tr className="vt-odds-row-highlight">
                  <td>
                    <strong>
                      Genuine coin-flips (two evenly-matched sides, penalties
                      on the table)
                    </strong>
                  </td>
                  <td>
                    <strong>~24</strong>
                  </td>
                  <td>
                    <strong>~50%</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            You can be the best predictor on Earth and the coin-flip matches
            will still go against you half the time.{" "}
            <strong>
              Information doesn&apos;t help when the underlying outcome is
              random.
            </strong>{" "}
            The 2022 World Cup served up six such results in a single
            tournament: Argentina v Saudi Arabia, Japan v Germany, Cameroon v
            Brazil, Croatia past Brazil on penalties, Argentina past
            Netherlands on penalties, Morocco past Spain on penalties. Five
            group-stage upsets and a knockout-round set that defied every form
            line. Six matches, multiplying any perfect-bracket attempt by 200x
            or more against the player.
          </p>
        </section>

        <section className="vt-odds-section">
          <h2>So what <em>is</em> the game?</h2>
          <p>
            Forget 104-for-104.{" "}
            <strong>
              What&apos;s the maximum reasonable score, and how do you separate
              from the pack?
            </strong>
          </p>
          <p>
            A skilled predictor updating at kickoff scores around 65 of 104 in
            expectation. A casual fan locking in early scores around 43. The
            leaderboard separation isn&apos;t between &ldquo;perfect&rdquo; and
            &ldquo;imperfect&rdquo;, it&apos;s between players who do the work
            and update their picks against late information, and players who
            set-and-forget.
          </p>
          <p>
            That gap is twelve to twenty matches. Across a six-week tournament,
            twelve matches is the difference between winning your pool and
            finishing mid-pack. It&apos;s also the reason you&apos;ll find
            yourself opening Tournamental three times a day during the
            tournament: every kickoff is a fresh opportunity to lock in or
            revise. Setting picks at the start and waiting six weeks is a
            strictly inferior strategy, and the leaderboard exposes it
            ruthlessly.
          </p>
        </section>

        <section className="vt-odds-section">
          <h2>The line, compressed</h2>
          <blockquote className="vt-odds-blockquote vt-odds-blockquote-pull">
            You&apos;ll never go 104-for-104. The race is to be{" "}
            <strong>
              the one who goes 75 of 104 when everyone else goes 63
            </strong>
            . Update every pick until the whistle. Or hand the deck to your
            cat. The maths is the same either way, and the leaderboard treats
            every prediction equally.
          </blockquote>
        </section>

        <section className="vt-odds-section">
          <h2>Why this is good news</h2>
          <p>The impossibility is the feature. Three things follow:</p>
          <ol className="vt-odds-list">
            <li>
              <strong>The leaderboard stays competitive for six weeks.</strong>{" "}
              The top 1% will miss 25 to 35 matches; the gap between #1 and
              #1000 is rarely more than five correct picks of variance, which
              means the leader can be overtaken on any match-day.
            </li>
            <li>
              <strong>Every kickoff is a decision point.</strong> Update or
              hold? Lock in the safer pick or back the underdog? Every match
              feels like a small commitment, not a single bracket form filled
              out a month ago and then forgotten.
            </li>
            <li>
              <strong>Anyone can play.</strong> A six-month-old picking with a
              deck of three cards isn&apos;t materially worse off than a
              tactician with FotMob and Opta open. The maths is brutal at the
              ceiling and forgiving at the floor. Hand the picks to your cat;
              the cryptographic ledger signs every choice before kickoff and
              the leaderboard treats the cats and the analysts the same.
            </li>
          </ol>
          <p>
            Tournamental is the only major tournament prediction game built
            around this design. The lock-it-in-upfront games are an artefact of
            newsprint deadlines from the 1990s. We threw that out and rebuilt
            for the way people actually consume sport in 2026: three checks a
            day on a phone, every match a fresh chance to be right or wrong.
          </p>
        </section>

        <div className="vt-odds-cta-row">
          <Link href="/world-cup-2026" className="vt-odds-btn vt-odds-btn-primary">
            Set my picks &rarr;
          </Link>
          <Link href="/syndicates" className="vt-odds-btn vt-odds-btn-ghost">
            Run a pool
          </Link>
        </div>

        <p className="vt-odds-disclaimer">
          Tournamental is independent and not affiliated with FIFA, the FIFA
          World Cup, or any of its sponsors. FIFA World Cup 2026&trade; is a
          trademark of F&eacute;d&eacute;ration Internationale de Football
          Association.
        </p>
      </article>
    </AppShell>
  );
}
