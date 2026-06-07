/**
 * /terms/house-prize — full terms and conditions for the FIFA WC 2026
 * house-prize promotion linked from /the-bet.
 *
 * Promoter: Growth Spurt Ltd (Tournamental's parent), Auckland NZ.
 * Open globally, 18+, mobile-verified, free to enter. Tim's call:
 * "no legal counsel, going global, wear the consequences."
 *
 * Static page; no DB reads.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import "./house-prize.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "House Prize · Terms and Conditions · Tournamental",
  description:
    "Full terms and conditions for the Tournamental FIFA World Cup 2026 house-prize promotion. Open globally, 18+, mobile-verified, free to enter.",
  robots: { index: true, follow: true },
};

export default function HousePrizeTermsPage(): JSX.Element {
  return (
    <AppShell title="House Prize Terms">
      <main className="vt-terms">
        <article className="vt-terms-article">
          <header className="vt-terms-header">
            <p className="vt-terms-dateline">
              Terms &amp; Conditions · Published 2026-06-05
            </p>
            <h1 className="vt-terms-title">
              Tournamental &ldquo;House Prize&rdquo; Promotion
            </h1>
            <p className="vt-terms-lede">
              The full rules of the bet. The short version lives at{" "}
              <Link href="/the-bet">/the-bet</Link>. If anything in the short
              version and this page disagree, this page wins.
            </p>
          </header>

          <section className="vt-terms-body">
            <h2 id="promoter">1. Promoter</h2>
            <p>
              Tournamental is operated by <strong>Growth Spurt Ltd</strong>, a
              company registered in New Zealand (registered office: Auckland,
              New Zealand). All references to &ldquo;Tournamental&rdquo;,
              &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;the Promoter&rdquo;
              in these terms mean Growth Spurt Ltd.
            </p>
            <p>
              Contact:{" "}
              <a href="mailto:info@tournamental.com">info@tournamental.com</a>.
            </p>

            <h2 id="promotion">2. The promotion</h2>
            <p>
              This promotion (&ldquo;the Promotion&rdquo;) offers a single
              grand prize (&ldquo;the Prize&rdquo;) to any Eligible Participant
              (defined in section 4) who submits a Bracket (section 5) on
              play.tournamental.com that correctly predicts the outcome of every
              one of the 104 matches of the 2026 FIFA World Cup (&ldquo;the
              Tournament&rdquo;) before each match&apos;s official
              kickoff time.
            </p>

            <h2 id="period">3. Promotion period</h2>
            <ul>
              <li>
                <strong>Entry opens:</strong> the date these terms are
                published on play.tournamental.com.
              </li>
              <li>
                <strong>Final entry deadline:</strong> the kickoff of the
                opening match of the Tournament (currently scheduled
                2026-06-11T19:00:00 UTC). After this point new accounts may
                continue to register but no new top-level bracket
                submissions count toward the Prize.
              </li>
              <li>
                <strong>Per-match pick lock:</strong> each individual match
                prediction within a Bracket locks at the official kickoff
                time of that match. Picks not submitted before that
                match&apos;s kickoff do not count toward the Prize.
              </li>
              <li>
                <strong>Promotion close:</strong> the conclusion of the final
                of the Tournament. The Promoter will determine winners (if
                any) within 1 day of Promotion close.
              </li>
            </ul>

            <h2 id="eligibility">4. Eligibility</h2>
            <p>To enter the Promotion you must:</p>
            <ol>
              <li>
                Be a natural person <strong>18 years of age or older</strong>{" "}
                at the time of entry.
              </li>
              <li>
                Be physically located in a jurisdiction where free
                skill-based prize promotions of this kind are lawful. The
                Promotion is <strong>void where prohibited</strong> by local
                law. It is your responsibility to know whether participation
                is lawful where you are.
              </li>
              <li>
                Have a verified Tournamental account in your own name,
                registered with a <strong>valid mobile phone number</strong>{" "}
                that you control and to which we can deliver a one-time
                verification code. The Promoter will send a one-time code during the tournament; the winner must
                verify the code to remain eligible.
              </li>
              <li>
                Not be:
                <ul>
                  <li>
                    an employee, contractor, or director of Growth Spurt Ltd
                    or any immediate family member of same;
                  </li>
                  <li>
                    a person who has been previously banned from
                    Tournamental;
                  </li>
                  <li>
                    the sole or joint holder of any other Tournamental
                    account that has submitted a Bracket for the
                    Tournament.
                  </li>
                </ul>
              </li>
            </ol>
            <p>
              Only <strong>one (1) Bracket per Eligible Participant</strong>{" "}
              counts toward the Prize. Multiple accounts operated by the
              same person will
              result in all such Brackets being disqualified at the
              Promoter&apos;s sole discretion.
            </p>

            <h2 id="bots">4a. Bots</h2>
            <p>
              <strong>Bots are welcome to compete on Tournamental.</strong>{" "}
              The platform publishes an open Bot SDK at{" "}
              <Link href="/bots/sdk">/bots/sdk</Link> and a public
              scoring API. Bots compete on a separate leaderboard tab.
            </p>
            <p>
              Bots are <strong>ineligible for the cash Prize</strong>.
              Winners must verify identity, residency, and have a
              Humanness Score of <strong>50 or higher</strong> at the
              time of the Promotion close. Bots have a Humanness Score
              of <strong>0 by design</strong> and therefore do not
              qualify.
            </p>
            <p>
              If a bot achieves a Perfect 104-match Bracket, the
              recognition is non-cash:
            </p>
            <ul>
              <li>
                a permanent badge on the bot&apos;s public profile,
              </li>
              <li>
                an invitation to publish a co-authored post-tournament
                research note with the Promoter, and
              </li>
              <li>a non-monetary trophy.</li>
            </ul>
            <p>
              Bot operators are required to disclose ownership at the
              time of API key issuance and to operate within the
              published quotas. The Promoter reserves the right to
              suspend or revoke any API key that breaches the SDK
              terms of use.
            </p>

            <h2 id="bracket">5. The Bracket</h2>
            <p>
              A &ldquo;Bracket&rdquo; is a complete set of predictions across
              all 104 matches of the Tournament submitted via
              play.tournamental.com.
            </p>
            <p>
              Each match prediction is a choice of one of:{" "}
              <strong>home win</strong>, <strong>draw</strong>, or{" "}
              <strong>away win</strong>. Knockout-stage matches do not have
              a &ldquo;draw&rdquo; option, picks must be home win or away
              win (the match is decided at full time including extra time
              and, if needed, penalties; the team that progresses is the
              &ldquo;win&rdquo; outcome for these terms).
            </p>
            <p>
              A Bracket is &ldquo;Perfect&rdquo; if and only if every one of
              the 104 predictions matches the official FIFA-published result
              for that match. The official FIFA results are the binding
              source of truth; Tournamental will mirror them at
              fifa.com/tournaments/mens/worldcup/canadamexicousa2026.
            </p>

            <h2 id="prize">6. The Prize</h2>
            <ul>
              <li>
                <strong>Description:</strong> the Prize is the{" "}
                <strong>
                  net cash proceeds from sale of the freehold residential
                  property
                </strong>{" "}
                owned by Tim Thomas (the address will be disclosed to a
                verified winner under section 7). The property is estimated
                by the Promoter at approximately{" "}
                <strong>NZ$1,500,000</strong> as at the publication date of
                these terms. This figure is the Promoter&apos;s own estimate
                based on recent sales of comparable properties and is not an
                independent registered-valuer report.
              </li>
              <li>
                <strong>Mortgage:</strong> the property is encumbered by a
                mortgage with an outstanding balance of approximately{" "}
                <strong>NZ$800,000</strong> as at the publication date of
                these terms. The mortgage will be discharged from the sale
                proceeds before any payment to the winner.
              </li>
              <li>
                <strong>Estimated net prize:</strong> approximately{" "}
                <strong>NZ$700,000</strong>, calculated as estimated sale
                price less estimated mortgage discharge less estimated
                selling, conveyancing, and settlement costs. The exact
                figure depends on the actual sale price achieved and the
                mortgage balance at settlement. The winner is entitled to{" "}
                <strong>whatever the net residual actually is</strong> at
                settlement, even if it is less than NZ$700,000 (e.g. if the
                property sells for less than estimated). The Promoter will
                not top up a shortfall and will not retain an overage.
              </li>
              <li>
                <strong>Form of award:</strong> cash, wired to the
                winner&apos;s nominated bank account within 14 days of the
                property sale settling. The Promoter will list the property
                for sale within 30 days of winner verification and will
                pursue sale in good faith at fair market value.
                Cross-border wires for overseas winners may be subject to
                correspondent-bank delays and the winner&apos;s local
                AML/KYC compliance; the Promoter will use its best efforts
                to complete the transfer but cannot guarantee a specific
                settlement window for international payments.
              </li>
              <li>
                <strong>No insurance:</strong> the Promoter has not taken
                out prize-indemnity insurance against this Promotion. The
                full financial liability rests with the Promoter
                personally.
              </li>
              <li>
                <strong>Tax:</strong> the winner is solely responsible for
                any tax (including but not limited to income tax,
                conveyance-related fees, gift duty, or VAT/GST where
                applicable) arising in any jurisdiction from receipt of the
                Prize.
              </li>
              <li>
                <strong>Non-transferable</strong> prior to award. The right
                to claim is not assignable or saleable. The cash itself,
                once awarded, is the winner&apos;s to do with as they wish.
              </li>
            </ul>

            <h2 id="verification">7. Verification</h2>
            <p>
              A claimed Prize is contingent on the winner providing, within
              30 days of notification:
            </p>
            <ol>
              <li>
                <strong>Government-issued photo identification</strong>{" "}
                matching the name on the Tournamental account.
              </li>
              <li>
                <strong>
                  Re-verification of the registered mobile phone number
                </strong>{" "}
                by responding to a fresh one-time code sent to that number.
                The mobile-verification step at entry time together with
                this re-verification at claim time establish that the same
                person controls the account throughout the Promotion.
              </li>
              <li>
                <strong>Proof of physical location</strong> at the time of
                entry sufficient to confirm the entrant was not in a
                jurisdiction where the Promotion is void. The Promoter will
                rely on the entrant&apos;s declaration plus the registered
                mobile number&apos;s country code and the IP-geolocation
                logged at entry time, and may request additional
                documentation depending on the winner&apos;s country.
              </li>
              <li>
                <strong>Verification of pick integrity</strong>: the
                Promoter will produce, against the Bitcoin-blockchain-
                anchored audit trail at <Link href="/verify">/verify</Link>,
                the snapshot containing the winning Bracket at each
                match&apos;s kickoff time. The winner (or their nominated
                auditor) may independently verify each pick was locked-in
                before kickoff and was not altered subsequently.
              </li>
              <li>
                <strong>Signed declaration</strong> that the winner did not
                use multiple accounts, collude with another participant, or
                otherwise circumvent these terms.
              </li>
            </ol>
            <p>
              If verification cannot be completed in 30 days the Prize claim
              is forfeit.
            </p>

            <h2 id="tie">8. Tie-breaking</h2>
            <p>
              If two or more Eligible Participants submit Perfect Brackets,
              the Prize is divided equally among them.
            </p>

            <h2 id="immutable">9. Picks are immutable after kickoff</h2>
            <p>
              Predictions are locked at each individual match&apos;s
              official kickoff time as recorded on Tournamental&apos;s
              server. The server clock is synchronised to NTP and the lock
              event is recorded in the predictions database which is then
              hashed and committed to the Bitcoin blockchain via
              OpenTimestamps within approximately 3 hours of kickoff.
            </p>
            <p>This means:</p>
            <ul>
              <li>
                A participant cannot edit a pick after that match&apos;s
                kickoff. The system will refuse the edit.
              </li>
              <li>
                The Promoter cannot edit a pick after that match&apos;s
                kickoff without invalidating the on-chain commitment, which
                is publicly verifiable.
              </li>
              <li>
                Any pick visible in the on-chain-anchored snapshot at the
                kickoff timestamp is the binding pick for that match,
                regardless of any client-side or marketing-surface display.
              </li>
            </ul>

            <h2 id="disputes">10. Disputes</h2>
            <p>
              If a participant disputes a pick outcome, a leaderboard
              standing, or any other aspect of how the Promotion was
              administered, they may submit an <strong>Audit Request</strong>{" "}
              by emailing{" "}
              <a href="mailto:info@tournamental.com">info@tournamental.com</a>{" "}
              with subject line &ldquo;Audit request&rdquo;. The Promoter
              will respond within <strong>48 hours</strong> with either:
            </p>
            <ul>
              <li>
                A signed download URL for the snapshot containing the
                disputed picks, valid for 7 days, so the participant (or
                their nominated auditor) can independently verify against
                the Bitcoin-anchored hash; or
              </li>
              <li>
                A written explanation of why the request is being declined
                (limited to cases where granting it would itself breach
                another participant&apos;s privacy or these terms).
              </li>
            </ul>
            <p>
              If the participant remains in dispute after audit, the matter
              is resolved under section 12 (Governing law).
            </p>

            <h2 id="discretion">11. The Promoter&apos;s discretion</h2>
            <p>The Promoter reserves the right, at its sole discretion, to:</p>
            <ul>
              <li>
                Disqualify any entry it reasonably believes to be
                fraudulent, automated, duplicate, or made in breach of these
                terms.
              </li>
              <li>
                Modify these terms prior to the start of the Tournament (no
                modifications after the opening match&apos;s kickoff except
                as required by law).
              </li>
              <li>
                Cancel or suspend the Promotion if circumstances outside the
                Promoter&apos;s reasonable control prevent its fair
                operation, including but not limited to the cancellation,
                postponement, or material restructuring of the Tournament by
                FIFA.
              </li>
              <li>
                Refuse to publish the winner&apos;s name or identifying
                details if doing so would compromise their safety. The
                winner&apos;s consent to publicity is not a condition of
                receiving the Prize.
              </li>
            </ul>

            <h2 id="law">12. Governing law</h2>
            <p>
              These terms and the Promotion are governed by the laws of{" "}
              <strong>New Zealand</strong>. Any dispute arising under or in
              connection with the Promotion is subject to the exclusive
              jurisdiction of the courts of New Zealand.
            </p>

            <h2 id="privacy">13. Privacy</h2>
            <p>
              Personal information collected through Tournamental is governed
              by the Tournamental Privacy Policy at{" "}
              <Link href="/privacy">/privacy</Link>. In the event of a Prize
              claim the Promoter will collect additional information solely
              for verification under section 7; that information will be
              retained only as long as required for the claim and for
              related tax and audit records, then deleted.
            </p>

            <h2 id="liability">14. Liability</h2>
            <p>To the maximum extent permitted by law, the Promoter is not liable for:</p>
            <ul>
              <li>
                Internet, telecommunications, or platform outages preventing
                submission, except where caused by the gross negligence of
                the Promoter;
              </li>
              <li>
                Picks submitted but not received by the server before a
                match&apos;s kickoff;
              </li>
              <li>Disputes between participants;</li>
              <li>
                Any indirect, consequential, or special losses arising from
                participation.
              </li>
            </ul>
            <p>
              Nothing in these terms limits any non-excludable rights you
              have under New Zealand consumer law including the Consumer
              Guarantees Act 1993 and the Fair Trading Act 1986, or under
              any equivalent non-excludable consumer-protection law in your
              jurisdiction.
            </p>

            <h2 id="free">15. No fee, no purchase, no chance</h2>
            <p>
              Participation in the Promotion is <strong>free</strong>. No
              purchase is necessary. The outcome turns on the skill of
              predicting football matches; participants do not pay any
              consideration in exchange for the chance to win. The
              Promotion is therefore a{" "}
              <strong>skill-based prize promotion</strong> under New
              Zealand law and not a gambling activity.
            </p>

            <h2 id="severability">16. Severability</h2>
            <p>
              If any provision of these terms is held to be invalid or
              unenforceable, the remaining provisions continue in full
              force.
            </p>

            <h2 id="entire">17. Entire agreement</h2>
            <p>
              These terms constitute the entire agreement between the
              Promoter and the participant in relation to the Promotion,
              and supersede any prior communications, promotional material,
              or social-media statements about the Promotion.
            </p>

            <hr className="vt-terms-divider" />

            <p className="vt-terms-signoff">
              Questions about these terms? Email{" "}
              <a href="mailto:info@tournamental.com">info@tournamental.com</a>.
            </p>
            <p className="vt-terms-back">
              <Link href="/the-bet">← Back to /the-bet</Link>
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
