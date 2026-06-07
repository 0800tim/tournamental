/**
 * /bots/node, federated bot-node operator documentation.
 *
 * Phase 2 of the Open Bot Arena (spec §15) introduces a federated
 * compute network: external operators run an open-source Tournamental
 * Bot Node on their own infra, hold per-bot brackets locally, and
 * publish only pre-kickoff merkle commitments + post-match aggregates
 * to the central server.
 *
 * The page goes live in Phase 1 so prospective operators can read the
 * design, clone the package skeleton (when it ships), and prepare
 * infrastructure ahead of the first federated leaderboard event on
 * 20 June 2026. The actual `@tournamental/bot-node` package + Docker
 * image are Phase 2 deliverables.
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

// Reuse the /bots/sdk editorial styles so the developer-docs micro-site
// reads as one consistent surface.
import "../sdk/sdk.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Run a Bot Node · Tournamental Open Bot Arena",
  description:
    "Operate a federated Tournamental Bot Node. Hold bot brackets locally, publish merkle commitments pre-kickoff, prove your perfect-bracket claim with blockchain-anchored proofs.",
  robots: { index: true, follow: true },
};

export default function BotsNodePage(): JSX.Element {
  return (
    <AppShell title="Bot Node">
      <main className="vt-sdk">
        <article className="vt-sdk-article">
          <header className="vt-sdk-header">
            <p className="vt-sdk-eyebrow">Federated Bot Arena · Phase 2</p>
            <h1 className="vt-sdk-title">
              Run a <em>federated</em> Tournamental Bot Node.
            </h1>
            <p className="vt-sdk-lede">
              The central-tier bulk-insert API scales to roughly ten
              million bots. Beyond that, the design federates: any
              operator can run a Bot Node on their own infrastructure,
              hold per-bot brackets locally, and publish only
              merkle-committed aggregates to the public leaderboard.
              Trust is minimised, not avoided. Every public claim has
              an OpenTimestamps-anchored proof a third party can
              verify in under sixty seconds. The anchor cost to the
              federated network is <strong>US$0</strong>: roots batch
              into a single Bitcoin transaction via OpenTimestamps,
              and the receipt is enough to re-derive the proof
              forever.
            </p>
            <p className="vt-sdk-lede">
              For the wider open-bot-floor story see{" "}
              <Link href="/bot-arena">/bot-arena</Link> and the 7 June
              press release at{" "}
              <a
                href="/press/2026-06-07.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                /press/2026-06-07.html
              </a>
              . The browser swarm at{" "}
              <Link href="/run">/run</Link> is the same protocol at
              smaller scale; this page picks up where browser swarms
              run out of headroom.
            </p>
            <div className="vt-sdk-cta-row">
              <a
                className="vt-sdk-cta vt-sdk-cta--primary"
                href="https://github.com/0800tim/tournamental/tree/main/packages/bot-node"
                target="_blank"
                rel="noopener noreferrer"
              >
                Source: packages/bot-node
              </a>
              <Link className="vt-sdk-cta vt-sdk-cta--ghost" href="/bots/sdk">
                Bot SDK overview
              </Link>
            </div>
            <div className="vt-sdk-callout">
              <strong>Phase 2 ships during the tournament.</strong> The
              Docker image and the central
              <code>/v1/nodes/*</code> endpoints land in the week of
              18 June 2026. This page is the design-and-prep guide so
              you can plan capacity and audit posture now.
            </div>
          </header>

          <section className="vt-sdk-section">
            <h2>Why federate?</h2>
            <p>
              The perfect-bracket bottleneck is the group stage:{" "}
              <code>3^72 ≈ 10^34</code> raw outcomes vs{" "}
              <code>2^32 ≈ 4.3 x 10^9</code> for the knockouts. An
              operator who concentrates compute at the base level
              (distinct group-stage variations) and lets the knockout
              cascade reduce naturally dominates a uniformly-random
              swarm by many orders of magnitude in the probability of
              a survivor at match 104.
            </p>
            <p>
              Federating keeps that compute on the operator&apos;s own
              hardware. The central server never sees per-bot
              brackets; it only sees per-match merkle roots and
              post-match aggregates. The operator publishes proofs on
              demand if anyone wants to challenge a leaderboard claim.
            </p>
          </section>

          <section className="vt-sdk-section">
            <h2>Quickstart (when Phase 2 ships)</h2>
            <h3>Clone</h3>
            <pre className="vt-sdk-code"><code>{`git clone https://github.com/0800tim/tournamental
cd tournamental/packages/bot-node`}</code></pre>
            <h3>Configure</h3>
            <pre className="vt-sdk-code"><code>{`cp .env.example .env
# Set:
#   NODE_OPERATOR_NAME=...
#   NODE_OPERATOR_EMAIL=info@example.org
#   TOURNAMENTAL_API_KEY=tnm_...   # from /bots/keys
#   BOT_COUNT=1000000              # how many bots this node will host
#   BOT_POLICY=card-stacking       # or chalk-cascade, ensemble, custom`}</code></pre>
            <h3>Deploy</h3>
            <pre className="vt-sdk-code"><code>{`docker compose up -d
# The node registers itself with the central server, fetches the
# match catalogue, and begins generating brackets per BOT_POLICY.
# Pre-kickoff merkle commitments are POSTed automatically.`}</code></pre>
          </section>

          <section className="vt-sdk-section">
            <h2>Commitment and aggregation flow</h2>
            <h3>Pre-kickoff commitment</h3>
            <pre className="vt-sdk-code"><code>{`node N:  merkle_root_M = merkle_hash(picks_for_match_M_across_all_bots)
node N:  POST /v1/nodes/commit
         { node_id, match_id, merkle_root, kickoff_timestamp,
           total_bots, still_perfect_count }
central: validate node_id, deadline (kickoff must be in future);
         persist row; include merkle_root in the kickoff_M OTS bundle.`}</code></pre>
            <h3>Post-match aggregation</h3>
            <pre className="vt-sdk-code"><code>{`central: publishes outcome_M
node N:  compute per-bot scores locally, then
         POST /v1/nodes/score
         { node_id, match_id, total_bots, bots_correct,
           bots_still_perfect, leaderboard_top_1000 }
central: persist aggregate; merge top_1000 into the federated
         public leaderboard view.`}</code></pre>
            <h3>Third-party verification</h3>
            <pre className="vt-sdk-code"><code>{`challenger: GET /v1/nodes/<node_id>/match/<match_id>/proof?bot_id=<bot_id>
node:       respond with merkle_path + the bot's actual pick.
challenger: verify path resolves to merkle_root committed pre-kickoff;
            cross-check against the OTS-anchored central commitment.
cheating node: cannot produce a valid proof, gets flagged + delisted.`}</code></pre>
          </section>

          <section className="vt-sdk-section">
            <h2>Audit requirements</h2>
            <p>
              Every bot pick that contributes to a public leaderboard
              score must satisfy four constraints. Failing any one
              delists the node from the federated leaderboard.
            </p>
            <ol>
              <li>
                <strong>Committed pre-kickoff.</strong> The merkle root
                must arrive at the central server before the
                match&apos;s kickoff timestamp. Late submissions are
                recorded but excluded from leaderboard scoring for
                that match.
              </li>
              <li>
                <strong>OpenTimestamps-anchored.</strong> Every
                commitment timestamp must match a Bitcoin block
                timestamp within the OTS confidence window. Tampering
                with the node&apos;s local DB after the fact must
                produce a proof-verification failure detectable by any
                third party.
              </li>
              <li>
                <strong>Independently verifiable.</strong> A
                third-party challenger with <code>ots verify</code>{" "}
                plus the node&apos;s HTTP API must validate any pick
                claim within sixty seconds.
              </li>
              <li>
                <strong>Auditable perfect-bracket claim.</strong> If a
                node reports <code>bots_still_perfect &gt; 0</code>{" "}
                after match 104, the operator must publish the full
                merkle proof chain (104 proofs per surviving bot, one
                per match). The central server runs the verification
                and publishes the result.
              </li>
            </ol>
          </section>

          <section className="vt-sdk-section">
            <h2>Capacity planning</h2>
            <div className="vt-sdk-table-wrap">
              <table className="vt-sdk-table">
                <thead>
                  <tr>
                    <th>Bot count</th>
                    <th>RAM (per node)</th>
                    <th>Disk (full tournament)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>100,000</td>
                    <td>4 GB</td>
                    <td>~2 GB</td>
                    <td>Single hobby box</td>
                  </tr>
                  <tr>
                    <td>1,000,000</td>
                    <td>16 GB</td>
                    <td>~20 GB</td>
                    <td>One cloud VM</td>
                  </tr>
                  <tr>
                    <td>10,000,000</td>
                    <td>128 GB</td>
                    <td>~200 GB</td>
                    <td>Workstation or sharded across 8 VMs</td>
                  </tr>
                  <tr>
                    <td>1,000,000,000</td>
                    <td>shard at scale</td>
                    <td>~20 TB</td>
                    <td>Card-stacking swarm; see spec §15.1</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="vt-sdk-section">
            <h2>Onboarding</h2>
            <p>
              The first federated node onboards 18 June 2026 (one week
              after kickoff). To register interest, email{" "}
              <a href="mailto:info@tournamental.com">
                info@tournamental.com
              </a>{" "}
              with your operator name, estimated bot count, and a
              one-line statement of the policy your bots will follow.
              We&apos;ll send you the Docker compose file as soon as
              Phase 2 lands.
            </p>
          </section>

          <section id="updating" className="vt-sdk-section">
            <h2>Updating to a new bot-node release</h2>
            <p>
              Tournamental publishes strategy and protocol updates
              regularly. Running an out-of-date bot-node still posts to
              the leaderboard, but your picks will trail real-world
              signal. The most recent release,{" "}
              <strong>v0.2.0</strong>, fixes a calibration bug where
              chalk-blended group matches resolved to all-draws and the
              cup-winner cascade favoured longshots. Full changelog at{" "}
              <a
                href="https://github.com/0800tim/tournamental/releases"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/0800tim/tournamental/releases
              </a>
              .
            </p>

            <h3>Check the current version</h3>
            <pre className="vt-sdk-code"><code>{`docker exec tournamental-bot-node tournamental-bot-node --version`}</code></pre>

            <h3>Update via Docker (preferred)</h3>
            <p>
              Pull the new image and recreate the container in place.
              The named-volume bot data is preserved across the upgrade
              (the SQLite DBs survive container recreate).
            </p>
            <pre className="vt-sdk-code"><code>{`cd path/to/your/docker-compose-dir
docker compose pull
docker compose up -d --force-recreate`}</code></pre>

            <h3>Update via npm (if you embedded the SDK directly)</h3>
            <pre className="vt-sdk-code"><code>{`npm install @tournamental/bot-node@latest
# or pin a specific version:
npm install @tournamental/bot-node@0.2.0`}</code></pre>

            <h3>Verify the update worked</h3>
            <ul>
              <li>
                Hit the node&apos;s <code>/stats</code> endpoint and
                confirm the version field reflects the new release. If
                your build doesn&apos;t expose <code>version</code> on{" "}
                <code>/stats</code> yet, rely on the CLI{" "}
                <code>--version</code> output instead.
              </li>
              <li>
                Open a sample bot&apos;s bracket on{" "}
                <code>play.tournamental.com/run/bots/&lt;index&gt;</code>{" "}
                and confirm group matches no longer all resolve to{" "}
                <em>Draw</em>, and the cup-winner pick is not a
                tournament longshot.
              </li>
            </ul>

            <h3>Versioning policy</h3>
            <ul>
              <li>Tournamental uses semver.</li>
              <li>
                <code>0.x.x</code> is pre-1.0. Strategy and protocol
                semantics may change with a minor bump, so{" "}
                <code>0.1 → 0.2</code> is a breaking strategy change.
              </li>
              <li>
                Pin major + minor in production:{" "}
                <code>@tournamental/bot-node@^0.2.0</code>.
              </li>
              <li>
                Subscribe to GitHub releases at{" "}
                <a
                  href="https://github.com/0800tim/tournamental/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/0800tim/tournamental/releases
                </a>{" "}
                for changelogs.
              </li>
            </ul>

            <h3>Got bots running on an old version?</h3>
            <p>
              Previously-generated bot brackets stay on the
              leaderboard. The commits are immutable, so nothing you
              already published gets rewritten. Only new batches go
              through the new strategy. Recommended sequence: stop the
              swarm, update, restart. No bot-history loss.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
