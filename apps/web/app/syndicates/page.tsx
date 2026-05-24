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
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/shell";
import { RouteEvent } from "@/components/analytics/RouteEvent";

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

export const dynamic = "force-dynamic";

import { LiveWidgetDemo } from "./LiveWidgetDemo";
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

export default async function SyndicatesIndexPage(): Promise<JSX.Element> {
  const [
    title,
    eyebrow,
    hero_title,
    hero_claim,
    hero_lede,
    quickstart_step1,
    quickstart_step2,
    quickstart_step3,
    quickstart_time,
    cta_primary,
    cta_secondary,
    trust_no_card,
    trust_no_app,
    trust_open_source,
    trust_nz_built,
    usecases_title,
    usecases_aside,
    flow_title,
    flow_step1_n,
    flow_step1_title,
    flow_step1_body,
    flow_step2_n,
    flow_step2_title,
    flow_step2_body,
    flow_step3_n,
    flow_step3_title,
    flow_step3_body,
    pricing_title,
    tier_free_eyebrow,
    tier_free_name,
    tier_free_blurb,
    tier_free_cta,
    tier_free_footer,
    tier_premium_eyebrow,
    tier_premium_price,
    tier_premium_price_sub,
    tier_premium_blurb_prefix,
    tier_premium_blurb_middle,
    tier_premium_cta,
    pricing_aside,
    embed_title,
    embed_intro,
    embed_badge,
    embed_snippet_intro,
    embed_aside,
    faq_title,
    faq_q1,
    faq_a1,
    faq_q2,
    faq_a2,
    faq_q3,
    faq_a3,
    faq_q4,
    faq_a4,
    faq_q5,
    faq_a5,
    faq_q6,
    faq_a6,
    faq_q7,
    faq_a7,
    faq_q8,
    faq_a8,
    faq_github_link,
    cta_final_title,
    cta_final_body,
    card_prize_label,
  ] = await Promise.all([
    safeT("syndicates.page_title", "Pools"),
    safeT("syndicates_page.eyebrow", "Syndicates · Free forever"),
    safeT("syndicates_page.hero_title", "The whole tournament, gamified for your audience."),
    safeT("syndicates_page.hero_claim", "The only World Cup prediction platform where anyone can launch a fully branded, embeddable syndicate with custom prize splits and verifiable on-chain settlement in minutes."),
    safeT("syndicates_page.hero_lede", "A syndicate is your own branded prediction pool. Drop the embed widget on any site, run a six-week game with your own prize. Free forever; premium adds a fully-managed CRM, your own messaging, and paid-entry handling."),
    safeT("syndicates_page.quickstart_step1", "Pick your slug"),
    safeT("syndicates_page.quickstart_step2", "Paste the embed"),
    safeT("syndicates_page.quickstart_step3", "Invite your audience"),
    safeT("syndicates_page.quickstart_time", "≈ 60 seconds"),
    safeT("syndicates_page.cta_primary", "Start free in 60 seconds →"),
    safeT("syndicates_page.cta_secondary", "Read the playbook"),
    safeT("syndicates_page.trust_no_card", "No credit card"),
    safeT("syndicates_page.trust_no_app", "No app install"),
    safeT("syndicates_page.trust_open_source", "Apache 2.0 open source"),
    safeT("syndicates_page.trust_nz_built", "NZ-built"),
    safeT("syndicates_page.usecases_title", "Six audiences, six prize models"),
    safeT("syndicates_page.usecases_aside", "Each scenario gets a recruit-email template, week-by-week run-of-show, sponsor-pitch template, and prize-structure menu in the syndicate playbook."),
    safeT("syndicates_page.flow_title", "How it lands on your audience"),
    safeT("syndicates_page.flow_step1_n", "01"),
    safeT("syndicates_page.flow_step1_title", "Drop the widget"),
    safeT("syndicates_page.flow_step1_body", "One script tag on any page. Squarespace, WordPress, Shopify, Webflow, or hand-rolled HTML. Renders your branded bracket, leaderboard, and sign-up form inline."),
    safeT("syndicates_page.flow_step2_n", "02"),
    safeT("syndicates_page.flow_step2_title", "Members join in seconds"),
    safeT("syndicates_page.flow_step2_body", "They enter on your site, no bounce to ours. We create the account, save their picks, surface them on your leaderboard."),
    safeT("syndicates_page.flow_step3_n", "03"),
    safeT("syndicates_page.flow_step3_title", "Engage every match-day"),
    safeT("syndicates_page.flow_step3_body", "Daily reminders, leaderboard climbs, share cards, and the 3D watch-along run for six weeks. Premium adds your own SMS/WhatsApp/email via your CRM."),
    safeT("syndicates_page.pricing_title", "Freemium, on purpose"),
    safeT("syndicates_page.tier_free.eyebrow", "Free"),
    safeT("syndicates_page.tier_free.name", "Branded embed"),
    safeT("syndicates_page.tier_free.blurb", "Embed the widget on any site you own. Leaderboards, share cards, prediction game. Forever free."),
    safeT("syndicates_page.tier_free.cta", "Start free →"),
    safeT("syndicates_page.tier_free.footer", "No credit card. Cancel anytime (it's free)."),
    safeT("syndicates_page.tier_premium.eyebrow", "Premium · powered by Aiva"),
    safeT("syndicates_page.tier_premium.price", "$97"),
    safeT("syndicates_page.tier_premium.price_sub", "/ month + usage"),
    safeT("syndicates_page.tier_premium.blurb_prefix", "Our CRM partner"),
    safeT("syndicates_page.tier_premium.blurb_middle", "provisions a dedicated HighLevel sub-account, pre-configured for Tournamental-style workflows. BYO HighLevel via Aiva's affiliate link is supported."),
    safeT("syndicates_page.tier_premium.cta", "See what premium unlocks"),
    safeT("syndicates_page.pricing_aside", "Premium tier is delivered by Aiva. Tournamental never handles entry fees or prize money; Stripe sits inside your CRM sub-account and funds settle directly to your bank."),
    safeT("syndicates_page.embed_title", "One snippet, any site"),
    safeT("syndicates_page.embed_intro", "Drop these two lines anywhere on your site. The widget reads your syndicate slug, fetches your branding, and renders. Here's the same widget running against a demo syndicate, live on this page:"),
    safeT("syndicates_page.embed_badge", "Live preview"),
    safeT("syndicates_page.embed_snippet_intro", "That widget is rendered by exactly this snippet (substitute your slug):"),
    safeT("syndicates_page.embed_aside", "Works on Squarespace, WordPress, Wix, Shopify, Webflow, and any custom site. No iframe required, no host-CSS bleed, cached at the edge."),
    safeT("syndicates_page.faq_title", "Common questions"),
    safeT("syndicates_page.faq_q1", "Is it really free? What's the catch?"),
    safeT("syndicates_page.faq_a1", "Genuinely free, no card needed, no trial timer. You can run a syndicate, brand it, embed it, and watch your audience play for the whole tournament without paying us a cent. Premium ($97/mo via Aiva) is an optional upgrade for hosts who want a managed CRM, paid entries via Stripe, and outbound SMS / WhatsApp at scale. Most syndicates run free forever."),
    safeT("syndicates_page.faq_q2", "How do members find my syndicate?"),
    safeT("syndicates_page.faq_a2", "Two ways. Either you embed the widget on your site (Squarespace, WordPress, Shopify, custom) and members join straight from your page, or you share the public landing link (play.tournamental.com/s/yourname) directly on social, email, group chats, posters. Most hosts do both."),
    safeT("syndicates_page.faq_q3", "Do my members need a Tournamental account?"),
    safeT("syndicates_page.faq_a3", "They sign up via your widget or landing page with email or phone. The experience is yours; the technology is ours. No app install required."),
    safeT("syndicates_page.faq_q4", "Who handles the prize money?"),
    safeT("syndicates_page.faq_a4", "You do, always. Tournamental does not touch money. On free, you settle however you already do (PayPal, bank transfer, an envelope at the post-final pub). On premium, Aiva's HighLevel sub-account gives you a Stripe-Connect checkout and the funds land in your bank account directly. We never have custody."),
    safeT("syndicates_page.faq_q5", "Can I brand the widget without paying?"),
    safeT("syndicates_page.faq_a5", "Yes. Logo, colours, hero image, prize copy, and a sponsor block are all free. Premium removes the small 'Powered by Tournamental' footer and adds the managed CRM on top."),
    safeT("syndicates_page.faq_q6", "Can I run this for tournaments other than the World Cup?"),
    safeT("syndicates_page.faq_a6", "Soon. Six Nations, Cricket World Cup, college brackets, your office annual ladder, the same toolkit applies. The World Cup 2026 setup is the launch tournament; new ones light up as the seasons roll."),
    safeT("syndicates_page.faq_q7", "What if I cancel premium?"),
    safeT("syndicates_page.faq_a7", "Your syndicate stays live on the free tier. Your members are yours. Aiva keeps your CRM data accessible for 30 days so you can export it. There is no lock-in."),
    safeT("syndicates_page.faq_q8", "Is the code open source?"),
    safeT("syndicates_page.faq_a8", "Yes, Apache 2.0. The whole platform is in the public GitHub repo. Contributors share platform revenue via the Drips Network."),
    safeT("syndicates_page.faq_github_link", "public GitHub repo"),
    safeT("syndicates_page.cta_final_title", "Bring your tournament"),
    safeT("syndicates_page.cta_final_body", "Office, friends, fan club, school, store, creator audience. Same toolkit. 60 seconds to a branded path. Free forever."),
    safeT("syndicates_page.card_prize_label", "Sample prize"),
  ]);

  return (
    <AppShell title={title} showBottomNav>
      <RouteEvent name="page.view" />

      <div className="vt-syndicates-page">
        {/* Hero */}
        <section className="vt-syndicates-hero">
          <span className="vt-syndicates-eyebrow">{eyebrow}</span>
          <h1 className="vt-syndicates-title">{hero_title}</h1>
          <p className="vt-syndicates-claim">
            {hero_claim}
          </p>
          <p className="vt-syndicates-lede">
            {hero_lede}
          </p>

          {/* The 60-second start strip */}
          <div className="vt-syndicates-quickstart">
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">1</span>
              <span>{quickstart_step1}</span>
            </div>
            <div className="vt-syndicates-qs-arrow">→</div>
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">2</span>
              <span>{quickstart_step2}</span>
            </div>
            <div className="vt-syndicates-qs-arrow">→</div>
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">3</span>
              <span>{quickstart_step3}</span>
            </div>
            <div className="vt-syndicates-qs-time">{quickstart_time}</div>
          </div>

          <div className="vt-syndicates-cta-row">
            <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
              {cta_primary}
            </Link>
            <Link href="/syndicates/playbook" className="vt-syndicates-cta-ghost">
              {cta_secondary}
            </Link>
          </div>

          {/* Reassurance row */}
          <ul className="vt-syndicates-trust-row">
            <li><span aria-hidden="true">✓</span> {trust_no_card}</li>
            <li><span aria-hidden="true">✓</span> {trust_no_app}</li>
            <li><span aria-hidden="true">✓</span> {trust_open_source}</li>
            <li><span aria-hidden="true">✓</span> {trust_nz_built}</li>
          </ul>
        </section>

        {/* Use cases */}
        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">{usecases_title}</h2>
          <ul className="vt-syndicates-grid">
            {USE_CASES.map((uc) => (
              <li key={uc.title} className="vt-syndicates-card">
                <span className="vt-syndicates-card-icon" aria-hidden="true">{uc.icon}</span>
                <h3 className="vt-syndicates-card-title">{uc.title}</h3>
                <p className="vt-syndicates-card-body">{uc.body}</p>
                <p className="vt-syndicates-card-prize-label">{card_prize_label}</p>
                <p className="vt-syndicates-card-prize">{uc.prize}</p>
              </li>
            ))}
          </ul>
          <p className="vt-syndicates-aside">
            {usecases_aside}{" "}
            <Link href="/syndicates/playbook" className="vt-syndicates-link">syndicate playbook</Link>.
          </p>
        </section>

        {/* How it lands */}
        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">{flow_title}</h2>
          <ol className="vt-syndicates-steps">
            <li>
              <span className="vt-syndicates-step-n">{flow_step1_n}</span>
              <div>
                <h3 className="vt-syndicates-step-title">{flow_step1_title}</h3>
                <p className="vt-syndicates-step-body">
                  {flow_step1_body}
                </p>
              </div>
            </li>
            <li>
              <span className="vt-syndicates-step-n">{flow_step2_n}</span>
              <div>
                <h3 className="vt-syndicates-step-title">{flow_step2_title}</h3>
                <p className="vt-syndicates-step-body">
                  {flow_step2_body}
                </p>
              </div>
            </li>
            <li>
              <span className="vt-syndicates-step-n">{flow_step3_n}</span>
              <div>
                <h3 className="vt-syndicates-step-title">{flow_step3_title}</h3>
                <p className="vt-syndicates-step-body">
                  {flow_step3_body}
                </p>
              </div>
            </li>
          </ol>
        </section>

        {/* Pricing */}
        <section className="vt-syndicates-section" id="pricing">
          <h2 className="vt-syndicates-section-title">{pricing_title}</h2>
          <div className="vt-syndicates-tiers">
            <div className="vt-syndicates-tier">
              <p className="vt-syndicates-tier-eyebrow">{tier_free_eyebrow}</p>
              <h3 className="vt-syndicates-tier-name">{tier_free_name}</h3>
              <p className="vt-syndicates-tier-blurb">
                {tier_free_blurb}
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
                {tier_free_cta}
              </Link>
              <p className="vt-syndicates-tier-foot">{tier_free_footer}</p>
            </div>

            <div className="vt-syndicates-tier vt-syndicates-tier-premium">
              <p className="vt-syndicates-tier-eyebrow">{tier_premium_eyebrow}</p>
              <h3 className="vt-syndicates-tier-name">
                {tier_premium_price} <span className="vt-syndicates-tier-price-sub">{tier_premium_price_sub}</span>
              </h3>
              <p className="vt-syndicates-tier-blurb">
                {tier_premium_blurb_prefix} <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-syndicates-link">Aiva</a>{" "}
                {tier_premium_blurb_middle}
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
                {tier_premium_cta}
              </Link>
            </div>
          </div>
          <p className="vt-syndicates-aside">
            Premium tier is delivered by{" "}
            <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-syndicates-link">Aiva</a>.
            {" "}{pricing_aside}
          </p>
        </section>

        {/* Embed snippet preview + live demo widget */}
        <section className="vt-syndicates-section" id="embed">
          <h2 className="vt-syndicates-section-title">{embed_title}</h2>
          <p className="vt-syndicates-card-body" style={{ maxWidth: "64ch" }}>
            {embed_intro}
          </p>

          <div className="vt-syndicates-demo-wrap">
            <div className="vt-syndicates-demo-badge">{embed_badge}</div>
            <LiveWidgetDemo slug="tournamental-demo" />
          </div>

          <div className="vt-syndicates-snippet-wrap">
            <p className="vt-syndicates-card-body">
              {embed_snippet_intro}
            </p>
            <pre className="vt-syndicates-snippet">
              <code>{`<tournamental-syndicate slug="your-syndicate"></tournamental-syndicate>
<script src="https://play.tournamental.com/widget.js" async></script>`}</code>
            </pre>
            <p className="vt-syndicates-aside">
              {embed_aside}
            </p>
          </div>
        </section>

        {/* Common questions */}
        <section className="vt-syndicates-section">
          <h2 className="vt-syndicates-section-title">{faq_title}</h2>
          <div className="vt-syndicates-faq">
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q1}</summary>
              <p>
                {faq_a1}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q2}</summary>
              <p>
                {faq_a2}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q3}</summary>
              <p>
                {faq_a3}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q4}</summary>
              <p>
                {faq_a4}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q5}</summary>
              <p>
                {faq_a5}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q6}</summary>
              <p>
                {faq_a6}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q7}</summary>
              <p>
                {faq_a7}
              </p>
            </details>
            <details className="vt-syndicates-faq-item">
              <summary>{faq_q8}</summary>
              <p>
                {faq_a8}{" "}
                <a href="https://github.com/0800tim/tournamental" target="_blank" rel="noreferrer" className="vt-syndicates-link">
                  {faq_github_link}
                </a>
                . Contributors share platform revenue via the Drips Network.
              </p>
            </details>
          </div>
        </section>

        {/* Final CTA */}
        <section className="vt-syndicates-section vt-syndicates-cta-block">
          <h2 className="vt-syndicates-section-title">{cta_final_title}</h2>
          <p className="vt-syndicates-cta-body">
            {cta_final_body}
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
