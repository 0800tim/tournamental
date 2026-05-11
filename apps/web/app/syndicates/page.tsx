/**
 * /syndicates, the Play-app entry to the syndicate system.
 *
 * Replaces the old 404. Lets a user browse the use-cases, jump to
 * /syndicates/new to create one, or visit an existing public syndicate
 * via /s/<slug>. The marketing site keeps its own /syndicates pitch
 * page at tournamental.com/syndicates for the SEO + first-touch angle;
 * this page is the in-app destination once they're logged in.
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
  title: "Syndicates, Tournamental",
  description:
    "Run your own World Cup prediction pool. Office sweepstakes, friend pools, creator groups, fan clubs. Free, branded, scored automatically.",
  openGraph: {
    title: "Syndicates, Tournamental",
    description: "Anyone can host. Anyone can join. Bring your tournament.",
    images: ["/og/syndicates.png"],
    type: "website",
  },
};

export const revalidate = 300;

const USE_CASES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Office sweepstake",
    body: "Twelve people, one ladder, $10 entry, the usual. Pin your path in the channel and stop chasing predictions on the back of an envelope.",
  },
  {
    title: "Friends WhatsApp pool",
    body: "The chat where you've been calling matches for years finally has a permanent record. Top-of-table earns rights for the whole next tournament.",
  },
  {
    title: "Creator / influencer group",
    body: "Run a public syndicate under your own brand. Followers join, predict, share. You earn referral credit and surface your own affiliate links.",
  },
  {
    title: "Fan club / supporters trust",
    body: "Five hundred members, one season-long ladder, club-coloured branding. Tickets and merch as rewards. Settle the prize draw verifiably on-chain when phase 2 ships.",
  },
];

const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Custom path",
    body: "play.tournamental.com/s/yourname. Fuzzy matching catches typos. Reserved words like NBA / UFC / WorldCup are protected.",
  },
  {
    title: "Custom branding",
    body: "Logo, colours, tagline. Surfaces on every leaderboard, share card, and digest.",
  },
  {
    title: "Format flexibility",
    body: "Winner-takes-all, podium, season ladder, knockout. Toggle as the tournament evolves.",
  },
  {
    title: "Off-platform settlement",
    body: "You handle the money however you already do. We track scores; the cash is between you.",
  },
  {
    title: "Auto-share",
    body: "Goal clips, leaderboard climbs, badges, share cards land in your members' inboxes automatically.",
  },
  {
    title: "Bulk invite",
    body: "Telegram, WhatsApp, CSV. Onboarding in seconds via the bot of their choice.",
  },
];

export default function SyndicatesIndexPage(): JSX.Element {
  return (
    <AppShell title="Syndicates" showBottomNav>
      <RouteEvent name="page.view" />

      <div className="vt-syndicates-page">
        <section className="vt-syndicates-hero">
          <span className="vt-syndicates-eyebrow">Syndicates</span>
          <h1 className="vt-syndicates-title">Anyone can host. Anyone can join.</h1>
          <p className="vt-syndicates-lede">
            A syndicate is your private Tournamental. Your branding, your
            members, your scoring rules. Free to run. Real-money handled
            offline by you. We never touch funds we are not authorised to hold.
          </p>
          <div className="vt-syndicates-cta-row">
            <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
              Create a syndicate
            </Link>
            <a
              href="https://tournamental.com/syndicates"
              target="_blank"
              rel="noreferrer"
              className="vt-syndicates-cta-ghost"
            >
              Read the full pitch
            </a>
          </div>
        </section>

        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">Who uses syndicates</h2>
          <ul className="vt-syndicates-grid">
            {USE_CASES.map((uc) => (
              <li key={uc.title} className="vt-syndicates-card">
                <h3 className="vt-syndicates-card-title">{uc.title}</h3>
                <p className="vt-syndicates-card-body">{uc.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">What you get</h2>
          <ul className="vt-syndicates-grid vt-syndicates-grid-tight">
            {FEATURES.map((f) => (
              <li key={f.title} className="vt-syndicates-card vt-syndicates-card-compact">
                <h3 className="vt-syndicates-card-title">{f.title}</h3>
                <p className="vt-syndicates-card-body">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="vt-syndicates-section vt-syndicates-directory">
          <h2 className="vt-syndicates-section-title">Public directory</h2>
          <div className="vt-syndicates-empty">
            <p>
              The public syndicate directory is opening as syndicates go live.
              Be the first up there.
            </p>
            <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
              Create the first one
            </Link>
          </div>
        </section>

        <section className="vt-syndicates-section vt-syndicates-cta-block">
          <h2 className="vt-syndicates-section-title">Bring your tournament</h2>
          <p className="vt-syndicates-cta-body">
            Office, friends, fan club, creator audience. Same toolkit. 60
            seconds to a branded path. Free forever.
          </p>
          <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
            Create a syndicate
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
