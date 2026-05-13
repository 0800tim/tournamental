/* eslint-disable react/no-unescaped-entities */
/**
 * /syndicates, the Play-app entry to the syndicate system.
 *
 * Now the primary marketing surface for syndicates (the tournamental.com
 * /syndicates page is a light-touch landing that links here). Covers
 * the freemium pitch, six audience use-cases with sample prizes, the
 * Free vs Premium tier comparison, and the embed-widget snippet.
 *
 * The Aiva premium tier is named explicitly; pricing copy points to the
 * Aiva partner page at https://tournamental.com/partners/aiva.
 *
 * Cache: revalidate every 5 minutes so a freshly-created public
 * syndicate shows up in the directory without a manual rebuild.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/shell";
import { RouteEvent } from "@/components/analytics/RouteEvent";

import "./syndicates.css";

export const metadata: Metadata = {
  title: "Syndicates · Tournamental",
  description:
    "Run your own World Cup prediction pool. Office sweepstakes, e-commerce engagement campaigns, radio sponsorships, school fundraisers, creator audiences. Free branded embed widget; premium tier delivered by Aiva.",
  openGraph: {
    title: "Syndicates · Tournamental",
    description: "Anyone can host. Anyone can join. Free embed widget on any site; premium adds a fully-managed CRM via Aiva.",
    images: ["/og/syndicates.png"],
    type: "website",
  },
};

export const revalidate = 300;

const USE_CASES: ReadonlyArray<{
  icon: string;
  title: string;
  body: string;
  prize: string;
}> = [
  {
    icon: "🛒",
    title: "E-commerce store",
    body: "Six weeks of customer engagement with no sport-knowledge required. Winner gets a store voucher. Picks-saved climbs in your storefront via the embed widget.",
    prize: "$250 store voucher",
  },
  {
    icon: "📻",
    title: "Radio station",
    body: "Sponsor-funded prize draw with daily on-air mentions. Hosts call out the leaderboard each morning. One sponsor logo on every share card.",
    prize: "Bluetooth speaker + coffee subscription",
  },
  {
    icon: "⚽",
    title: "Football club",
    body: "Member-only ladder for the senior squad's tournament watch-along. Tickets, signed merch, clubhouse-day presentation for the leader.",
    prize: "Season-ticket upgrade + signed kit",
  },
  {
    icon: "🎓",
    title: "School fundraiser",
    body: "Parents enter $10 each, all proceeds to the school. Local business sponsors the prize pack. Predictable fundraising plus sponsor goodwill.",
    prize: "Sponsored bundle; fees to the school",
  },
  {
    icon: "🏢",
    title: "Workplace bracket",
    body: "Twelve floors, one ladder, $10 entry. Pin the bracket in the team channel. CEO presents the cheque at the post-final lunch.",
    prize: "Pooled entry money",
  },
  {
    icon: "🎤",
    title: "Creator / influencer",
    body: "Public syndicate under your own brand. One sponsor underwrites the whole tournament's content. Logo on every share card.",
    prize: "Sponsored bundle; you keep the fee",
  },
];

const FREE_FEATURES: readonly string[] = [
  "Branded embed widget for any site",
  "Custom path: play.tournamental.com/s/yourname",
  "Logo, colours, hero image, prize copy",
  "Member sign-up with consent-first capture",
  "Country, city, and global leaderboard slices",
  "3D match watch-along and the full game",
  "Share cards for every member and climb",
  "CSV export of opted-in members",
];

const PREMIUM_FEATURES: readonly string[] = [
  "Everything in Free",
  "Dedicated HighLevel CRM sub-account, managed by Aiva",
  "Your own number for SMS and WhatsApp at scale",
  "Email campaigns, nurture workflows, behavioural triggers",
  "Stripe Checkout for paid entries (funds to your bank)",
  "Subdomain hosting: yourname.tournamental.com",
  "Member-level analytics dashboard",
  "Remove the Tournamental footer from your embed",
  "Priority support + onboarding call",
];

export default function SyndicatesIndexPage(): JSX.Element {
  return (
    <AppShell title="Syndicates" showBottomNav>
      <RouteEvent name="page.view" />

      <div className="vt-syndicates-page">
        {/* Hero */}
        <section className="vt-syndicates-hero">
          <span className="vt-syndicates-eyebrow">Syndicates</span>
          <h1 className="vt-syndicates-title">The whole tournament, gamified for your audience.</h1>
          <p className="vt-syndicates-lede">
            A syndicate is your own branded prediction pool. Drop the embed widget on any site,
            run a six-week game with your own prize. Free forever; premium adds a fully-managed
            CRM, your own messaging, and paid-entry handling.
          </p>
          <div className="vt-syndicates-cta-row">
            <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
              Create a syndicate
            </Link>
            <Link href="/syndicates/playbook" className="vt-syndicates-cta-ghost">
              Read the playbook →
            </Link>
          </div>
        </section>

        {/* Use cases */}
        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">Six audiences, six prize models</h2>
          <ul className="vt-syndicates-grid">
            {USE_CASES.map((uc) => (
              <li key={uc.title} className="vt-syndicates-card">
                <span className="vt-syndicates-card-icon" aria-hidden="true">{uc.icon}</span>
                <h3 className="vt-syndicates-card-title">{uc.title}</h3>
                <p className="vt-syndicates-card-body">{uc.body}</p>
                <p className="vt-syndicates-card-prize-label">Sample prize</p>
                <p className="vt-syndicates-card-prize">{uc.prize}</p>
              </li>
            ))}
          </ul>
          <p className="vt-syndicates-aside">
            Each scenario gets a recruit-email template, week-by-week run-of-show,
            sponsor-pitch template, and prize-structure menu in the{" "}
            <Link href="/syndicates/playbook" className="vt-syndicates-link">syndicate playbook</Link>.
          </p>
        </section>

        {/* How it lands */}
        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">How it lands on your audience</h2>
          <ol className="vt-syndicates-steps">
            <li>
              <span className="vt-syndicates-step-n">01</span>
              <div>
                <h3 className="vt-syndicates-step-title">Drop the widget</h3>
                <p className="vt-syndicates-step-body">
                  One script tag on any page. Squarespace, WordPress, Shopify,
                  Webflow, or hand-rolled HTML. Renders your branded bracket,
                  leaderboard, and sign-up form inline.
                </p>
              </div>
            </li>
            <li>
              <span className="vt-syndicates-step-n">02</span>
              <div>
                <h3 className="vt-syndicates-step-title">Members join in seconds</h3>
                <p className="vt-syndicates-step-body">
                  They enter on your site, no bounce to ours. We create the
                  account, save their picks, surface them on your leaderboard.
                </p>
              </div>
            </li>
            <li>
              <span className="vt-syndicates-step-n">03</span>
              <div>
                <h3 className="vt-syndicates-step-title">Engage every match-day</h3>
                <p className="vt-syndicates-step-body">
                  Daily reminders, leaderboard climbs, share cards, and the 3D
                  watch-along run for six weeks. Premium adds your own
                  SMS/WhatsApp/email via your CRM.
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* Pricing */}
        <section className="vt-syndicates-section" id="pricing">
          <h2 className="vt-syndicates-section-title">Freemium, on purpose</h2>
          <div className="vt-syndicates-tiers">
            <div className="vt-syndicates-tier">
              <p className="vt-syndicates-tier-eyebrow">Free</p>
              <h3 className="vt-syndicates-tier-name">Branded embed</h3>
              <p className="vt-syndicates-tier-blurb">
                Embed the widget on any site you own. Leaderboards, share cards, prediction game.
                Forever free.
              </p>
              <ul className="vt-syndicates-tier-list">
                {FREE_FEATURES.map((f) => (
                  <li key={f}>
                    <span className="vt-syndicates-tick" aria-hidden="true">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/syndicates/new" className="vt-syndicates-cta-primary vt-syndicates-cta-inline">
                Start free
              </Link>
            </div>

            <div className="vt-syndicates-tier vt-syndicates-tier-premium">
              <p className="vt-syndicates-tier-eyebrow">Premium · powered by Aiva</p>
              <h3 className="vt-syndicates-tier-name">
                $97 <span className="vt-syndicates-tier-price-sub">/ month + usage</span>
              </h3>
              <p className="vt-syndicates-tier-blurb">
                Our CRM partner <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-syndicates-link">Aiva</a>{" "}
                provisions a dedicated HighLevel sub-account, pre-configured for Tournamental-style
                workflows. BYO HighLevel via Aiva's affiliate link is supported.
              </p>
              <ul className="vt-syndicates-tier-list">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f}>
                    <span className="vt-syndicates-tick vt-syndicates-tick-premium" aria-hidden="true">✦</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/syndicates/playbook#premium" className="vt-syndicates-cta-primary vt-syndicates-cta-inline">
                See what premium unlocks
              </Link>
            </div>
          </div>
          <p className="vt-syndicates-aside">
            Premium tier is delivered by{" "}
            <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-syndicates-link">Aiva</a>.
            Tournamental never handles entry fees or prize money; Stripe sits inside your CRM
            sub-account and funds settle directly to your bank.
          </p>
        </section>

        {/* Embed snippet preview */}
        <section className="vt-syndicates-section" id="embed">
          <h2 className="vt-syndicates-section-title">One snippet, any site</h2>
          <div className="vt-syndicates-snippet-wrap">
            <p className="vt-syndicates-card-body">
              Drop these two lines anywhere on your site. The widget reads
              your syndicate slug, fetches your branding, and renders.
            </p>
            <pre className="vt-syndicates-snippet">
              <code>{`<tournamental-syndicate slug="your-syndicate"></tournamental-syndicate>
<script src="https://embed.tournamental.com/widget.js" async></script>`}</code>
            </pre>
            <p className="vt-syndicates-aside">
              Works on Squarespace, WordPress, Wix, Shopify, Webflow, and any custom site.
              No iframe required, no host-CSS bleed, cached at the edge.
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <section className="vt-syndicates-section vt-syndicates-cta-block">
          <h2 className="vt-syndicates-section-title">Bring your tournament</h2>
          <p className="vt-syndicates-cta-body">
            Office, friends, fan club, school, store, creator audience. Same toolkit.
            60 seconds to a branded path. Free forever.
          </p>
          <div className="vt-syndicates-cta-row">
            <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
              Create a syndicate
            </Link>
            <Link href="/syndicates/playbook" className="vt-syndicates-cta-ghost">
              Read the playbook
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
