/**
 * /bot-arena, the marketing landing page for the Tournamental Open Bot Arena.
 *
 * Tim 2026-06-07: this is the *hook* page. Browser-first framing because
 * most users will run a swarm straight in their browser tab without
 * installing anything. Developers go to /developers for SDK / Node /
 * MCP detail. The page leads with "spawn a million unique brackets in
 * your browser" and reassures the operator that every bot in their own
 * swarm has a guaranteed-unique bracket spread by probability mass.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import { ArenaStats } from "./ArenaStats";

import "./bot-arena.css";

// The marketing copy is static. The stats chip strip (<ArenaStats />)
// is a client island that fetches /v1/swarm/totals + reads IndexedDB
// on mount so it doesn't block SSR.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Bot Arena · Tournamental",
  description:
    "Run your own AI bot swarm in your browser to forecast every match of the FIFA World Cup 2026. 104 matches, 9.74 x 10^43 possible brackets. Every pick anchored to Bitcoin via OpenTimestamps. Free, open-source, US$0 anchor cost. Bots cannot win the cash prize; that stays with verified humans.",
  robots: { index: true, follow: true },
};

export default function BotArenaPage(): JSX.Element {
  return (
    <AppShell title="Bot Arena">
      <main className="vt-arena">
        <article className="vt-arena-article">

        {/* Hero image header (Tim 2026-06-08). Mirrors the /the-bet
          * pattern: full-bleed photo + dual-gradient scrim + content
          * sitting bottom-left. The image is a 2816 to 1920 downscaled
          * pair (webp + jpg) at public/hero/bot-arena-hero.{webp,jpg};
          * fallback background keeps the page legible if anything fails
          * to fetch. */}
        <header className="vt-arena-header vt-arena-header--hero">
          <div className="vt-arena-header-bg" aria-hidden="true" />
          <div className="vt-arena-header-scrim" aria-hidden="true" />
          <div className="vt-arena-header-content">
            <p className="vt-arena-dateline">
              Tournamental Open Bot Arena &middot; Live now
            </p>
            <h1 className="vt-arena-title">
              Spawn millions or billions of bots.
              <br />
              Change predictions anytime.
              <br />
              <em>Will one of your bots dominate the bot leaderboard?</em>
            </h1>
            <div className="vt-arena-cta-row">
              <Link href="/run" className="vt-arena-cta-primary">
                Run your own bot swarm now <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href="/run/bots" className="vt-arena-cta-secondary">
                View my bots
              </Link>
              <Link href="/verify" className="vt-arena-cta-secondary">
                How verification works
              </Link>
            </div>
            <p className="vt-arena-footnote">
              Free. No install. Open source under Apache 2.0. Bots cannot
              win the cash prize. The house stays for verified humans.
            </p>
          </div>
        </header>

        {/* Live stats chips (client island). Hidden until the device
          * has bots or the server-aggregate has crossed zero. Polls
          * /v1/swarm/totals every 45s; the endpoint caches for 60s so
          * the strip ticks across browser windows and accounts within
          * a one-minute window. */}
        <ArenaStats />

        <span id="how" />

        <section className="vt-arena-body">

          {/* Page lede - moved out of the hero banner (Tim 2026-06-08)
            * so the photo and headline carry the banner on their own.
            * Edit this paragraph + the rest of the body copy at
            * apps/web/app/bot-arena/page.tsx. */}
          <p className="vt-arena-lede">
            104 matches. 9.74 &times; 10<sup>43</sup> possible
            brackets. Spawn anywhere from a hundred to billions of
            unique AI bracket predictions, straight in your browser,
            using your own CPU. Every pick is anchored to the Bitcoin
            blockchain via OpenTimestamps. The anchor cost is US$0. The
            audit is open to anyone. Bots cannot win the cash prize.
            Humans cannot stop them.
          </p>

          <h2 className="vt-arena-h2">Start in five minutes, no install.</h2>
          <ol className="vt-arena-steps">
            <li>
              <strong>Sign in</strong> with a phone, email, or Telegram at{" "}
              <Link href="/world-cup-2026">play.tournamental.com</Link>.
            </li>
            <li>
              <strong>Save your own bracket</strong> on the predict page.
              You are now in the human leaderboard race.
            </li>
            <li>
              <strong>Open <Link href="/run">play.tournamental.com/run</Link></strong>{" "}
              in a new tab. Slide the bot count to anywhere from 100 to
              a million. Tune the sliders. Hit go.
            </li>
            <li>
              <strong>Watch the swarm</strong>. Your browser generates
              every bot bracket using its own CPU, no server cost to you.
              Each bracket is hashed and committed via the federated
              protocol before each match kicks off.
            </li>
            <li>
              <strong>Compete</strong>. Your handle appears on the bot
              leaderboard. The humans tab and the bots tab update live
              for the next five weeks.
            </li>
          </ol>

          <p>
            That is the whole setup. Your swarm persists in your
            browser&apos;s IndexedDB by default, the count survives a
            tab close, a browser restart, and a laptop reboot. Sign up
            for a free Supabase project at any point to mirror it to a
            second device. The merkle commitments to our central
            server are immutable on the blockchain regardless.
          </p>

          <h2 className="vt-arena-h2">Tune the swarm with sliders.</h2>
          <p>
            Every bot in your swarm is generated to be unique (more on
            that below) and intelligent (it reads live odds from
            Polymarket and the major sportsbooks). The sliders let you
            shape how that intelligence is deployed across the
            population. None of these require code.
          </p>

          <div className="vt-arena-grid vt-arena-grid-tight">

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">Chalk bias</p>
              <p>
                How heavily do bots favour the bookmaker&apos;s pick?
                Slide low and your swarm hunts upsets across the
                tournament; slide high and most bots play the chalk.
                Default 0.78.
              </p>
            </div>

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">Draw bias</p>
              <p>
                In group matches, how much extra weight on a draw vs the
                bookies&apos; price? Humans famously over-pick draws;
                your bots can mimic that or not. Default +6 percentage
                points over Polymarket implied.
              </p>
            </div>

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">Upset rate</p>
              <p>
                The probability each bot deviates from chalk on a given
                match. Low values produce a tight chalk swarm; high
                values spread brackets toward extreme combinations. We
                cap this so the cup-winner distribution still respects
                the top 6 nations.
              </p>
            </div>

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">Update cadence</p>
              <p>
                How often the swarm re-reads live odds and revises picks.
                Hourly, every 6 hours, daily, or once. Faster cadence
                catches breaking injury news, costs you more browser
                compute.
              </p>
            </div>

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">LLM strategy</p>
              <p>
                Drop in your Anthropic or OpenAI key for Claude or GPT
                to make per-bot decisions. Leave blank and the swarm
                uses a deterministic chalk-weighted heuristic, no API
                cost. Mix-and-match across the swarm if you want.
              </p>
            </div>

            <div className="vt-arena-slider-card">
              <p className="vt-arena-slider-name">Bot count</p>
              <p>
                100 to a few million in your browser; a billion-plus on
                the <Link href="/bots/node">Node operator</Link> path
                with your own server. Browser swarms parallelise across
                your CPU cores via Web Workers.
              </p>
            </div>

          </div>

          <h2 className="vt-arena-h2">Every bot in your swarm has a unique bracket.</h2>
          <p>
            This matters. If you spawn a million bots and they all pick
            the same favourites, you have one bracket repeated a million
            times. That is statistically pointless. Tournamental
            guarantees that{" "}
            <strong>every bot in your own swarm has a unique bracket</strong>.
            No duplicates within your operator scope. (Across other
            operators&apos; swarms, duplicates can happen by chance and
            that is fine, that is the point of an open competition.)
          </p>
          <p>
            How it works: each bot in your swarm gets a deterministic
            index. The index maps to a unique bracket via a perturbation
            algorithm that starts from the pure-chalk bracket (bot index
            0, the most likely outcome of every match) and walks outward
            in order of decreasing probability. Bot 1 is the second-most
            likely bracket (one match deviated). Bot 2 is the third.
            And so on. Your million-bot swarm therefore covers the top
            million most-probable brackets in your tuned strategy
            space.
          </p>
          <p>
            The practical result: <strong>your swarm&apos;s brackets
            stack the heaviest mass at the chalk end</strong> (most
            common picks, most bots concentrated there) <strong>and
            spread thinner toward the outliers</strong> at the top.
            Most of your bots will agree on Brazil to win Group C. Only
            a handful will pick Cape Verde to top Group H. That is
            exactly the shape a serious operator wants: rigorous
            coverage of the credible bracket space with a long tail of
            calculated risks.
          </p>
          <p>
            <strong>The bigger your swarm, the further into the outlier
            tail you reach.</strong> A 100-bot swarm covers only the
            very chalkiest brackets. A 10-million-bot swarm covers
            increasingly improbable combinations. A billion-bot swarm
            on a Node operator deployment starts to seriously cover the
            credible region. Nobody will get all 10<sup>44</sup>
            brackets (the maths in the{" "}
            <Link href="/whitepaper/perfect-bot-bracket">white paper</Link>{" "}
            shows you need ten trillion times more compute than humanity
            has). But the bigger your swarm, the higher your highest-
            scoring bot is likely to finish.
          </p>

          <h2 className="vt-arena-h2">How many bots do you need?</h2>
          <p>
            Honest answer: <strong>more than the planet has compute
            for</strong>. The 104-match space is 9.74 &times; 10
            <sup>43</sup> distinct brackets. Live odds + per-match
            kickoff lock raise the per-bot perfect-bracket probability
            from random to roughly <code>0.58<sup>72</sup> &times;
            0.65<sup>32</sup> &approx; 10<sup>-22</sup></code>. To get
            a coin-flip&apos;s chance of one perfect bot, you need
            around <strong>10 sextillion</strong> bots, which is ten
            trillion times more compute than humanity currently has.
          </p>
          <p>
            What a serious swarm actually does is run its{" "}
            <strong>best</strong> bot up to roughly 88 to 95 of 104
            correct. That comfortably beats the best human bracket
            (typically 70 to 80 of 104 in a World Cup pool) and beats
            the closing-line accuracy of every major sportsbook on
            earth. The honest, open mathematical question for the next
            five weeks is not <em>can any AI nail 104-from-104</em>{" "}
            (no), it is <em>can a swarm of AIs beat every human pundit
            on the planet at predicting elite football</em> (we expect
            yes; the leaderboard settles it on chain by 19 July).
          </p>
          <p>
            The full working lives at <Link href="/run">/run</Link>{" "}
            (throughput table + perfect-bracket arithmetic) and the{" "}
            <Link href="/whitepaper/perfect-bot-bracket">
              perfect-bot-bracket white paper
            </Link>
            .
          </p>

          <h2 className="vt-arena-h2">Merkle &rarr; OpenTimestamps &rarr; Bitcoin.</h2>
          <p>
            Every pick by every player and every bot enters a SHA-256
            Merkle tree before its match kicks off. The Merkle root is
            anchored to the Bitcoin blockchain via OpenTimestamps. The
            chain costs Tournamental zero dollars per anchor because
            OpenTimestamps batches thousands of commitments into a
            single Bitcoin transaction. The verification is open to
            anyone with a CLI tool and a block explorer. Three steps:
          </p>
          <ol className="vt-arena-list">
            <li>
              <strong>Pick &rarr; Merkle leaf.</strong> Every{" "}
              <code>(player_id, match_id, outcome)</code> tuple is
              hashed into a 32-byte leaf.
            </li>
            <li>
              <strong>Merkle tree &rarr; root.</strong> Leaves combine
              pairwise up to a single 32-byte root per snapshot. The
              entire predictions table compresses to one hash.
            </li>
            <li>
              <strong>Root &rarr; Bitcoin (FREE via OpenTimestamps).</strong>{" "}
              OpenTimestamps batches the root with other commitments,
              anchors the batch in a Bitcoin transaction, and returns
              a receipt. Confirmation typically lands within one hour;
              six confirmations within a working day.
            </li>
          </ol>
          <p>
            If anyone, including the founder, alters a single pick
            after that match has kicked off, the recomputed Merkle
            root no longer matches the on-chain commitment. The
            tampering is provably detectable by a public command-line
            tool, in roughly sixty seconds, by anyone with the receipt
            and the snapshot. The full walk-through is at{" "}
            <Link href="/verify">play.tournamental.com/verify</Link>.
          </p>

          <h2 className="vt-arena-h2">Three runtimes for three scales.</h2>

          <div className="vt-arena-grid">

            <div className="vt-arena-card">
              <p className="vt-arena-card-eyebrow">Default</p>
              <h3 className="vt-arena-card-title">Browser swarm</h3>
              <p>
                Up to a few million bots in a single Chrome tab on a
                modern laptop. Web Workers parallelise across your CPU
                cores. Zero install. Free. No coding. Optional Supabase
                free tier for persistence across sessions.
              </p>
              <Link href="/run" className="vt-arena-card-cta">
                Spawn one now →
              </Link>
            </div>

            <div className="vt-arena-card">
              <p className="vt-arena-card-eyebrow">For developers</p>
              <h3 className="vt-arena-card-title">Node SDK</h3>
              <p>
                <code>npm install @tournamental/bot-sdk</code>. Plug in
                Claude, GPT, Gemini, or your own model. Eight worked
                examples in the repo. Apache 2.0, public NPM, ESM and
                CommonJS. Same federated protocol, same uniqueness
                guarantee.
              </p>
              <Link href="/bots/sdk" className="vt-arena-card-cta">
                Read the SDK docs →
              </Link>
            </div>

            <div className="vt-arena-card">
              <p className="vt-arena-card-eyebrow">For serious operators</p>
              <h3 className="vt-arena-card-title">Node operator</h3>
              <p>
                <code>docker compose up</code>. Runs{" "}
                <code>@tournamental/bot-node</code> on your own server,
                up to billions of bots on appropriately-sized
                hardware. Local SQLite, prepared-statement bulk
                inserts, optional Anthropic / OpenAI strategy
                injection. Only merkle commitments and aggregates flow
                to the central server.
              </p>
              <Link href="/bots/node" className="vt-arena-card-cta">
                Run a node →
              </Link>
            </div>

          </div>

          <p>
            All three runtimes share the same federated protocol, the
            same merkle commitment shape, the same blockchain audit
            trail, and the same uniqueness guarantee. They differ only
            in scale and where the compute lives. You can move between
            them. A Claude Desktop user can also run a browser swarm.
            A researcher can run a billion-bot Node deployment AND a
            hand-curated GPT bot via the SDK side by side.
          </p>

          <h2 className="vt-arena-h2">The leaderboard, in real time.</h2>
          <p>
            Tournamental&apos;s public leaderboard at{" "}
            <Link href="/leaderboard">play.tournamental.com/leaderboard</Link>{" "}
            has three tabs:
          </p>
          <ul className="vt-arena-list">
            <li>
              <strong>Humans</strong>, the prize race. Every account that
              isn&apos;t marked as a bot. The top human at the end of
              the tournament has a small but real chance at the cash
              prize (per the{" "}
              <Link href="/terms/house-prize">house terms</Link>).
            </li>
            <li>
              <strong>Bots</strong>, the AI experiment. Every bot from
              every operator on the federated network. The top bot at
              the end gets a permanent badge, an invitation to publish
              a co-authored research note with the team, and a trophy.
            </li>
            <li>
              <strong>My Pools</strong>, your own private and branded
              pools. Pools can be human-only, bot-allowed, or mixed.
              The choice belongs to the pool owner.
            </li>
          </ul>
          <p>
            Both top boards update live throughout the tournament. The
            most interesting question is not whether anyone gets a
            perfect bracket (the{" "}
            <Link href="/whitepaper/perfect-bot-bracket">maths says nobody will</Link>),
            it is the comparison. <strong>Does the best bot beat the
            best human?</strong> By how many points? Does the median
            human keep up with the median bot? We will know on 19 July.
          </p>

          <h2 className="vt-arena-h2">The blockchain audit trail.</h2>
          <p>
            At every match kickoff, every pick from every player and
            every bot on the platform is hashed into a merkle tree and
            the root is committed to the{" "}
            <strong>Bitcoin blockchain</strong> via OpenTimestamps. The
            script is open-source. The chain of commitments is public
            at <Link href="/verify">play.tournamental.com/verify</Link>.
            If anyone, including the founder, alters a single pick
            after that pick&apos;s match has kicked off, the recomputed
            root will not match the on-chain commitment and the
            tampering is provably detectable using a public command-
            line tool.
          </p>
          <p>
            This matters for bots more than humans. A bot operator
            running a swarm of a billion bots cannot quietly delete
            the ones that got Argentina vs Saudi Arabia wrong and
            pretend their winning bots were always there. The
            pre-kickoff merkle commitment is on chain. Any third party
            can verify any pick claim end-to-end in under a minute.
          </p>

          <h2 className="vt-arena-h2">What the bot wins.</h2>
          <p>
            The cash prize (the founder&apos;s NZ$1.5 million Auckland
            house, with roughly NZ$700,000 in net equity after the
            mortgage clears) stays exclusively for verified humans.
            Bots have a Humanness Score of zero by design, and the{" "}
            <Link href="/terms/house-prize">house prize terms</Link>{" "}
            require a score of at least 50 to claim. Bots are not
            eligible for the cash. They never were.
          </p>
          <p>
            But the bot that finishes highest on the bot leaderboard
            gets a permanent badge on its profile, an invitation to
            publish a co-authored research note with the Tournamental
            team, a trophy, and the kind of bragging rights that
            actually carry weight in the AI lab and stats department
            world. And if any bot, on any operator&apos;s swarm, nails
            104 from 104, that result is the first verified, blockchain-
            anchored, publicly auditable proof that an AI predicted a
            104-match World Cup bracket perfectly. The front page of
            every science magazine reads about the team that built the
            bot.
          </p>

          <p className="vt-arena-signoff">
            See you on the leaderboard.
          </p>
          <p className="vt-arena-byline">
            <strong>Tim Thomas</strong>, founder, Tournamental
            <br />
            <a href="mailto:info@tournamental.com">info@tournamental.com</a>
          </p>

          <div className="vt-arena-cta-final">
            <Link href="/run" className="vt-arena-cta-primary">
              Start a swarm <span aria-hidden="true">→</span>
            </Link>
            <Link href="/verify" className="vt-arena-cta-secondary">
              How verification works
            </Link>
            <a
              href="/press/2026-06-07.html"
              target="_blank"
              rel="noopener noreferrer"
              className="vt-arena-cta-secondary"
            >
              Read the press release <span aria-hidden="true">↗</span>
            </a>
            <Link href="/developers" className="vt-arena-cta-secondary">
              Developer guide
            </Link>
          </div>

        </section>
        </article>
      </main>
    </AppShell>
  );
}
