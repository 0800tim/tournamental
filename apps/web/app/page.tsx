/* eslint-disable react/no-unescaped-entities */
/**
 * Home page — sales / landing flow for play.tournamental.com.
 *
 * Tim's brief 2026-05-13: the home page must be a sales page, not a
 * news feed. Flow:
 *   1. Hero with the platform's one-line pitch + primary CTAs.
 *   2. "Set your picks now" — the core game, single big CTA into the
 *      bracket builder.
 *   3. 3D molecule callout (watch-along + interactive bracket
 *      molecule) with features and benefits.
 *   4. Syndicates section, front and centre, with the live demo
 *      widget rendering on the page itself (free + premium pitch).
 *   5. Why-it-works / how-it-works strip.
 *   6. Final CTA.
 *
 * The old news-feed home moved to /home (kept for now in case
 * internal links reference it; can delete later).
 */

import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/shell";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { CountdownBanner } from "@/components/ui";

import { LiveWidgetDemo } from "./syndicates/LiveWidgetDemo";
import "./home.css";

const WC_2026_KICKOFF_UTC = "2026-06-11T18:00:00-06:00";
const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

export const metadata: Metadata = {
  title: "Tournamental — predict every match of the 2026 World Cup",
  description:
    "Free-to-play Football World Cup 2026 prediction game. Pick all 104 matches, change any pick up to kickoff, and run a branded pool for your audience. Blockchain-anchored picks so the claim to glory is finally provable.",
};

export default function HomePage(): JSX.Element {
  return (
    <AppShell title="Tournamental">
      <main className="vt-home">
        {/* ============== HERO ============== */}
        {/* Editorial-sport hero with a tinted 2022 World Cup stadium photo
         * underneath (CC BY-SA 4.0, Adnen1985 / Wikimedia Commons). The
         * dark gradient overlay keeps the headline + stats readable on
         * top while the photo carries the World Cup energy that the
         * marketing site used to own. Per Tim 2026-05-21. */}
        <section className="vt-home-hero vt-home-hero--editorial">
          <div className="vt-home-hero-bg" aria-hidden="true" />
          <div className="vt-home-hero-inner">
            <p className="vt-home-dateline">
              Tournamental · World Cup 2026 · Kickoff 11 June 2026
            </p>
            <div className="vt-home-hero-top">
              <h1 className="vt-home-headline">
                <span className="vt-home-hero-line">Can you call</span>
                <span className="vt-home-hero-line">every <em>match</em> of</span>
                <span className="vt-home-hero-line">the World Cup?</span>
              </h1>
              <div className="vt-home-hero-ctas">
                <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-pick">
                  Set my picks →
                </Link>
                <Link href="/syndicates/new" className="vt-home-btn vt-home-btn-light">
                  Run a pool
                </Link>
              </div>
              <p className="vt-home-hero-lede">
                <strong>Nobody has ever done it.</strong> Twenty-two World Cups,
                964 matches, and the perfect bracket has stayed unclaimed. The
                104 matches of 2026 are the next attempt. Tournamental keeps the
                global ledger and commits every pick to the blockchain before
                each match kicks off, so your predictions are immutable and the
                claim to glory is finally provable.{" "}
                <a
                  className="vt-home-hero-readmore"
                  href="https://tournamental.com/blog/2026-05-18-media-blockchain-prize-draws"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  [read more]
                </a>
              </p>
            </div>
            <ul className="vt-home-stat-row">
              <li>
                <span className="vt-home-stat-num">104</span>
                <span className="vt-home-stat-label">Matches</span>
              </li>
              <li>
                <span className="vt-home-stat-num">48</span>
                <span className="vt-home-stat-label">Teams</span>
              </li>
              <li>
                <span className="vt-home-stat-num">0</span>
                <span className="vt-home-stat-label">Perfect brackets</span>
              </li>
              <li>
                <span className="vt-home-stat-num" aria-hidden="true">?</span>
                <span className="vt-home-stat-label">Claim to glory</span>
              </li>
            </ul>
          </div>
        </section>

        {/* ============== COUNTDOWN ============== */}
        <section className="vt-home-section">
          <CountdownBanner
            targetUtc={WC_2026_KICKOFF_UTC}
            eyebrow="Kickoff"
            title="Mexico vs the world, 11 June 2026"
          />
        </section>

        {/* ============== STEP 1 — PICKS ============== */}
        {/* Reveal-on-scroll wrappers below ride the shared motion grammar
            (8-14px rise + opacity, 600ms power3.out, light stagger). They
            replace nothing visible: each section was already visible
            on first paint; the wrapper only opts in once the section
            crosses the viewport edge. Reduced motion makes it a no-op. */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-step" id="picks">
          <div className="vt-home-step-tag">Step 1 · Today</div>
          <h2 className="vt-home-h2">Set your picks now.</h2>
          <p className="vt-home-p">
            104 matches, 48 teams, one bracket. Pick winners, draw amounts, and group
            standings. Save once, then tweak every match right up until kickoff. Earlier
            saves earn a bigger multiplier; lock everything in when you're ready and watch
            your prediction IQ climb.
          </p>
          <ul className="vt-home-bullets">
            <li>
              <strong>Change picks until kickoff.</strong> Unlike Telegraph, ESPN, or
              Yahoo, nothing locks at the first whistle. Every match is its own decision.
            </li>
            <li>
              <strong>Early-save multiplier.</strong> Call Argentina to win the final
              today and the points are worth more than calling it the night before.
            </li>
            <li>
              <strong>Punter IQ ladder.</strong> Each prediction is timestamped and
              signed (a VStamp). Your record is yours, transferable across syndicates.
            </li>
          </ul>
          <div className="vt-home-cta-row">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              Build my bracket →
            </Link>
          </div>
        </RevealOnScroll>

        {/* Step 2 (3D Molecule watch-along) and the Watch demo CTAs were
         * dropped on 2026-05-21 — play app is bracket-only for the
         * 2026 WC push; the molecule still works on /world-cup-2026/molecule
         * but it's no longer promoted from the player surfaces. */}

        {/* ============== STEP 2 — SYNDICATES (FRONT AND CENTRE) ============== */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-step vt-home-step-syndicates" id="syndicates">
          <div className="vt-home-step-tag vt-home-step-tag-headline">Step 2 · Bring your friends</div>
          <h2 className="vt-home-h2">Run a pool. Brand it your way.</h2>
          <p className="vt-home-claim">
            The only World Cup prediction platform where anyone can launch a fully
            branded, embeddable syndicate with custom prize splits and verifiable
            on-chain settlement — in minutes.
          </p>
          <p className="vt-home-p">
            A pool is your own branded prediction pool. Pick a name, drop the embed
            widget on any site (Squarespace, WordPress, Shopify, your blog), and run a
            six-week sweepstake for your audience. Set an entry fee and prize splits, or
            keep it free for bragging rights. Tournamental never touches the money.
          </p>

          <div className="vt-home-demo-wrap">
            <div className="vt-home-demo-badge">Live preview of the pool widget</div>
            <LiveWidgetDemo slug="tournamental-demo" />
            <p className="vt-home-demo-note">
              This is the exact widget partners drop on their own sites. Two lines of
              code; renders branded; works anywhere.
            </p>
          </div>

          {/* Tiered pitch */}
          <div className="vt-home-tiers">
            <div className="vt-home-tier">
              <span className="vt-home-tier-tag">Free forever</span>
              <h3 className="vt-home-tier-name">Branded embed widget</h3>
              <ul className="vt-home-tier-list">
                <li>Drop one snippet on any site, any CMS</li>
                <li>Brand it with your logo, colours, prize copy</li>
                <li>Country + city + global leaderboard slices</li>
                <li>Off-platform entry money (you handle the cash)</li>
                <li>Sponsor block on every share card</li>
              </ul>
              <Link href="/pools/new" className="vt-home-btn vt-home-btn-primary vt-home-btn-block">
                Start free in 60 seconds →
              </Link>
            </div>
            <div className="vt-home-tier vt-home-tier-premium">
              <span className="vt-home-tier-tag vt-home-tier-tag-premium">
                Premium · powered by{" "}
                <a
                  href="https://growthspurt.agency"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vt-home-tier-tag-link"
                >
                  Growth Spurt
                </a>
              </span>
              <h3 className="vt-home-tier-name">$97 <span className="vt-home-tier-price-sub">/ month + usage</span></h3>
              <ul className="vt-home-tier-list">
                <li>Everything in Free</li>
                <li>Fully-managed HighLevel CRM sub-account</li>
                <li>Your own phone number for SMS + WhatsApp at scale</li>
                <li>Stripe Checkout for paid entries (funds to your bank)</li>
                <li>Subdomain hosting + footer-free embed</li>
              </ul>
              <Link href="/pools#pricing" className="vt-home-btn vt-home-btn-ghost vt-home-btn-block">
                See what premium unlocks
              </Link>
            </div>
          </div>

          <p className="vt-home-aside">
            Premium tier is delivered by <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-home-link">Aiva</a>, our CRM and messaging partner. Tournamental never handles entry fees or prize money.
          </p>
        </RevealOnScroll>

        {/* ============== FEATURES STRIP ============== */}
        <RevealOnScroll as="section" className="vt-home-section">
          <h2 className="vt-home-h2 vt-home-h2-centred">Why people stay</h2>
          <div className="vt-home-feature-grid">
            <div className="vt-home-feature">
              <h3>Verifiable predictions</h3>
              <p>Every pick gets a cryptographic VStamp before kickoff. Your record is portable, public, and yours for life.</p>
            </div>
            <div className="vt-home-feature">
              <h3>Free, open, no lock-in</h3>
              <p>Apache 2.0 code, CC-BY docs, contributor revenue share via Drips. Fork it, host it yourself, or stay with us.</p>
            </div>
            <div className="vt-home-feature">
              <h3>Daily engagement</h3>
              <p>Match-day quizzes, line bets, score-input games via the Telegram bot. Six weeks of touchpoints, not five minutes of form-fill.</p>
            </div>
            <div className="vt-home-feature">
              <h3>Built on global data</h3>
              <p>StatsBomb open data, Polymarket odds, public team data. We pay our data sources; they share in upside.</p>
            </div>
          </div>
        </RevealOnScroll>

        {/* ============== FINAL CTA ============== */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-final-cta">
          <h2 className="vt-home-h2 vt-home-h2-centred">Three steps. Five minutes. Free.</h2>
          <ol className="vt-home-quickstart">
            <li>
              <span className="vt-home-qs-n">1</span>
              <div>
                <h3>Set your picks</h3>
                <p>Open the bracket, save your World Cup. Takes about five minutes the first time.</p>
              </div>
            </li>
            <li>
              <span className="vt-home-qs-n">2</span>
              <div>
                <h3>Track every match</h3>
                <p>World Cup 2026 kicks off 11 June. Save once, change any pick right up to kickoff, watch your prediction IQ climb the global leaderboard.</p>
              </div>
            </li>
            <li>
              <span className="vt-home-qs-n">3</span>
              <div>
                <h3>Run your own pool</h3>
                <p>Like the experience? Spin up a pool, brand it, invite your friends or your audience. Free or premium.</p>
              </div>
            </li>
          </ol>
          <div className="vt-home-cta-row vt-home-cta-row-centred">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              Set your picks now →
            </Link>
            <Link href="/pools" className="vt-home-btn vt-home-btn-ghost">
              Run a pool
            </Link>
          </div>
        </RevealOnScroll>
      </main>
    </AppShell>
  );
}
