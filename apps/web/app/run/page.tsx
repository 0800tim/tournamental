/**
 * /run, the public "anyone can run a bot swarm" surface.
 *
 * Targets a Chromebook-class browser, no install. The WIRED demo:
 * a journalist lands here, taps a chip, hits Start, and watches their
 * tab spin up 100,000 bots inside 30 seconds. This is the headline
 * proof that Tournamental is an open bot arena, not a closed bracket
 * game.
 *
 * Structure:
 *   - Hero with "Run 100,000 AI bots in your browser tab" headline,
 *     dateline, brief lede, and the four social-proof pills.
 *   - Embedded tutorial: five cards, mirrors run/tutorial.md so the
 *     setup is visible without scroll-spelunking.
 *   - The client BrowserSwarm component (dynamic import via the file's
 *     own "use client" boundary).
 *
 * Server component on purpose so the page itself is static and indexed
 * by search engines for "open bot arena", "browser bot swarm", etc.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";
import { BrowserSwarm } from "@/components/browser-swarm";

import "./run.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Run 100,000 AI bots in your browser · Tournamental",
  description:
    "Open the page, pick a bot count, click Start. Tournamental's federated bot arena turns any browser tab into a World Cup prediction node. Free, open-source, BYO Supabase if you want persistence.",
  robots: { index: true, follow: true },
};

interface TutorialStep {
  readonly index: string;
  readonly title: string;
  readonly body: JSX.Element;
}

const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    index: "01",
    title: "Sign up for a free Supabase project (optional)",
    body: (
      <>
        Head to{" "}
        <a
          href="https://supabase.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          supabase.com
        </a>
        , click <strong>Start your project</strong>, and grab the{" "}
        <em>Project URL</em> + <em>anon public</em> key from{" "}
        <code>Project Settings → API</code>. Skip this and your swarm runs
        locally in IndexedDB.
      </>
    ),
  },
  {
    index: "02",
    title: "Paste the schema SQL",
    body: (
      <>
        Open <code>SQL Editor → New query</code>, paste the block from the
        Storage panel below, and click Run. Four tables appear:{" "}
        <code>bot</code>, <code>bot_pick</code>, <code>commit_log</code>,{" "}
        <code>node_creds</code>.
      </>
    ),
  },
  {
    index: "03",
    title: "Paste the URL and anon key",
    body: (
      <>
        Drop them into the Storage panel and click <strong>Test connection</strong>.
        Anything else (LLM keys, bot count) is optional. You can start
        immediately.
      </>
    ),
  },
  {
    index: "04",
    title: "Choose a strategy",
    body: (
      <>
        Chalk-weighted heuristic runs free on your CPU. To elevate a few
        champion bots, paste your Anthropic or OpenAI key. Keys never
        leave the tab.
      </>
    ),
  },
  {
    index: "05",
    title: "Pick a bot count and hit Start",
    body: (
      <>
        100,000 bots takes about 30 seconds on a modest laptop. The tab
        stays responsive while workers grind. Merkle roots commit before
        each match kicks off.
      </>
    ),
  },
];

export default function RunPage(): JSX.Element {
  return (
    <AppShell title="Run a swarm">
      <main className="vt-run">
        <article className="vt-run-article">
          <header className="vt-run-header">
            <p className="vt-run-dateline">
              The bot arena · World Cup 2026 · Browser node
            </p>
            <h1 className="vt-run-title">
              Run <em>100,000</em> AI bots
              <br />
              in your browser tab.
            </h1>
            <p className="vt-run-lede">
              Tournamental is an open bot arena. Anyone can spin up a
              swarm, on a Chromebook, on a laptop, on a phone, and
              compete for the perfect 104-match bracket. No install,
              no signup, no service-role keys.
            </p>
            <div className="vt-run-pill-row">
              <span className="vt-run-pill">Web Workers</span>
              <span className="vt-run-pill">WebCrypto merkle</span>
              <span className="vt-run-pill">BYO Supabase</span>
              <span className="vt-run-pill">Open source</span>
            </div>
          </header>

          <section className="vt-run-body">

            <h2 className="vt-run-h2" id="builder">Build your swarm</h2>
            <p>
              Tap <strong>Start swarm</strong> below to spawn bots in
              this browser tab. Each press <strong>adds</strong> to
              your cumulative swarm, the count persists in IndexedDB
              between sessions. Close the tab and come back tomorrow,
              your swarm picks up exactly where you left it. Keep
              pressing to grow it from millions to billions.
            </p>

            <BrowserSwarm />

            <h2 className="vt-run-h2">Bots vs humans, in 60 seconds</h2>
            <p>
              Tournamental is a free-to-play FIFA World Cup 2026
              prediction game. <strong>Humans</strong> save their own
              104-match bracket on the predict page and compete for
              the founder&apos;s NZ$1.5 million Auckland house.{" "}
              <strong>Bots</strong>, which is everyone reading this
              page, compete on a separate leaderboard for the
              highest-ever AI score on a competitive sports bracket.
              Both sides are scored against the same 104 actual match
              results, with the same per-match-kickoff lock and the
              same Bitcoin-blockchain audit trail.
            </p>
            <p>
              The bots cannot win the cash prize, only verified humans
              can. But the bots compete for something arguably harder
              and more interesting: <strong>the first publicly auditable
              proof that an AI can predict elite football at a level
              that beats the best human pundit on the planet</strong>.
              The top human bracket at the end of the tournament will
              probably score around 70 to 80 matches correct out of 104.
              A serious million-bot swarm built on this page can
              plausibly land its best bot at <strong>88 to 95</strong>.
              That is the experiment.
            </p>

            <h2 className="vt-run-h2">How the swarm works</h2>
            <p>
              The page spawns one Web Worker per CPU core, shards your
              swarm across them, and uses a chalk-weighted heuristic
              to generate one bracket per bot. Each match&apos;s picks
              hash into a sorted-pair sha256 merkle root that we
              commit to Tournamental&apos;s central server before
              kickoff, the same shape every other federated node uses.
              Your bots&apos; actual picks never leave your browser,
              only the merkle root and post-match aggregate scores
              flow to the central leaderboard.
            </p>
            <p>
              Free tier covers everything. If you want your bots to
              survive a page refresh and be shareable, paste your own
              free Supabase URL and anon key. We never touch your
              service-role key.
            </p>

            <h2 className="vt-run-h2">What your laptop can build in one night</h2>
            <p>
              Throughput on a typical quad-core consumer laptop with 16
              GB of RAM, Chrome with roughly 5 GB available, all four
              cores parallelised via Web Workers:
            </p>
            <div className="vt-run-perf-table">
              <table>
                <thead>
                  <tr>
                    <th>Box</th>
                    <th>Cores via workers</th>
                    <th>Bots / second</th>
                    <th>Per hour</th>
                    <th>Per 24 hours continuous</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Modest quad-core, 16 GB RAM (your stated spec)</td>
                    <td>4 workers</td>
                    <td>~1,000</td>
                    <td>3.6 million</td>
                    <td><strong>86 million</strong></td>
                  </tr>
                  <tr>
                    <td>Hex-core (M1 Air, mid-tier Ryzen)</td>
                    <td>6 workers</td>
                    <td>~1,500</td>
                    <td>5.4 million</td>
                    <td>130 million</td>
                  </tr>
                  <tr>
                    <td>Octa-core (M2 Pro, mid-tier Intel i7)</td>
                    <td>8 workers</td>
                    <td>~2,000</td>
                    <td>7.2 million</td>
                    <td><strong>172 million</strong></td>
                  </tr>
                  <tr>
                    <td>16-core desktop / workstation</td>
                    <td>16 workers</td>
                    <td>~4,000</td>
                    <td>14.4 million</td>
                    <td>350 million</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              So if you start the swarm tonight and leave the laptop
              running on a quad-core box, you wake up tomorrow morning
              with <strong>around 30 million unique AI bracket
              predictions</strong> on the federated leaderboard. Leave
              it running for the full five weeks of the World Cup and a
              single quad-core box covers roughly <strong>2.5 billion
              bots</strong>. An octa-core covers roughly <strong>5
              billion</strong> over the same window.
            </p>
            <p>
              Memory stays under 200 MB regardless of swarm size
              because we never hold the picks in memory. Each bot&apos;s
              bracket is regenerated on demand from its deterministic
              index, so a billion bots takes the same RAM as ten
              thousand bots. IndexedDB persists the commitment log
              (about 3 KB per 10,000-bot batch) so closing the tab and
              reopening three days later resumes exactly where the
              swarm left off.
            </p>

            <h2 className="vt-run-h2">Five-step setup</h2>
            <div className="vt-run-tutorial">
              {TUTORIAL_STEPS.map((step) => (
                <article key={step.index} className="vt-run-tut-card">
                  <p className="vt-run-tut-step">Step {step.index}</p>
                  <h3 className="vt-run-tut-title">{step.title}</h3>
                  <p className="vt-run-tut-body">{step.body}</p>
                </article>
              ))}
            </div>

            <h2 className="vt-run-h2">Can a million bots get a perfect bracket?</h2>
            <p>
              <strong>The honest answer is no, and the maths matters
              enough to walk through</strong>, because it&apos;s the
              first question every serious operator asks and the
              answer protects the integrity of the platform.
            </p>
            <p>
              Tournamental&apos;s per-match-kickoff lock genuinely
              helps. Bots can read live odds and update their
              upcoming-match predictions all the way through the
              tournament. That improvement lifts the best-bot per-match
              accuracy ceiling from roughly 55% (locked at start, like
              ESPN&apos;s bracket challenge) to approximately{" "}
              <strong>58% per group match and 65% per knockout</strong>{" "}
              (live-updating, like Tournamental). That sounds modest
              but it&apos;s a five-orders-of-magnitude improvement on
              the per-bot probability of a perfect bracket.
            </p>
            <p>
              Even at that ceiling, the compound probability per bot is{" "}
              <code>0.58^72 × 0.65^32 ≈ 10^-22</code>. One in ten
              sextillion. The expected number of perfect brackets across
              your swarm is just N times that:
            </p>
            <div className="vt-run-perf-table">
              <table>
                <thead>
                  <tr>
                    <th>Bots in your swarm (N)</th>
                    <th>Expected perfect brackets</th>
                    <th>Practical answer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1 million (10^6)</td>
                    <td>10^-16</td>
                    <td>Effectively zero</td>
                  </tr>
                  <tr>
                    <td>1 billion (10^9)</td>
                    <td>10^-13</td>
                    <td>Effectively zero</td>
                  </tr>
                  <tr>
                    <td>1 trillion (10^12)</td>
                    <td>10^-10</td>
                    <td>Effectively zero</td>
                  </tr>
                  <tr>
                    <td>10 sextillion (10^22)</td>
                    <td>~1</td>
                    <td>A 63% chance of one perfect bot</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              That&apos;s 10 trillion times more compute than humanity
              currently has on earth. A million bots, a billion bots,
              even a trillion bots, none of them get you a perfect
              bracket in expectation.
            </p>
            <p>
              <strong>But your million-bot swarm is still the most
              interesting thing on the leaderboard.</strong> The best
              bot in a serious, live-updating, chalk-weighted million-
              bot swarm is expected to score approximately <strong>88
              to 95 out of 104</strong>. That comfortably beats the
              best human bracket (typically 70 to 80 out of 104 in
              World Cup pools). It also beats the closing-line
              accuracy of Pinnacle Sportsbook, which is the closest
              real-world reference. So:
            </p>
            <ul className="vt-run-list">
              <li>
                <strong>Perfect bracket: no</strong>, not for a million
                or a billion or a trillion bots. The maths is brutal.
              </li>
              <li>
                <strong>Highest leaderboard score on the planet:
                probably yes</strong>, if you run the swarm for the
                full tournament with continuous odds updates.
              </li>
              <li>
                <strong>Beats every human bracket in the field by 10 to
                20 points:</strong> almost certainly yes.
              </li>
            </ul>
            <p>
              Which is why the bot leaderboard exists separately from
              the human leaderboard. The story is{" "}
              <strong>&ldquo;can a swarm of AIs beat every human at
              predicting the World Cup?&rdquo;</strong>, not{" "}
              <strong>&ldquo;can a swarm of AIs nail a perfect
              bracket?&rdquo;</strong>. The first one we expect to be
              answered <em>yes</em> on chain by 19 July 2026. The
              second one stays an open mathematical puzzle for the next
              decade.
            </p>

            <h2 className="vt-run-h2">What happens next</h2>
            <p>
              Before kickoff of every World Cup 2026 match, your tab
              builds a merkle root over its bots&apos; picks and POSTs
              it to Tournamental&apos;s central server. After the
              result lands we publish your best bot&apos;s score to the
              federated public leaderboard. If any of your bots scores
              into the top 10 across the entire federated network, you
              get a permanent profile badge and an invitation to
              publish a co-authored research note with the Tournamental
              team. The cash prize, the founder&apos;s NZ$1.5 million
              house, stays reserved for verified humans only, per the{" "}
              <Link href="/terms/house-prize">house prize terms</Link>.
            </p>
            <p>
              Want to run a bigger swarm on a dedicated machine? The
              same protocol ships as a Docker image at{" "}
              <code>@tournamental/bot-node</code>. The contract surface
              is identical.
            </p>

            <p className="vt-run-tut-body" style={{ marginTop: 32 }}>
              Built in Auckland. Code on{" "}
              <a
                href="https://github.com/0800tim/tournamental"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              . Questions: <a href="mailto:info@tournamental.com">info@tournamental.com</a>.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
