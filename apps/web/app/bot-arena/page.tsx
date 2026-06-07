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

import "./bot-arena.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Bot Arena · Tournamental",
  description:
    "Launching 9 June 2026. Spawn a million unique AI bracket predictions in your browser. Tune the swarm. Lock in billions of predictions before kickoff on 11 June and compete against humans on the live 2026 FIFA World Cup leaderboard. Sign up now and we will alert you the moment the swarm builder goes live.",
  robots: { index: true, follow: true },
};

export default function BotArenaPage(): JSX.Element {
  return (
    <AppShell title="Bot Arena">
      <main className="vt-arena">
        <article className="vt-arena-article">

        <header className="vt-arena-header">
          <p className="vt-arena-dateline">
            Tournamental Open Bot Arena · Swarm builder goes live 9 June 2026
          </p>
          <h1 className="vt-arena-title">
            Spawn a <em>million unique bots</em>.
            <br />
            Right in your browser.
          </h1>
          <p className="vt-arena-lede">
            The Tournamental swarm builder launches on{" "}
            <strong>9 June 2026</strong>, one day before the opening
            match. Sign up now, save your own human bracket, and we will
            send you the alert the moment the builder goes live. From
            9 June you will be able to lock in <strong>billions of AI
            bracket predictions</strong> before kickoff on 11 June, and
            compete against humans on the live global leaderboard for
            the full five weeks of the tournament.
          </p>
          <div className="vt-arena-cta-row">
            <Link href="/world-cup-2026" className="vt-arena-cta-primary">
              Sign up + reserve your spot →
            </Link>
            <Link href="#how" className="vt-arena-cta-secondary">
              What you will be able to do
            </Link>
          </div>
          <p className="vt-arena-footnote">
            Free. No install. Bots cannot win the cash prize. The house stays for verified humans.
          </p>
        </header>

        <section className="vt-arena-launch-banner">
          <p className="vt-arena-launch-eyebrow">Launch timing</p>
          <h2 className="vt-arena-launch-title">
            Two windows to lock in. Today, and from 9 June.
          </h2>
          <div className="vt-arena-launch-grid">
            <div className="vt-arena-launch-card">
              <p className="vt-arena-launch-when">
                <strong>Today, all the way through to 9 June</strong>
              </p>
              <p>
                Sign in at{" "}
                <Link href="/world-cup-2026">play.tournamental.com</Link>{" "}
                with a phone, email, or Telegram. Save your{" "}
                <strong>own human bracket</strong> on the predict page.
                That bracket competes for the founder&apos;s NZ$1.5
                million house. The earlier you save it, the longer your
                pick history is on the blockchain audit trail.
              </p>
            </div>
            <div className="vt-arena-launch-card">
              <p className="vt-arena-launch-when">
                <strong>From 9 June, two days before kickoff</strong>
              </p>
              <p>
                The swarm builder goes live at{" "}
                <Link href="/run">play.tournamental.com/run</Link>. We
                send the alert to every signed-up account. You spawn
                anywhere from 100 to a few million unique AI bracket
                predictions straight in your browser, or run billions
                via the{" "}
                <Link href="/bots/node">federated Node operator</Link>{" "}
                path on your own server. All bot predictions lock in
                before kickoff on <strong>11 June</strong>.
              </p>
            </div>
          </div>
          <p className="vt-arena-launch-footnote">
            You do not need to install anything in advance. Just sign
            up, save your human bracket, and watch your email or in-app
            notifications for the 9 June swarm-builder go-live.
          </p>
        </section>

        <span id="how" />


        <section className="vt-arena-body">

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
            That is the whole setup. The first time you open{" "}
            <code>/run</code> the page walks you through a 30-second
            free-Supabase sign-up if you want your bots to persist
            across browser sessions. Skip it and your swarm lives in
            your browser&apos;s local storage; close the tab and it is
            gone. Either way, the merkle commitments to our central
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
              Spawn a swarm in your browser →
            </Link>
            <Link href="/developers" className="vt-arena-cta-secondary">
              Or read the full developer guide
            </Link>
          </div>

        </section>
        </article>
      </main>
    </AppShell>
  );
}
