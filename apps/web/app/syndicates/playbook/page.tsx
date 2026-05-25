/* eslint-disable react/no-unescaped-entities */
/**
 * /syndicates/playbook — the long-form how-to for syndicate hosts.
 *
 * Lives on play.tournamental.com so it sits alongside the dashboard
 * and the create-syndicate flow. The marketing site at
 * tournamental.com only carries a light-touch summary linking here.
 *
 * Content: six audience archetypes with recruit copy, six prize
 * structures, two sponsor-pitch email templates, and a six-week
 * run-of-show cadence guide. Premium-tier upgrade triggers section
 * names Growth Spurt as the CRM partner.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/shell";
import { RouteEvent } from "@/components/analytics/RouteEvent";

import "./playbook.css";

export const metadata: Metadata = {
  title: "Syndicate playbook · Tournamental",
  description:
    "How to run a six-week tournament syndicate for any audience: e-commerce stores, radio stations, football clubs, schools, workplaces, and creators. Prize templates, sponsor pitches, and week-by-week run-of-show.",
  openGraph: {
    title: "Syndicate playbook · Tournamental",
    description:
      "A six-week game your audience won't stop opening. Six audience archetypes, six prize structures, sponsor-pitch templates, full run-of-show.",
    images: ["/og/syndicates.png"],
    type: "article",
  },
};

export const revalidate = 3600;

export default function SyndicatesPlaybookPage(): JSX.Element {
  return (
    <AppShell title="Syndicate playbook" showBottomNav>
      <RouteEvent name="page.view" />

      <article className="vt-pb">
        <header className="vt-pb-hero">
          <span className="vt-pb-eyebrow">Syndicate playbook</span>
          <h1 className="vt-pb-title">A six-week game your audience won't stop opening.</h1>
          <p className="vt-pb-lede">
            Tournamental syndicates work for any audience, whether or not they care about
            the sport. The prediction game is the engagement engine; the prize is the hook;
            your brand or your sponsor's brand sits on every share. This is the playbook
            for running one well.
          </p>
          <div className="vt-pb-cta-row">
            <Link href="/syndicates/new" className="vt-pb-btn vt-pb-btn-primary">
              Create a syndicate
            </Link>
            <Link href="/syndicates" className="vt-pb-btn vt-pb-btn-ghost">
              ← Back to syndicates
            </Link>
          </div>
        </header>

        <nav className="vt-pb-toc" aria-label="Playbook sections">
          <p className="vt-pb-toc-label">In this playbook</p>
          <ul>
            <li><a href="#shape" className="vt-pb-link">The shape of a syndicate</a></li>
            <li><a href="#ecommerce" className="vt-pb-link">E-commerce store</a></li>
            <li><a href="#radio" className="vt-pb-link">Radio station</a></li>
            <li><a href="#football-club" className="vt-pb-link">Football club</a></li>
            <li><a href="#school" className="vt-pb-link">School fundraiser</a></li>
            <li><a href="#workplace" className="vt-pb-link">Workplace bracket</a></li>
            <li><a href="#creator" className="vt-pb-link">Creator / influencer</a></li>
            <li><a href="#prize-structures" className="vt-pb-link">Prize structures</a></li>
            <li><a href="#sponsor-pitch" className="vt-pb-link">Sponsor pitch templates</a></li>
            <li><a href="#run-of-show" className="vt-pb-link">Six-week run-of-show</a></li>
            <li><a href="#premium" className="vt-pb-link">When to upgrade to Premium</a></li>
          </ul>
        </nav>

        <div className="vt-pb-prose">
          <h2 id="shape">The shape of a syndicate</h2>
          <p>A syndicate is a host plus an audience plus a tournament. The host runs the show; the audience makes predictions; the tournament is the schedule of matches everyone is calling. Tournamental supplies the prediction game, the leaderboards, the 3D watch-along, the share cards, and (on premium) the CRM and the messaging.</p>
          <p>What you supply is the audience and, optionally, the prize. The audience can be anyone: customers, listeners, members, parents, colleagues, followers. The prize can be anything: a store voucher, a Bluetooth speaker, a season-ticket upgrade, a coffee subscription, bragging rights, or pooled entry fees. The platform does not care.</p>
          <p>Two rules:</p>
          <ol>
            <li><strong>Tournamental never touches money.</strong> On free, the host settles offline. On premium, the host's own Stripe-connected CRM handles paid entries.</li>
            <li><strong>Members must opt in</strong> before a sponsor sees their contact details. Aggregate stats are visible to the host by default; personal contact details are not.</li>
          </ol>

          <h2 id="ecommerce">1. E-commerce store</h2>
          <p><strong>Audience.</strong> Your customer list, social followers, and email subscribers. They probably don't care about football.</p>
          <p><strong>Why it works.</strong> Six weeks of free engagement around something culturally enormous, with no obligation for the customer to be a "sports person". The prize is your product. Picks-saved is a daily check-in habit that translates into store visits.</p>
          <p><strong>Prize.</strong> $250 store voucher for the winner, $100 for second, $50 for third. Or a high-value product (your top SKU) for the winner only.</p>
          <p><strong>Where to put the widget.</strong> Homepage hero, dedicated landing page (yourstore.com/worldcup), order-confirmation thank-you page, and the post-purchase email.</p>
          <p><strong>Recruit copy (email subject lines):</strong></p>
          <ul>
            <li>"Predict the World Cup. Win $250 from us."</li>
            <li>"Six weeks of football. One shopping spree."</li>
            <li>"You don't need to know football. You just need a hunch."</li>
          </ul>

          <h2 id="radio">2. Radio station</h2>
          <p><strong>Audience.</strong> Daily listeners, the breakfast show in particular. Local, opinionated, primed for callbacks.</p>
          <p><strong>Why it works.</strong> The leaderboard is an on-air segment. The breakfast host calls out the top three every morning. The prize-sponsor mention runs alongside.</p>
          <p><strong>Prize.</strong> Sponsor-funded. Typical: a Bluetooth speaker, 12 months of coffee, a $500 gift card, or a hotel weekend. Total prize-pool value $1,000 to $3,000 is normal.</p>
          <p><strong>Sponsor pitch.</strong> "Six weeks of daily on-air mentions, your logo on every share card our listeners post, your brand baked into the morning leaderboard segment, your contact list grows by every opt-in listener."</p>
          <p><strong>Where to put the widget.</strong> Station homepage hero, app home screen, dedicated landing page, and the email newsletter.</p>

          <h2 id="football-club">3. Football club / supporters trust</h2>
          <p><strong>Audience.</strong> Members, season-ticket holders, supporters-trust subscribers, family-club newsletter list.</p>
          <p><strong>Why it works.</strong> The club already has the audience and the relationship. The tournament is a six-week reason for the relationship to mean something day-to-day.</p>
          <p><strong>Prize.</strong> Season-ticket upgrade, signed kit, a private box for the home opener, or a clubhouse-day prize-presentation event for the leader.</p>
          <p><strong>Where to put the widget.</strong> Members' area of the club website, the matchday-programme PDF (link not embed), the supporters-trust newsletter, and the club app if there is one.</p>

          <h2 id="school">4. School fundraiser</h2>
          <p><strong>Audience.</strong> Parents, senior students, alumni, the local-business directory the school already taps for raffle prizes.</p>
          <p><strong>Why it works.</strong> Existing fundraising mechanics (silent auctions, sausage sizzles, raffle tickets) are tired. A six-week prediction game with a real prize is novel, the entry-fee maths is simple.</p>
          <p><strong>Prize.</strong> Sponsor-donated. A local business or two donates the prize pack; the school keeps every dollar of the entry fees. Entry is typically $10 per person; 200 entries means $2,000 raised.</p>
          <p><strong>Where to put the widget.</strong> School newsletter (embed if the newsletter is web; link if PDF), school website members area, classroom-display screen if there is one.</p>

          <h2 id="workplace">5. Workplace bracket</h2>
          <p><strong>Audience.</strong> Your colleagues. The number is small (dozens), the engagement is daily, the chat is a Slack or Teams channel.</p>
          <p><strong>Why it works.</strong> The workplace bracket is one of the oldest sweepstake formats. Tournamental makes the predictions shared, scoring automatic, the arguments end, and the bracket lives on the company intranet rather than a spreadsheet.</p>
          <p><strong>Prize.</strong> Pooled entry fees, $10 to $20 per person. Or pooled by the company as a fully-funded prize.</p>
          <p><strong>Where to put the widget.</strong> Intranet front page, Slack / Teams pinned post (link to the syndicate page), or the "social club" page.</p>

          <h2 id="creator">6. Creator / influencer</h2>
          <p><strong>Audience.</strong> Your followers, your subscribers, your newsletter list, your Discord, your community.</p>
          <p><strong>Why it works.</strong> Followers want a reason to spend time with you, and the bracket is six weeks of that. The leaderboard is content; every climber and faller is a story.</p>
          <p><strong>Prize.</strong> Sponsored. One brand-deal underwrites the whole tournament's content output.</p>
          <p><strong>Sponsor pitch.</strong> "I'm running a World Cup bracket for [N] followers. Six weeks of daily content with your logo on every share. Audience is [demographics]. Prize budget I'd like covered: $X. I keep [Y] as a sponsor fee."</p>

          <h2 id="prize-structures">Prize structures that work</h2>

          <h3>Winner-takes-all</h3>
          <p>One prize, one winner. Best for high-value prizes ($500+) and any audience where "everyone is in with a shot until the final whistle" is the appeal. Simplest narrative; easiest sponsor pitch.</p>

          <h3>Podium (1st, 2nd, 3rd)</h3>
          <p>Three prizes of decreasing value. Keeps mid-table players engaged because second and third are still meaningful. Best for audiences over ~50 members.</p>

          <h3>Tiered (top 10%, top 25%, top 50%)</h3>
          <p>Smaller prizes for larger groups. Top-10% get a discount code, top-25% get a smaller code, everyone in the top half gets a thank-you bundle. Best for very large audiences (1,000+).</p>

          <h3>Random-draw among top half</h3>
          <p>Make the leaderboard cut, get into the draw. Mixes prediction skill with chance and tends to feel friendlier than pure skill ladders. Good for fundraisers because more people feel rewarded.</p>

          <h3>Sponsored bundle</h3>
          <p>A package of items from several sponsors (e.g. Bluetooth speaker from one, coffee subscription from another, a $100 gift card from a third). Higher perceived value than a single prize, three logos rather than one.</p>

          <h3>Pooled entry money</h3>
          <p>Every entrant pays in; the pool is the prize. Best for workplaces, friend groups, and clubs. Tournamental does not handle the cash; the host pools it offline (free tier) or via Stripe inside their own CRM sub-account (premium tier).</p>

          <h2 id="sponsor-pitch">Sponsor pitch templates</h2>

          <h3>Template A: the radio / creator pitch</h3>
          <p><strong>Subject:</strong> "Six-week World Cup engagement campaign for [your audience]"</p>
          <blockquote className="vt-pb-quote">
            <p>Hi [name],</p>
            <p>I'm running a six-week World Cup prediction game for [my audience: N listeners / followers / members]. Audience is [demographics + locations]. Every member sees a leaderboard with your logo on it every time they check it, plus a share card with your logo every time they climb. We expect [N] saved picks across the tournament and [N] share-card prints.</p>
            <p>Looking for a sponsor for the prize pack and the brand placement. Total package $[X]; prize budget within that is $[Y]. I'd love to put your brand on this. Are you free for a 15-minute call this week?</p>
            <p>[Your name]</p>
          </blockquote>

          <h3>Template B: the school / non-profit pitch</h3>
          <p><strong>Subject:</strong> "Prize donation for the [School] World Cup fundraiser"</p>
          <blockquote className="vt-pb-quote">
            <p>Hi [name],</p>
            <p>[School] is running a World Cup prediction-game fundraiser this year. Parents and senior students enter for $10 each; all proceeds go to [cause]. We expect [N] entries, raising approximately $[X].</p>
            <p>We're looking for a local business to donate the winner's prize pack. Your logo would be on every leaderboard share, in every parent email for six weeks, and you'd get a thank-you mention at prize-giving in front of [audience size]. Anything from a gift card to a product bundle works.</p>
            <p>Could you spare 10 minutes this week to chat?</p>
            <p>[Your name]</p>
          </blockquote>

          <h2 id="run-of-show">Six-week run-of-show</h2>
          <p>Cadence matters more than copy. A syndicate that goes quiet between matchdays evaporates; a syndicate with a daily rhythm carries its audience all the way to the final whistle.</p>

          <h3>Weeks -2 to -1 (lead-in)</h3>
          <ul>
            <li>Announce the syndicate with the prize headline.</li>
            <li>Open sign-ups. Embed the widget on at least three pages of your site.</li>
            <li>Sponsor reveal if applicable.</li>
            <li>Pin the bracket page in your most-used channel.</li>
          </ul>

          <h3>Week 1 (group stage opens)</h3>
          <ul>
            <li>Welcome email: "the bracket is open, the first match is tonight, here's how to pick".</li>
            <li>Daily leaderboard digest from day 2 onwards. Top 10 + biggest climber + biggest faller.</li>
            <li>Midweek "still time to join" push.</li>
          </ul>

          <h3>Weeks 2-3 (group stage continues)</h3>
          <ul>
            <li>Maintain the daily digest cadence.</li>
            <li>Weekly "round of 16 is coming, lock in your knockout bracket" reminder.</li>
            <li>Sponsor-mention email at the midpoint thanking them for the prize.</li>
          </ul>

          <h3>Weeks 4-5 (knockouts)</h3>
          <ul>
            <li>Stakes rise. Send "your favourite is one match away" alerts.</li>
            <li>Switch from daily digest to per-match alerts for high-impact matches.</li>
            <li>"What if?" content: "if [team] win tonight, here's how the leaderboard reshuffles."</li>
          </ul>

          <h3>Week 6 (final)</h3>
          <ul>
            <li>Final-morning email: "today is the day, here's where you stand".</li>
            <li>Live-leaderboard hero on the homepage from kickoff to the trophy lift.</li>
            <li>Winner-announcement email within an hour of the final whistle.</li>
            <li>Sponsor thank-you email and prize-handover content within 48 hours.</li>
          </ul>

          <h2 id="premium">When to upgrade to Premium (powered by Growth Spurt)</h2>
          <p>Premium tier is delivered by <a href="https://tournamental.com/partners/growth-spurt" target="_blank" rel="noreferrer" className="vt-pb-link">Growth Spurt</a>, our CRM and messaging partner. Free covers everything a smaller host needs. Upgrade when:</p>
          <ul>
            <li><strong>You want paid entries</strong> via Stripe Checkout (funds to your bank, not ours).</li>
            <li><strong>You want SMS or WhatsApp at scale</strong> through your own number, branded in your name.</li>
            <li><strong>You want a real CRM</strong> with workflows, nurture sequences, segmentation, lead-scoring. Growth Spurt provisions a HighLevel sub-account, configures it for your tournament, and hands you the keys.</li>
            <li><strong>You want the subdomain</strong> yourname.tournamental.com as a full-page experience.</li>
            <li><strong>You want your own brand on every surface</strong> — premium removes the Tournamental footer.</li>
          </ul>

          <p>Two paths into premium, both via Growth Spurt:</p>
          <ol>
            <li><strong>Managed: $97/month flat.</strong> Growth Spurt provisions and runs the HighLevel sub-account. Cancel any time; you keep the contact list when you leave.</li>
            <li><strong>BYO HighLevel via Growth Spurt's affiliate link.</strong> Best for high-volume hosts already paying HighLevel rates.</li>
          </ol>

          <p>Detail on the partnership: <a href="https://tournamental.com/partners/growth-spurt" target="_blank" rel="noreferrer" className="vt-pb-link">tournamental.com/partners/growth-spurt</a>.</p>

          <h2 id="next">Ready to start</h2>
          <p>
            The fastest path is to <Link href="/syndicates/new" className="vt-pb-link">create a syndicate</Link>,
            drop the widget on one of your pages, and run a small test syndicate with friends
            or colleagues for a weekend. Then scale up the audience when you have the rhythm
            of the daily digest dialled in.
          </p>

          <div className="vt-pb-cta-row vt-pb-cta-row-end">
            <Link href="/syndicates/new" className="vt-pb-btn vt-pb-btn-primary">
              Create a syndicate
            </Link>
            <Link href="/syndicates" className="vt-pb-btn vt-pb-btn-ghost">
              Back to syndicates
            </Link>
          </div>
        </div>
      </article>
    </AppShell>
  );
}
