/**
 * /the-bet — the house-prize promotion long-form, on the play app.
 *
 * Lives on play.tournamental.com because the bet is FIFA-WC-bracket
 * specific and ties to the predictions database that the play app
 * owns; the marketing site (tournamental.com) carries a promo strip
 * that links here. Punchy first-person voice, mortgage disclosure
 * woven into the body, no insurance, mum-at-50 close.
 *
 * The /odds maths explainer is the companion page at /odds.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import "./the-bet.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "I'm betting my house on it · Tournamental",
  description:
    "Predict all 104 FIFA World Cup match outcomes correctly and I'll sell my house, pay off the mortgage, and wire you the residual — roughly NZ$600,000 cash. Open to New Zealand residents 18+. Free to enter.",
  robots: { index: true, follow: true },
};

export default function TheBetPage(): JSX.Element {
  return (
    <AppShell title="The Bet">
      <main className="vt-bet">
        <article className="vt-bet-article">
        <header className="vt-bet-header">
          <p className="vt-bet-dateline">
            The bet · Auckland · World Cup 2026
          </p>
          <h1 className="vt-bet-title">
            I&apos;m betting <em>my house</em> on it.
          </h1>
          <hr className="vt-bet-rule" aria-hidden="true" />
          <p className="vt-bet-lede">
            If you can predict every one of the 104 matches at the 2026
            World Cup, I&apos;ll sign over what&apos;s left of my equity.
          </p>
          <p className="vt-bet-footnote">
            Open to New Zealand residents 18 and over. Free to enter.
            Picks lock at each match&apos;s kickoff.
          </p>
        </header>

        <section className="vt-bet-body">
          <p className="vt-bet-lead">
            I&apos;m Tim Thomas. New Zealand engineer. Twenty-six years
            building websites and apps. The last three weeks of those
            years, I built a FIFA World Cup prediction game.
          </p>
          <p>
            If you can beat it, if you can predict every one of the 104
            matches at the 2026 World Cup correctly, I&apos;ll sign over
            my house.
          </p>
          <p>It&apos;s worth NZ$1.4 million.</p>

          <div className="vt-bet-callout">
            <p className="vt-bet-callout-head">Quick honesty break.</p>
            <p>
              I still owe the bank NZ$800,000 on the mortgage. So the
              actual prize is the equity. I sell the house, settle the
              mortgage, you walk away with roughly{" "}
              <strong>NZ$600,000 cash</strong>.
            </p>
            <p>
              That&apos;s still life-changing money. It&apos;s also
              literally every dollar I have in property. I&apos;m not
              bluffing.
            </p>
          </div>

          <p>
            Open to NZ residents 18 and over. Free to enter. No catch
            except this: your picks lock at the kickoff of each match.
            You can&apos;t watch the goal go in and change your mind.
          </p>
          <p>
            If one person, anywhere in this country, predicts every one of
            the 104 matches correctly through{" "}
            <a href="https://play.tournamental.com">Tournamental.com</a>,
            I list the house, settle the bank, and wire the rest to their
            account.
          </p>

          <h2 className="vt-bet-h2">You&apos;re not locked in at the start.</h2>
          <p>
            Every other big bracket game (ESPN, Yahoo, The Telegraph)
            locks every one of your picks in the moment the first match
            kicks off and never lets you touch them again. Tournamental
            does not. Each match is its own decision window, open right
            up until that match kicks off. Save five picks tonight, come
            back in a week and change your mind on every one of them,
            predict the next thirty as the tournament unfolds. You only
            need every pick locked in by the kickoff of its own match.
          </p>

          <h2 className="vt-bet-h2">Worried? No.</h2>
          <p>
            104 matches. Three outcomes each that count as a pick: home
            win, draw, away win.
          </p>
          <p>
            Three to the power of one hundred and four is a number with{" "}
            <strong>fifty digits</strong>.{" "}
            <Link href="/odds">See the maths</Link>.
          </p>
          <p>
            ESPN have run a March Madness bracket challenge since 1998.
            Millions of entries a year. 63 games to predict.{" "}
            <strong>Nobody has ever submitted a perfect bracket.</strong>{" "}
            Mine has 104.
          </p>
          <p>
            Even smart picks (Brazil over Tahiti, France not losing to
            Tunisia in the group stage) don&apos;t dent that headline
            number. The maths is on my side. Loudly.
          </p>

          <h2 className="vt-bet-h2">I&apos;m not insured.</h2>
          <p>
            You can buy prize-indemnity insurance for promotions like
            this. Specialist brokers underwrite the financial tail risk
            for a small premium and if the million-to-one outcome lands,
            the insurer pays out, not the promoter.
          </p>
          <p>I&apos;m not doing that.</p>
          <p>
            If somebody nails 104-for-104, the bank gets paid out of the
            sale, the winner gets the cheque, and{" "}
            <strong>I&apos;m moving back in with mum at age 50!</strong>{" "}
            No underwriter is holding the bag. It&apos;s just me and my
            mortgage.
          </p>
          <p>
            I&apos;m not insured because I don&apos;t need to be. I built
            the system, I know the maths, and I&apos;d rather skin in the
            game than skin in an insurance broker&apos;s fine print.
          </p>

          <h2 className="vt-bet-h2">
            &ldquo;Yeah but can&apos;t you just change the database?&rdquo;
          </h2>
          <p>
            Smart question. You shouldn&apos;t trust me; you should trust
            the code, it&apos;s 100% open-source.
          </p>
          <p>
            Every match kickoff, Tournamental hashes the predictions
            database and commits the hash to the{" "}
            <strong>Bitcoin blockchain</strong> via OpenTimestamps. The
            script that does this is open-source. The chain of hashes is
            public at <Link href="/verify">play.tournamental.com/verify</Link>.
          </p>
          <p>
            If I change a single pick after kickoff, yours, mine,
            anyone&apos;s, the new hash won&apos;t match the on-chain
            commitment and the tampering is immediately obvious to anyone
            with <code>ots verify</code> and three minutes.
          </p>
          <p>
            I built the audit trail before I made the bet. The chain of
            custody is public. The script is open-source. I literally
            cannot cheat my own system without everyone watching it
            happen.
          </p>

          <h2 className="vt-bet-h2">Why am I doing this?</h2>
          <p>
            The World Cup is the biggest sporting event on Earth. The
            prediction game is the perfect engagement vehicle.
            Tournamental is the best one I could possibly build.
          </p>
          <p>I&apos;m proud of it. I want people to play it.</p>
          <p>
            The fastest way for one Kiwi developer to be heard above five
            thousand other product launches in June 2026 is to put my
            house on the line and mean it. Done.
          </p>
          <p>
            Side note: I built this in three weeks. That part
            shouldn&apos;t be possible either. AI coding tools changed
            what one developer can ship. The whole thing, sign-in,
            brackets, leaderboards, the 3D match renderer, 21 languages,
            the Bitcoin-blockchain audit trail, was one person at a laptop.
          </p>
          <p>
            If you&apos;re in the New Zealand tech industry and
            you&apos;re reading this thinking &ldquo;wait, three
            weeks?&rdquo;, yes. Three weeks. Welcome to 2026.
          </p>

          <h2 className="vt-bet-h2">How to enter</h2>
          <ol className="vt-bet-steps">
            <li>
              Go to{" "}
              <Link href="/world-cup-2026">
                play.tournamental.com/world-cup-2026
              </Link>{" "}
              before kickoff on <strong>11 June 2026</strong>.
            </li>
            <li>
              Pick your permanent <code>@handle</code>. That becomes your
              share URL, <code>tournamental.com/s/yourhandle</code>.
            </li>
            <li>
              Predict all 104 matches. Take your time, or pick them in a
              flash with <strong>auto-pick</strong> then change them as
              you please during the tournament. Pull data, follow
              Polymarket, ask friends, run simulations. You&apos;re in
              control and can change picks for each individual match
              right up until that match&apos;s kickoff time.
            </li>
            <li>
              If you nail every single one, the keys (well, the proceeds)
              are yours, subject to identity and residency verification.
            </li>
          </ol>
          <p>
            Miss even one and you don&apos;t get the equity. You do get
            five weeks on a live leaderboard, watching your bracket
            render in 3D, hammering your mates about the picks they got
            wrong, and free bragging rights for the rest of the year. Not
            the worst consolation prize.
          </p>

          <h2 className="vt-bet-h2">The fine print</h2>
          <p>
            Full terms at <Link href="/terms/house-prize">/terms/house-prize</Link>.
          </p>
          <p>
            Short version: NZ residents 18+, one bracket per person, you
            must register with a valid NZ mobile phone number. Picks lock
            at each match&apos;s kickoff. The prize is the{" "}
            <strong>net cash proceeds from the sale of the house</strong>{" "}
            after the mortgage and conveyance costs are settled,
            approximately <strong>NZ$600,000</strong> at today&apos;s
            valuation and mortgage balance. Taxes and fees on the winner.
            If two people somehow both go 104-for-104, the proceeds split.
          </p>
          <p>
            Tournamental is run by <strong>Growth Spurt Ltd</strong>,
            Auckland.
          </p>

          <p className="vt-bet-signoff">See you on the leaderboard.</p>
          <p className="vt-bet-byline">
            <strong>Tim Thomas</strong>, Tournamental
            <br />
            <a href="mailto:info@tournamental.com">info@tournamental.com</a>
          </p>

          <div className="vt-bet-cta-row">
            <Link href="/world-cup-2026" className="vt-bet-cta-primary">
              Pick your bracket →
            </Link>
            <Link href="/odds" className="vt-bet-cta-ghost">
              Show me the maths
            </Link>
          </div>
        </section>
      </article>
    </main>
    </AppShell>
  );
}
