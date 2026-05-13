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
import { CountdownBanner } from "@/components/ui";

import { LiveWidgetDemo } from "./syndicates/LiveWidgetDemo";
import "./home.css";

const WC_2026_KICKOFF_UTC = "2026-06-11T18:00:00-06:00";
const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

export const metadata: Metadata = {
  title: "Tournamental — predict the World Cup, watch it in 3D, run your own syndicate",
  description:
    "Free-to-play Football World Cup 2026 prediction game with a 3D molecule watch-along, verifiable picks, and a built-in syndicate platform so anyone can run a branded sweepstake for their audience.",
};

export default function HomePage(): JSX.Element {
  return (
    <AppShell title="Tournamental">
      <main className="vt-home">
        {/* ============== HERO ============== */}
        <section className="vt-home-hero">
          <span className="vt-home-eyebrow">Football World Cup 2026 · Free to play</span>
          <h1 className="vt-home-title">
            Predict every match. Watch it in 3D.
            <br className="vt-home-br" /> Run your own sweepstake.
          </h1>
          <p className="vt-home-lede">
            Tournamental is the open-source prediction game for the world's biggest
            tournaments. Save your picks before kickoff, change them right up until
            each match starts, watch the action play out in our 3D molecule, and run
            a branded syndicate for your audience. Free forever; premium adds a
            fully-managed CRM via Aiva.
          </p>
          <div className="vt-home-cta-row">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              Set your picks now →
            </Link>
            <Link href="/syndicates" className="vt-home-btn vt-home-btn-ghost">
              Run a syndicate
            </Link>
          </div>
          <ul className="vt-home-trust">
            <li><span aria-hidden="true">✓</span> No credit card</li>
            <li><span aria-hidden="true">✓</span> No app install</li>
            <li><span aria-hidden="true">✓</span> Apache 2.0 open source</li>
            <li><span aria-hidden="true">✓</span> NZ-built</li>
          </ul>
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
        <section className="vt-home-section vt-home-step" id="picks">
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
              <strong>Pundit IQ ladder.</strong> Each prediction is timestamped and
              signed (a VStamp). Your record is yours, transferable across syndicates.
            </li>
          </ul>
          <div className="vt-home-cta-row">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              Build my bracket →
            </Link>
            <Link href={`/match/${DEMO_MATCH_ID}`} className="vt-home-btn vt-home-btn-ghost">
              Watch the 2022 final replay
            </Link>
          </div>
        </section>

        {/* ============== STEP 2 — MOLECULE ============== */}
        <section className="vt-home-section vt-home-step" id="molecule">
          <div className="vt-home-step-tag">Step 2 · As matches play</div>
          <h2 className="vt-home-h2">Watch the tournament in 3D.</h2>
          <p className="vt-home-p">
            The Tournamental molecule renders every match in the browser at 60 fps on a
            mid-range phone, no app install, no broadcaster paywall. Drag the timeline,
            rotate the pitch, zoom into the box, see your saved picks light up as each
            result settles.
          </p>
          <div className="vt-home-feature-grid">
            <div className="vt-home-feature">
              <h3>22 players, real positions</h3>
              <p>Body GLB + jersey textures + Wikidata faces for the 22 starters. Reads StatsBomb open data; SimulatedSports feeds for live.</p>
            </div>
            <div className="vt-home-feature">
              <h3>Scrubable timeline</h3>
              <p>Jump to any minute. Pause on a goal, share the moment. Your bracket recalculates as the score moves.</p>
            </div>
            <div className="vt-home-feature">
              <h3>No app, no install</h3>
              <p>Pure WebGL in the browser. Works on iOS Safari, Android Chrome, your laptop. Geo-block-free.</p>
            </div>
            <div className="vt-home-feature">
              <h3>Open the data</h3>
              <p>The renderer is Apache 2.0. Plug in your own data feed; build your own watch-along; ship it.</p>
            </div>
          </div>
          <div className="vt-home-cta-row">
            <Link href={`/match/${DEMO_MATCH_ID}`} className="vt-home-btn vt-home-btn-primary">
              See the 2022 final in 3D →
            </Link>
            <Link href="/watch" className="vt-home-btn vt-home-btn-ghost">
              Browse other matches
            </Link>
          </div>
        </section>

        {/* ============== STEP 3 — SYNDICATES (FRONT AND CENTRE) ============== */}
        <section className="vt-home-section vt-home-step vt-home-step-syndicates" id="syndicates">
          <div className="vt-home-step-tag vt-home-step-tag-headline">Step 3 · Bring your friends</div>
          <h2 className="vt-home-h2">Run a syndicate. Brand it your way.</h2>
          <p className="vt-home-claim">
            The only World Cup prediction platform where anyone can launch a fully
            branded, embeddable syndicate with custom prize splits and verifiable
            on-chain settlement — in minutes.
          </p>
          <p className="vt-home-p">
            A syndicate is your own branded prediction pool. Pick a name, drop the embed
            widget on any site (Squarespace, WordPress, Shopify, your blog), and run a
            six-week sweepstake for your audience. Set an entry fee and prize splits, or
            keep it free for bragging rights. Tournamental never touches the money.
          </p>

          <div className="vt-home-demo-wrap">
            <div className="vt-home-demo-badge">Live preview of the syndicate widget</div>
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
              <Link href="/syndicates/new" className="vt-home-btn vt-home-btn-primary vt-home-btn-block">
                Start free in 60 seconds →
              </Link>
            </div>
            <div className="vt-home-tier vt-home-tier-premium">
              <span className="vt-home-tier-tag vt-home-tier-tag-premium">Premium · powered by Aiva</span>
              <h3 className="vt-home-tier-name">$97 <span className="vt-home-tier-price-sub">/ month + usage</span></h3>
              <ul className="vt-home-tier-list">
                <li>Everything in Free</li>
                <li>Fully-managed HighLevel CRM sub-account</li>
                <li>Your own phone number for SMS + WhatsApp at scale</li>
                <li>Stripe Checkout for paid entries (funds to your bank)</li>
                <li>Subdomain hosting + footer-free embed</li>
              </ul>
              <Link href="/syndicates#pricing" className="vt-home-btn vt-home-btn-ghost vt-home-btn-block">
                See what premium unlocks
              </Link>
            </div>
          </div>

          <p className="vt-home-aside">
            Premium tier is delivered by <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-home-link">Aiva</a>, our CRM and messaging partner. Tournamental never handles entry fees or prize money.
          </p>
        </section>

        {/* ============== FEATURES STRIP ============== */}
        <section className="vt-home-section">
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
        </section>

        {/* ============== FINAL CTA ============== */}
        <section className="vt-home-section vt-home-final-cta">
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
                <h3>Watch the matches</h3>
                <p>Tournament starts 11 June 2026. Every match plays in 3D, every saved pick settles automatically.</p>
              </div>
            </li>
            <li>
              <span className="vt-home-qs-n">3</span>
              <div>
                <h3>Run your own pool</h3>
                <p>Like the experience? Spin up a syndicate, brand it, invite your friends or your audience. Free or premium.</p>
              </div>
            </li>
          </ol>
          <div className="vt-home-cta-row vt-home-cta-row-centred">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              Set your picks now →
            </Link>
            <Link href="/syndicates" className="vt-home-btn vt-home-btn-ghost">
              Run a syndicate
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
