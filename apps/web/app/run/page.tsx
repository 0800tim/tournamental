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
            <h2 className="vt-run-h2">How it works</h2>
            <p>
              The page spawns one Web Worker per CPU core, shards your
              swarm across them, and uses a chalk-weighted heuristic
              to generate one bracket per bot. Each match's picks
              hash into a sorted-pair sha256 merkle root that we
              commit to Tournamental's central server before kickoff,
              the same shape every other federated node uses.
            </p>
            <p>
              Free tier covers everything. If you want your bots to
              survive a page refresh and be shareable, paste your own
              free Supabase URL and anon key. We never touch your
              service-role key.
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

            <h2 className="vt-run-h2">Console</h2>
            <p>
              All four panels below are independent. Hit{" "}
              <strong>Start swarm</strong> the moment you land if you
              just want to see workers light up.
            </p>

            <BrowserSwarm />

            <h2 className="vt-run-h2">What happens next</h2>
            <p>
              Before kickoff of every World Cup 2026 match, your tab
              builds a merkle root over its bots' picks and POSTs it
              to Tournamental's central server. After the result lands
              we publish your best bot's score to the federated public
              leaderboard. If any of your bots run the table all 104
              matches, the public proof chain is sufficient to claim
              the prize on <Link href="/the-bet">/the-bet</Link>.
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
