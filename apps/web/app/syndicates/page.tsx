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

import { LiveWidgetDemo } from "./LiveWidgetDemo";
import "./syndicates.css";

export const dynamic = "force-dynamic";

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

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

// USE_CASES keys for i18n lookup
const USE_CASE_KEYS = [
  "ecommerce",
  "radio",
  "football",
  "school",
  "workplace",
  "creator",
] as const;

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

async function UseCasesSection() {
  const [
    title,
    aside,
    playbookLink,
    prizeLabel,
  ] = await Promise.all([
    safeT("syndicates_page.usecases_title", "Six audiences, six prize models"),
    safeT(
      "syndicates_page.usecases_aside",
      "Each scenario gets a recruit-email template, week-by-week run-of-show, sponsor-pitch template, and prize-structure menu in the syndicate playbook."
    ),
    safeT("syndicates_page.usecases_playbook_link", "syndicate playbook"),
    safeT("syndicates_page.card_prize_label", "Sample prize"),
  ]);

  // Load use case translations in parallel
  const useCases = await Promise.all(
    USE_CASE_KEYS.map(async (key) => {
      const [icon, ucTitle, body, prize] = await Promise.all([
        safeT(`syndicates_page.usecase.${key}.icon`, ""),
        safeT(`syndicates_page.usecase.${key}.title`, ""),
        safeT(`syndicates_page.usecase.${key}.body`, ""),
        safeT(`syndicates_page.usecase.${key}.prize`, ""),
      ]);
      return { key, icon, title: ucTitle, body, prize };
    })
  );

  return (
    <section className="vt-syndicates-section">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <ul className="vt-syndicates-grid">
        {useCases.map((uc) => (
          <li key={uc.key} className="vt-syndicates-card">
            <span className="vt-syndicates-card-icon" aria-hidden="true">
              {uc.icon}
            </span>
            <h3 className="vt-syndicates-card-title">{uc.title}</h3>
            <p className="vt-syndicates-card-body">{uc.body}</p>
            <p className="vt-syndicates-card-prize-label">{prizeLabel}</p>
            <p className="vt-syndicates-card-prize">{uc.prize}</p>
          </li>
        ))}
      </ul>
      <p className="vt-syndicates-aside">
        {aside}{" "}
        <Link href="/syndicates/playbook" className="vt-syndicates-link">
          {playbookLink}
        </Link>
        .
      </p>
    </section>
  );
}

async function FlowSection() {
  const [
    title,
    step1_n,
    step1_title,
    step1_body,
    step2_n,
    step2_title,
    step2_body,
    step3_n,
    step3_title,
    step3_body,
  ] = await Promise.all([
    safeT("syndicates_page.flow_title", "How it lands on your audience"),
    safeT("syndicates_page.flow_step1_n", "01"),
    safeT("syndicates_page.flow_step1_title", "Drop the widget"),
    safeT(
      "syndicates_page.flow_step1_body",
      "One script tag on any page. Squarespace, WordPress, Shopify, Webflow, or hand-rolled HTML. Renders your branded bracket, leaderboard, and sign-up form inline."
    ),
    safeT("syndicates_page.flow_step2_n", "02"),
    safeT("syndicates_page.flow_step2_title", "Members join in seconds"),
    safeT(
      "syndicates_page.flow_step2_body",
      "They enter on your site, no bounce to ours. We create the account, save their picks, surface them on your leaderboard."
    ),
    safeT("syndicates_page.flow_step3_n", "03"),
    safeT("syndicates_page.flow_step3_title", "Engage every match-day"),
    safeT(
      "syndicates_page.flow_step3_body",
      "Daily reminders, leaderboard climbs, share cards, and the 3D watch-along run for six weeks. Premium adds your own SMS/WhatsApp/email via your CRM."
    ),
  ]);

  return (
    <section className="vt-syndicates-section">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <ol className="vt-syndicates-steps">
        <li>
          <span className="vt-syndicates-step-n">{step1_n}</span>
          <div>
            <h3 className="vt-syndicates-step-title">{step1_title}</h3>
            <p className="vt-syndicates-step-body">{step1_body}</p>
          </div>
        </li>
        <li>
          <span className="vt-syndicates-step-n">{step2_n}</span>
          <div>
            <h3 className="vt-syndicates-step-title">{step2_title}</h3>
            <p className="vt-syndicates-step-body">{step2_body}</p>
          </div>
        </li>
        <li>
          <span className="vt-syndicates-step-n">{step3_n}</span>
          <div>
            <h3 className="vt-syndicates-step-title">{step3_title}</h3>
            <p className="vt-syndicates-step-body">{step3_body}</p>
          </div>
        </li>
      </ol>
    </section>
  );
}

async function PricingSection() {
  const [
    title,
    freeEyebrow,
    freeName,
    freeBlurb,
    freeCta,
    freeFooter,
    premiumEyebrow,
    premiumPrice,
    premiumPriceSub,
    premiumBlurbPrefix,
    premiumBlurbMiddle,
    premiumCta,
    premiumLink,
    pricingAside,
  ] = await Promise.all([
    safeT("syndicates_page.pricing_title", "Freemium, on purpose"),
    safeT("syndicates_page.tier_free.eyebrow", "Free"),
    safeT("syndicates_page.tier_free.name", "Branded embed"),
    safeT(
      "syndicates_page.tier_free.blurb",
      "Embed the widget on any site you own. Leaderboards, share cards, prediction game. Forever free."
    ),
    safeT("syndicates_page.tier_free.cta", "Start free →"),
    safeT("syndicates_page.tier_free.footer", "No credit card. Cancel anytime (it's free)."),
    safeT("syndicates_page.tier_premium.eyebrow", "Premium · powered by Aiva"),
    safeT("syndicates_page.tier_premium.price", "$97"),
    safeT("syndicates_page.tier_premium.price_sub", "/ month + usage"),
    safeT("syndicates_page.tier_premium.blurb_prefix", "Our CRM partner"),
    safeT(
      "syndicates_page.tier_premium.blurb_middle",
      "provisions a dedicated HighLevel sub-account, pre-configured for Tournamental-style workflows. BYO HighLevel via Aiva's affiliate link is supported."
    ),
    safeT("syndicates_page.tier_premium.cta", "See what premium unlocks"),
    safeT("syndicates_page.tier_premium.link", "Aiva"),
    safeT(
      "syndicates_page.pricing_aside",
      "Premium tier is delivered by Aiva. Tournamental never handles entry fees or prize money; Stripe sits inside your CRM sub-account and funds settle directly to your bank."
    ),
  ]);

  const [freeFeatures, premiumFeatures] = await Promise.all([
    Promise.all(
      FREE_FEATURES.map(async (f, idx) => {
        const translated = await safeT(`syndicates_page.tier_free.f${idx + 1}`, f);
        return translated;
      })
    ),
    Promise.all(
      PREMIUM_FEATURES.map(async (f, idx) => {
        const translated = await safeT(`syndicates_page.tier_premium.f${idx + 1}`, f);
        return translated;
      })
    ),
  ]);

  return (
    <section className="vt-syndicates-section" id="pricing">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <div className="vt-syndicates-tiers">
        <div className="vt-syndicates-tier">
          <p className="vt-syndicates-tier-eyebrow">{freeEyebrow}</p>
          <h3 className="vt-syndicates-tier-name">{freeName}</h3>
          <p className="vt-syndicates-tier-blurb">{freeBlurb}</p>
          <ul className="vt-syndicates-tier-list">
            {freeFeatures.map((f) => (
              <li key={f}>
                <span className="vt-syndicates-tick" aria-hidden="true">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/syndicates/new" className="vt-syndicates-cta-primary vt-syndicates-cta-inline">
            {freeCta}
          </Link>
          <p className="vt-syndicates-tier-foot">{freeFooter}</p>
        </div>

        <div className="vt-syndicates-tier vt-syndicates-tier-premium">
          <p className="vt-syndicates-tier-eyebrow">{premiumEyebrow}</p>
          <h3 className="vt-syndicates-tier-name">
            {premiumPrice} <span className="vt-syndicates-tier-price-sub">{premiumPriceSub}</span>
          </h3>
          <p className="vt-syndicates-tier-blurb">
            {premiumBlurbPrefix}{" "}
            <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-syndicates-link">
              {premiumLink}
            </a>{" "}
            {premiumBlurbMiddle}
          </p>
          <ul className="vt-syndicates-tier-list">
            {premiumFeatures.map((f) => (
              <li key={f}>
                <span className="vt-syndicates-tick vt-syndicates-tick-premium" aria-hidden="true">
                  ✦
                </span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/syndicates/playbook#premium" className="vt-syndicates-cta-primary vt-syndicates-cta-inline">
            {premiumCta}
          </Link>
        </div>
      </div>
      <p className="vt-syndicates-aside">
        {pricingAside}
      </p>
    </section>
  );
}

async function EmbedSection() {
  const [
    title,
    intro,
    badge,
    snippetIntro,
    snippet,
    aside,
  ] = await Promise.all([
    safeT("syndicates_page.embed_title", "One snippet, any site"),
    safeT(
      "syndicates_page.embed_intro",
      "Drop these two lines anywhere on your site. The widget reads your syndicate slug, fetches your branding, and renders. Here's the same widget running against a demo syndicate, live on this page:"
    ),
    safeT("syndicates_page.embed_badge", "Live preview"),
    safeT(
      "syndicates_page.embed_snippet_intro",
      "That widget is rendered by exactly this snippet (substitute your slug):"
    ),
    safeT(
      "syndicates_page.embed_snippet",
      `<tournamental-syndicate slug="your-syndicate"></tournamental-syndicate>
<script src="https://play.tournamental.com/widget.js" async></script>`
    ),
    safeT(
      "syndicates_page.embed_aside",
      "Works on Squarespace, WordPress, Wix, Shopify, Webflow, and any custom site. No iframe required, no host-CSS bleed, cached at the edge."
    ),
  ]);

  return (
    <section className="vt-syndicates-section" id="embed">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <p className="vt-syndicates-card-body" style={{ maxWidth: "64ch" }}>
        {intro}
      </p>

      <div className="vt-syndicates-demo-wrap">
        <div className="vt-syndicates-demo-badge">{badge}</div>
        <LiveWidgetDemo slug="tournamental-demo" />
      </div>

      <div className="vt-syndicates-snippet-wrap">
        <p className="vt-syndicates-card-body">{snippetIntro}</p>
        <pre className="vt-syndicates-snippet">
          <code>{snippet}</code>
        </pre>
        <p className="vt-syndicates-aside">{aside}</p>
      </div>
    </section>
  );
}

async function FaqSection() {
  const [
    title,
    q1,
    a1,
    q2,
    a2,
    q3,
    a3,
    q4,
    a4,
    q5,
    a5,
    q6,
    a6,
    q7,
    a7,
    q8,
    a8,
    githubLink,
  ] = await Promise.all([
    safeT("syndicates_page.faq_title", "Common questions"),
    safeT("syndicates_page.faq_q1", "Is it really free? What's the catch?"),
    safeT(
      "syndicates_page.faq_a1",
      "Genuinely free, no card needed, no trial timer. You can run a syndicate, brand it, embed it, and watch your audience play for the whole tournament without paying us a cent. Premium ($97/mo via Aiva) is an optional upgrade for hosts who want a managed CRM, paid entries via Stripe, and outbound SMS / WhatsApp at scale. Most syndicates run free forever."
    ),
    safeT("syndicates_page.faq_q2", "How do members find my syndicate?"),
    safeT(
      "syndicates_page.faq_a2",
      "Two ways. Either you embed the widget on your site (Squarespace, WordPress, Shopify, custom) and members join straight from your page, or you share the public landing link (play.tournamental.com/s/yourname) directly on social, email, group chats, posters. Most hosts do both."
    ),
    safeT("syndicates_page.faq_q3", "Do my members need a Tournamental account?"),
    safeT(
      "syndicates_page.faq_a3",
      "They sign up via your widget or landing page with email or phone. The experience is yours; the technology is ours. No app install required."
    ),
    safeT("syndicates_page.faq_q4", "Who handles the prize money?"),
    safeT(
      "syndicates_page.faq_a4",
      "You do, always. Tournamental does not touch money. On free, you settle however you already do (PayPal, bank transfer, an envelope at the post-final pub). On premium, Aiva's HighLevel sub-account gives you a Stripe-Connect checkout and the funds land in your bank account directly. We never have custody."
    ),
    safeT("syndicates_page.faq_q5", "Can I brand the widget without paying?"),
    safeT(
      "syndicates_page.faq_a5",
      "Yes. Logo, colours, hero image, prize copy, and a sponsor block are all free. Premium removes the small 'Powered by Tournamental' footer and adds the managed CRM on top."
    ),
    safeT("syndicates_page.faq_q6", "Can I run this for tournaments other than the World Cup?"),
    safeT(
      "syndicates_page.faq_a6",
      "Soon. Six Nations, Cricket World Cup, college brackets, your office annual ladder, the same toolkit applies. The World Cup 2026 setup is the launch tournament; new ones light up as the seasons roll."
    ),
    safeT("syndicates_page.faq_q7", "What if I cancel premium?"),
    safeT(
      "syndicates_page.faq_a7",
      "Your syndicate stays live on the free tier. Your members are yours. Aiva keeps your CRM data accessible for 30 days so you can export it. There is no lock-in."
    ),
    safeT("syndicates_page.faq_q8", "Is the code open source?"),
    safeT(
      "syndicates_page.faq_a8",
      "Yes, Apache 2.0. The whole platform is in the public GitHub repo. Contributors share platform revenue via the Drips Network."
    ),
    safeT("syndicates_page.faq_github_link", "public GitHub repo"),
  ]);

  return (
    <section className="vt-syndicates-section">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <div className="vt-syndicates-faq">
        <details className="vt-syndicates-faq-item">
          <summary>{q1}</summary>
          <p>{a1}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q2}</summary>
          <p>{a2}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q3}</summary>
          <p>{a3}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q4}</summary>
          <p>{a4}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q5}</summary>
          <p>{a5}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q6}</summary>
          <p>{a6}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q7}</summary>
          <p>{a7}</p>
        </details>
        <details className="vt-syndicates-faq-item">
          <summary>{q8}</summary>
          <p>
            Yes, Apache 2.0. The whole platform is in the{" "}
            <a href="https://github.com/0800tim/tournamental" target="_blank" rel="noreferrer" className="vt-syndicates-link">
              {githubLink}
            </a>
            . Contributors share platform revenue via the Drips Network.
          </p>
        </details>
      </div>
    </section>
  );
}

async function FinalCtaSection() {
  const [
    title,
    body,
    ctaPrimary,
    ctaSecondary,
  ] = await Promise.all([
    safeT("syndicates_page.cta_final_title", "Bring your tournament"),
    safeT(
      "syndicates_page.cta_final_body",
      "Office, friends, fan club, school, store, creator audience. Same toolkit. 60 seconds to a branded path. Free forever."
    ),
    safeT("syndicates_page.cta_primary", "Create a syndicate"),
    safeT("syndicates_page.cta_secondary", "Read the playbook"),
  ]);

  return (
    <section className="vt-syndicates-section vt-syndicates-cta-block">
      <h2 className="vt-syndicates-section-title">{title}</h2>
      <p className="vt-syndicates-cta-body">{body}</p>
      <div className="vt-syndicates-cta-row">
        <Link href="/syndicates/new" className="vt-syndicates-cta-primary">
          {ctaPrimary}
        </Link>
        <Link href="/syndicates/playbook" className="vt-syndicates-cta-ghost">
          {ctaSecondary}
        </Link>
      </div>
    </section>
  );
}

export default async function SyndicatesIndexPage(): Promise<JSX.Element> {
  const [
    eyebrow,
    title,
    claim,
    lede,
    qs1,
    qs2,
    qs3,
    qs_time,
    cta_primary,
    cta_secondary,
    trust_card,
    trust_app,
    trust_oss,
    trust_nz,
  ] = await Promise.all([
    safeT("syndicates_page.eyebrow", "Syndicates · Free forever"),
    safeT("syndicates_page.hero_title", "The whole tournament, gamified for your audience."),
    safeT(
      "syndicates_page.hero_claim",
      "The only World Cup prediction platform where anyone can launch a fully branded, embeddable syndicate with custom prize splits and verifiable on-chain settlement — in minutes."
    ),
    safeT(
      "syndicates_page.hero_lede",
      "A syndicate is your own branded prediction pool. Drop the embed widget on any site, run a six-week game with your own prize. Free forever; premium adds a fully-managed CRM, your own messaging, and paid-entry handling."
    ),
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
  ]);

  return (
    <AppShell title="Syndicates" showBottomNav>
      <RouteEvent name="page.view" />

      <div className="vt-syndicates-page">
        {/* Hero */}
        <section className="vt-syndicates-hero">
          <span className="vt-syndicates-eyebrow">{eyebrow}</span>
          <h1 className="vt-syndicates-title">{title}</h1>
          <p className="vt-syndicates-claim">{claim}</p>
          <p className="vt-syndicates-lede">{lede}</p>

          {/* The 60-second start strip */}
          <div className="vt-syndicates-quickstart">
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">1</span>
              <span>{qs1}</span>
            </div>
            <div className="vt-syndicates-qs-arrow">→</div>
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">2</span>
              <span>{qs2}</span>
            </div>
            <div className="vt-syndicates-qs-arrow">→</div>
            <div className="vt-syndicates-qs-step">
              <span className="vt-syndicates-qs-n">3</span>
              <span>{qs3}</span>
            </div>
            <div className="vt-syndicates-qs-time">{qs_time}</div>
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
            <li><span aria-hidden="true">✓</span> {trust_card}</li>
            <li><span aria-hidden="true">✓</span> {trust_app}</li>
            <li><span aria-hidden="true">✓</span> {trust_oss}</li>
            <li><span aria-hidden="true">✓</span> {trust_nz}</li>
          </ul>
        </section>

        {/* Use cases */}
        <UseCasesSection />

        {/* How it lands */}
        <FlowSection />

        {/* Pricing */}
        <PricingSection />

        {/* Embed snippet preview + live demo widget */}
        <EmbedSection />

        {/* Common questions */}
        <FaqSection />

        {/* Final CTA */}
        <FinalCtaSection />
      </div>
    </AppShell>
  );
}
