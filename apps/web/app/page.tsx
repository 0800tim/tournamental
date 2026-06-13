/* eslint-disable react/no-unescaped-entities */
/**
 * Home page, sales / landing flow for play.tournamental.com.
 *
 * Tim's brief 2026-05-13: the home page must be a sales page, not a
 * news feed. Flow:
 *   1. Hero with the platform's one-line pitch + primary CTAs.
 *   2. "Set your picks now", the core game, single big CTA into the
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

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/shell";
import { RevealOnScroll } from "@/components/motion/RevealOnScroll";
import { CountdownBanner } from "@/components/ui";
import {
  PredictIcon,
  CalendarIcon,
  GroupsIcon,
  BarChartIcon,
} from "@/components/shell/icons";

import "./home.css";

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

/**
 * Returns the raw template string for a translation key, including any
 * ICU placeholders like `{odds_link}`. Useful when the caller wants to
 * split on a placeholder and interpolate React children rather than
 * letting next-intl format the value (which would throw on missing
 * placeholder args).
 */
async function safeTRaw(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t.raw(key);
    if (typeof out !== "string" || out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

// Canonical kickoff for the FIFA 2026 opening match (MEX vs RSA at the
// Estadio Azteca), from data/fifa-wc-2026/fixtures.json match #1.
// Same value mirrored in apps/web/app/world-cup-2026/landing/_lib/countdown.ts
// (TOURNAMENT_KICKOFF_UTC). If you ever change one, change both,
// or dedupe by importing from a shared lib.
// Tim 2026-06-05: the previous value here was "2026-06-11T18:00:00-06:00"
// (= 00:00 UTC June 12), 5 hours later than reality. Home countdown
// was running ahead vs Google's published kickoff time.
const WC_2026_KICKOFF_UTC = "2026-06-11T19:00:00Z";
const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

// Force dynamic so the locale resolution runs per-request. Without
// this Next.js pre-renders the home statically with the default
// locale's messages, then the client provider hydrates with the
// real locale's messages and React throws a #425 text-content
// mismatch on every visit to /es, /fr etc.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tournamental, predict every match of the FIFA World Cup 2026™",
  description:
    "Free-to-play FIFA World Cup 2026™ prediction game. Pick all 104 matches, change any pick up to kickoff, and run a branded pool for your audience. Blockchain-anchored picks so the claim to glory is finally provable. Tournamental is independent and not affiliated with FIFA.",
};

export default async function HomePage(): Promise<JSX.Element> {
  // i18n: only the hero copy + countdown labels are wired in this pass.
  // The rest of the home page sections will follow as we extract their
  // strings into the catalogue. The hero is the visitor's first paint
  // so it carries the biggest visible language change.
  const keys = await Promise.all([
    safeT("home.hero.headline_a", "FIFA World Cup™ Predictions."),
    safeT("home.hero.cta_predict", "Set my picks"),
    safeT("home.hero.cta_pool", "Run a pool"),
    safeTRaw("home.hero.lede", "Nobody will correctly predict all 104 matches, and they probably never will because of the astronomical {odds_link}. Tournamental is the global predictions ledger looking for the person(s) in the world that will get the most correct picks. Could that be you?"),
    safeT("home.hero.lede_link", "odds of getting all 104 matches right"),
    safeT("home.hero.read_more", "[read more]"),
    // Tim 2026-05-29: second line of the headline ('Play it.') + the
    // immutability paragraph beneath the lede. Wired in after PR #243
    // which set the marketing-site Hero.astro to the same copy.
    safeT("home.hero.headline_b", "Bots vs Humans."),
    safeT("home.hero.headline_c", "Who will win?"),
    safeT("home.hero.lede_2", "Tournamental keeps the global ledger and commits every pick to the blockchain before each match kicks off, so your predictions are immutable and any claim to glory is finally provable."),
    safeT("home.hero.bot_arena_lede", "A FIFA World Cup predictions game that lets you create free pools to play with friends, run office sweepstakes, and spawn millions of unique 'bracket predictions' in search of the perfect bracket. Your picks are the anchor, your bot will spawn millions of variations around your predictions to try keep a perfect bracket as upsets happen during the tournament. And they can change them along the way!"),
    // Tim 2026-06-13: tournament-in-flight quick-actions block.
    // Replaces the marketing-era 3-CTA row with the 4 daily
    // destinations players need now: bracket, calendar, pools,
    // leaderboard. 2x2 grid on mobile, single row on desktop.
    safeT("home.actions.my_picks", "My picks"),
    safeT("home.actions.schedule", "Schedule"),
    safeT("home.actions.pools", "Pools"),
    safeT("home.actions.leaderboard", "Leaderboard"),
    safeT("countdown.eyebrow", "Kickoff"),
    safeT("countdown.title_default", "Mexico vs South Africa, 11 June 2026"),
    safeT("home.stat.matches", "Matches"),
    safeT("home.stat.teams", "Teams"),
    safeT("home.stat.perfect_brackets", "Perfect brackets"),
    safeT("home.stat.claim_to_glory", "Claim to glory"),
    safeT("home.step1.tag", "Step 1 · Today"),
    safeT("home.step1.headline", "Set your picks now."),
    safeT("home.step1.lede", "104 matches, 48 teams, one bracket. Pick winners, draw amounts, and group standings. Save once, then tweak every match right up until kickoff. Earlier saves earn a bigger multiplier; lock everything in when you're ready and watch your prediction IQ climb."),
    safeT("home.step1.b1_strong", "Change picks until kickoff."),
    safeT("home.step1.b1_body", "Unlike Telegraph, ESPN, or Yahoo, nothing locks at the first kick-off. Every match is its own decision."),
    safeT("home.step1.b2_strong", "Early-save multiplier."),
    safeT("home.step1.b2_body", "Call Argentina to win the final today and the points are worth more than calling it the night before."),
    safeT("home.step1.b3_strong", "Punter IQ ladder."),
    safeT("home.step1.b3_body", "Each prediction is timestamped and signed (a VStamp). Your record is yours, transferable across syndicates."),
    safeT("home.step1.cta", "Build my bracket"),
    safeT("home.step2.tag", "Step 2 · Bring your friends"),
    safeT("home.step2.headline", "Run a pool. Brand it your way."),
    safeT("home.step2.claim", "The only World Cup prediction platform where anyone can launch a fully branded, embeddable pool with custom prize splits and verifiable on-chain settlement, in minutes."),
    safeT("home.step2.lede", "A pool is your own branded prediction pool. Pick a name, drop the embed widget on any site (Squarespace, WordPress, Shopify, your blog), and run a six-week sweepstake for your audience. Set an entry fee and prize splits, or keep it free for bragging rights. Tournamental never touches the money."),
    safeT("home.step2.cta_note", "See the embed widget, snippet, and prize-split mechanics on the pools page."),
    safeT("home.tier_free.tag", "Free forever"),
    safeT("home.tier_free.name", "Branded embed widget"),
    safeT("home.tier_free.b1", "Drop one snippet on any site, any CMS"),
    safeT("home.tier_free.b2", "Brand it with your logo, colours, prize copy"),
    safeT("home.tier_free.b3", "Country + city + global leaderboard slices"),
    safeT("home.tier_free.b4", "Off-platform entry money (you handle the cash)"),
    safeT("home.tier_free.b5", "Sponsor block on every share card"),
    safeT("home.tier_free.cta", "Start free in 60 seconds"),
    safeT("home.tier_premium.tag_prefix", "Premium · powered by"),
    safeT("home.tier_premium.price_sub", "/ month + usage"),
    safeT("home.tier_premium.b1", "Everything in Free"),
    safeT("home.tier_premium.b2", "Fully-managed HighLevel CRM sub-account"),
    safeT("home.tier_premium.b3", "Your own phone number for SMS + WhatsApp at scale"),
    safeT("home.tier_premium.b4", "Stripe Checkout for paid entries (funds to your bank)"),
    safeT("home.tier_premium.b5", "Subdomain hosting + footer-free embed"),
    safeT("home.tier_premium.cta", "See what premium unlocks"),
    safeT("home.tier_aside", "Premium tier is delivered by Growth Spurt, our CRM and messaging partner. Tournamental never handles entry fees or prize money."),
    safeT("home.features.headline", "Why people stay"),
    safeT("home.features.f1_title", "Verifiable predictions"),
    safeT("home.features.f1_body", "Every pick gets a cryptographic VStamp before kickoff. Your record is portable, public, and yours for life."),
    safeT("home.features.f2_title", "Free, open, no lock-in"),
    safeT("home.features.f2_body", "Apache 2.0 code, CC-BY docs, contributor revenue share via Drips. Fork it, host it yourself, or stay with us."),
    safeT("home.features.f3_title", "Daily engagement"),
    safeT("home.features.f3_body", "Match-day quizzes, line bets, score-input games via the Telegram bot. Six weeks of touchpoints, not five minutes of form-fill."),
    safeT("home.features.f4_title", "Built on global data"),
    safeT("home.features.f4_body", "StatsBomb open data, Polymarket odds, public team data. We pay our data sources; they share in upside."),
    safeT("home.final.headline", "Three steps. Five minutes. Free."),
    safeT("home.final.q1_title", "Set your picks"),
    safeT("home.final.q1_body", "Open the bracket, save your World Cup. Takes about five minutes the first time."),
    safeT("home.final.q2_title", "Track every match"),
    safeT("home.final.q2_body", "The FIFA World Cup 2026 kicks off 11 June. Save once, change any pick right up to kickoff, watch your prediction IQ climb the global leaderboard."),
    safeT("home.final.q3_title", "Run your own pool"),
    safeT("home.final.q3_body", "Like the experience? Spin up a pool, brand it, invite your friends or your audience. Free or premium."),
    safeT("home.final.cta_primary", "Set your picks now"),
    safeT("home.final.cta_secondary", "Run a pool"),
  ]);
  const [
    headlineA, ctaPredict, ctaPool, lede, ledeLink, readMore,
    headlineB, headlineC, lede2, botArenaLede,
    actionMyPicks, actionSchedule, actionPools, actionLeaderboard,
    countdownEyebrow, countdownTitle,
    statMatches, statTeams, statPerfectBrackets, statClaimToGlory,
    step1Tag, step1Headline, step1Lede,
    step1B1Strong, step1B1Body, step1B2Strong, step1B2Body, step1B3Strong, step1B3Body, step1Cta,
    step2Tag, step2Headline, step2Claim, step2Lede, step2CtaNote,
    tierFreeTag, tierFreeName, tierFreeB1, tierFreeB2, tierFreeB3, tierFreeB4, tierFreeB5, tierFreeCta,
    tierPremiumTagPrefix, tierPremiumPriceSub, tierPremiumB1, tierPremiumB2, tierPremiumB3, tierPremiumB4, tierPremiumB5, tierPremiumCta,
    tierAside,
    featHead, feat1T, feat1B, feat2T, feat2B, feat3T, feat3B, feat4T, feat4B,
    finalHeadline, finalQ1Title, finalQ1Body, finalQ2Title, finalQ2Body, finalQ3Title, finalQ3Body,
    finalCtaPrimary, finalCtaSecondary,
  ] = keys;

  // Split the lede on the {odds_link} placeholder so we can interpolate
  // the inline <Link>. Falls back gracefully when the placeholder is
  // missing, render the bare translated lede.
  const ledeParts = lede.split("{odds_link}");

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
              Tournamental · FIFA World Cup 2026™ · {countdownTitle}
            </p>
            <div className="vt-home-hero-top">
              <h1 className="vt-home-headline">
                <span className="vt-home-hero-line">{headlineA}</span>
                <span className="vt-home-hero-line">{headlineB}</span>
                <span className="vt-home-hero-line">{headlineC}</span>
              </h1>

              {/* Tim 2026-06-05: single lede paragraph replaces the
                * previous "Nobody will correctly predict..." + global
                * ledger pair. The bet page (/the-bet) now carries all
                * the astronomical-odds talk, so the hero just needs to
                * explain WHAT Tournamental is and tease the bet. */}
              <div className="vt-home-hero-lede-stack">
                <p className="vt-home-hero-lede">{botArenaLede}</p>
              </div>

              {/* Tim 2026-06-14: tournament-in-flight quick actions.
                * Sits at the bottom of the hero, overlaid on the
                * banner image. Full-width 2x2 grid on mobile, 4-up
                * row on desktop. Monochrome icons match the drawer
                * + dock so the visual language is consistent. */}
              <nav
                className="vt-home-hero-actions"
                aria-label="Quick actions"
              >
                <Link href="/world-cup-2026" className="vt-home-action-btn">
                  <span className="vt-home-action-icon" aria-hidden="true">
                    <PredictIcon />
                  </span>
                  <span className="vt-home-action-label">{actionMyPicks}</span>
                </Link>
                <Link href="/world-cup-2026/calendar" className="vt-home-action-btn">
                  <span className="vt-home-action-icon" aria-hidden="true">
                    <CalendarIcon />
                  </span>
                  <span className="vt-home-action-label">{actionSchedule}</span>
                </Link>
                <Link href="/pools" className="vt-home-action-btn">
                  <span className="vt-home-action-icon" aria-hidden="true">
                    <GroupsIcon />
                  </span>
                  <span className="vt-home-action-label">{actionPools}</span>
                </Link>
                <Link href="/leaderboard" className="vt-home-action-btn">
                  <span className="vt-home-action-icon" aria-hidden="true">
                    <BarChartIcon />
                  </span>
                  <span className="vt-home-action-label">{actionLeaderboard}</span>
                </Link>
              </nav>
            </div>

            {/* Stats + inline countdown share one row, separated by a
              * full-width hairline. The bet feature card sits directly
              * below the hairline so it lands above the fold on most
              * viewports. (Tim 2026-06-05) */}
            <div className="vt-home-stats-strip">
              <ul className="vt-home-stat-row">
                <li>
                  <span className="vt-home-stat-num">104</span>
                  <span className="vt-home-stat-label">{statMatches}</span>
                </li>
                <li>
                  <span className="vt-home-stat-num">48</span>
                  <span className="vt-home-stat-label">{statTeams}</span>
                </li>
                <li>
                  <span className="vt-home-stat-num">0</span>
                  <span className="vt-home-stat-label">{statPerfectBrackets}</span>
                </li>
                <li>
                  <span className="vt-home-stat-num" aria-hidden="true">?</span>
                  <span className="vt-home-stat-label">{statClaimToGlory}</span>
                </li>
              </ul>
              {/* Tim 2026-06-14: countdown removed now that the
                * tournament is in flight. The stat-strip alone reads
                * cleanly. CountdownBanner import kept for the other
                * surfaces that still use it. */}
            </div>
          </div>
        </section>

        {/* ============== BOT ARENA FEATURE ============== */}
        {/* Tim 2026-06-08: dramatic image-overlay feature card mirroring
          * the bet card pattern but sitting first under the hero stats
          * row. Promotes the perfect-bot-bracket experiment: spawn a
          * swarm of bots in the browser and battle for the bracket.
          * Press release + white paper published 2026-06-07. */}
        <section className="vt-home-section vt-home-section--bots">
          <article className="vt-bots-feature" aria-label="The Bot Arena">
            <div className="vt-bots-feature-bg" aria-hidden="true" />
            <div className="vt-bots-feature-scrim" aria-hidden="true" />
            <div className="vt-bots-feature-inner">
              <div className="vt-bots-feature-text">
                <p className="vt-bots-feature-eyebrow">The Bot Arena</p>
                <h2 className="vt-bots-feature-headline">
                  Send <em>millions of bots</em> into battle.
                </h2>
                <p className="vt-bots-feature-body">
                  Spawn a <strong>swarm of AI bots</strong> in your browser,
                  forge their World Cup brackets, and pit them against
                  every other swarm on Earth. <em>How close can your bots get to perfect?</em>
                </p>
              </div>
              <div className="vt-bots-feature-action">
                <Link href="/bot-arena" className="vt-bots-feature-cta">
                  Enter the Bot Arena <span aria-hidden="true">→</span>
                </Link>
                <a
                  href="/press/tournamental-press-release-2026-06-07.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vt-bots-feature-cta vt-bots-feature-cta--white"
                >
                  Read Press Release <span aria-hidden="true">→</span>
                </a>
                <p className="vt-bots-feature-fine">
                  <Link
                    href="/whitepaper/perfect-bot-bracket"
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    Read the white paper
                  </Link>{" "}
                  · 104 matches · 0 perfect brackets
                </p>
              </div>
            </div>
          </article>
        </section>

        {/* ============== STEP 1, PICKS ============== */}
        {/* Tim 2026-06-08: moved up to sit between the 2-col CTA row
            and the Tournamental? Maybe bet card, so the "Set your picks"
            CTA flows straight into the explainer of what setting picks
            actually means.
          *
          * Reveal-on-scroll wrappers ride the shared motion grammar
            (8-14px rise + opacity, 600ms power3.out, light stagger). They
            replace nothing visible: each section was already visible
            on first paint; the wrapper only opts in once the section
            crosses the viewport edge. Reduced motion makes it a no-op. */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-step" id="picks">
          <div className="vt-home-step-tag">{step1Tag}</div>
          <h2 className="vt-home-h2">{step1Headline}</h2>
          <p className="vt-home-p">{step1Lede}</p>
          <ul className="vt-home-bullets">
            <li><strong>{step1B1Strong}</strong> {step1B1Body}</li>
            <li><strong>{step1B2Strong}</strong> {step1B2Body}</li>
            <li><strong>{step1B3Strong}</strong> {step1B3Body}</li>
          </ul>
          <div className="vt-home-cta-row">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              {step1Cta} →
            </Link>
          </div>
        </RevealOnScroll>

        {/* ============== BET FEATURE ============== */}
        {/* Tim 2026-06-05: dramatic image-overlay feature card. Was
          * directly below the hero stats row; as of 2026-06-08 it sits
          * after the Step 1 picks block so the "set picks" CTA flows
          * naturally into the "and by the way, here's my house on the
          * line" hook. */}
        {/* Tim 2026-06-12: bet feature card hidden from the home page.
          * The /the-bet page itself stays live (still reachable via direct
          * URL) but no longer surfaces here or in the nav, while the WC26
          * marketing tone shifts away from the house-wager hook for the
          * tournament-window push. To restore, uncomment this section and
          * re-add the nav entries in components/shell/nav-links.tsx.
          */}

        {/* Step 2 (3D Molecule watch-along) and the Watch demo CTAs were
         * dropped on 2026-05-21, play app is bracket-only for the
         * 2026 WC push; the molecule still works on /world-cup-2026/molecule
         * but it's no longer promoted from the player surfaces. */}

        {/* ============== STEP 2, SYNDICATES (FRONT AND CENTRE) ============== */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-step vt-home-step-syndicates" id="syndicates">
          <div className="vt-home-step-tag vt-home-step-tag-headline">{step2Tag}</div>
          <h2 className="vt-home-h2">{step2Headline}</h2>
          <p className="vt-home-claim">{step2Claim}</p>
          <p className="vt-home-p">{step2Lede}</p>

          <div className="vt-home-demo-cta">
            <Link
              href="/syndicates"
              className="vt-home-btn vt-home-btn-light vt-home-demo-cta-btn"
            >
              {ctaPool}
            </Link>
            <p className="vt-home-demo-cta-note">{step2CtaNote}</p>
          </div>

          {/* Tiered pitch */}
          <div className="vt-home-tiers">
            <div className="vt-home-tier">
              <span className="vt-home-tier-tag">{tierFreeTag}</span>
              <h3 className="vt-home-tier-name">{tierFreeName}</h3>
              <ul className="vt-home-tier-list">
                <li>{tierFreeB1}</li>
                <li>{tierFreeB2}</li>
                <li>{tierFreeB3}</li>
                <li>{tierFreeB4}</li>
                <li>{tierFreeB5}</li>
              </ul>
              <Link href="/pools/new" className="vt-home-btn vt-home-btn-primary vt-home-btn-block">
                {tierFreeCta} →
              </Link>
            </div>
            <div className="vt-home-tier vt-home-tier-premium">
              <span className="vt-home-tier-tag vt-home-tier-tag-premium">
                {tierPremiumTagPrefix}{" "}
                <a
                  href="https://growthspurt.agency"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vt-home-tier-tag-link"
                >
                  Growth Spurt
                </a>
              </span>
              <h3 className="vt-home-tier-name">$97 <span className="vt-home-tier-price-sub">{tierPremiumPriceSub}</span></h3>
              <ul className="vt-home-tier-list">
                <li>{tierPremiumB1}</li>
                <li>{tierPremiumB2}</li>
                <li>{tierPremiumB3}</li>
                <li>{tierPremiumB4}</li>
                <li>{tierPremiumB5}</li>
              </ul>
              <Link href="/pools#pricing" className="vt-home-btn vt-home-btn-ghost vt-home-btn-block">
                {tierPremiumCta}
              </Link>
            </div>
          </div>

          <p className="vt-home-aside">{tierAside}</p>
        </RevealOnScroll>

        {/* ============== FEATURES STRIP ============== */}
        <RevealOnScroll as="section" className="vt-home-section">
          <h2 className="vt-home-h2 vt-home-h2-centred">{featHead}</h2>
          <div className="vt-home-feature-grid">
            <div className="vt-home-feature">
              <h3>{feat1T}</h3>
              <p>{feat1B}</p>
            </div>
            <div className="vt-home-feature">
              <h3>{feat2T}</h3>
              <p>{feat2B}</p>
            </div>
            <div className="vt-home-feature">
              <h3>{feat3T}</h3>
              <p>{feat3B}</p>
            </div>
            <div className="vt-home-feature">
              <h3>{feat4T}</h3>
              <p>{feat4B}</p>
            </div>
          </div>
        </RevealOnScroll>

        {/* ============== FINAL CTA ============== */}
        <RevealOnScroll as="section" className="vt-home-section vt-home-final-cta">
          <h2 className="vt-home-h2 vt-home-h2-centred">{finalHeadline}</h2>
          <ol className="vt-home-quickstart">
            <li>
              <span className="vt-home-qs-n">1</span>
              <div>
                <h3>{finalQ1Title}</h3>
                <p>{finalQ1Body}</p>
              </div>
            </li>
            <li>
              <span className="vt-home-qs-n">2</span>
              <div>
                <h3>{finalQ2Title}</h3>
                <p>{finalQ2Body}</p>
              </div>
            </li>
            <li>
              <span className="vt-home-qs-n">3</span>
              <div>
                <h3>{finalQ3Title}</h3>
                <p>{finalQ3Body}</p>
              </div>
            </li>
          </ol>
          <div className="vt-home-cta-row vt-home-cta-row-centred">
            <Link href="/world-cup-2026" className="vt-home-btn vt-home-btn-primary">
              {finalCtaPrimary} →
            </Link>
            <Link href="/pools" className="vt-home-btn vt-home-btn-ghost">
              {finalCtaSecondary}
            </Link>
          </div>
        </RevealOnScroll>
      </main>
    </AppShell>
  );
}
