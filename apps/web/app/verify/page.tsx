/**
 * /verify — Tournamental's public audit trail.
 *
 * Lists every snapshot of the prediction-bearing tables that has been
 * SHA-256 hashed and anchored into Bitcoin via OpenTimestamps. The
 * receipts (.ots files) are public and prove that the hash is sealed
 * on Bitcoin's proof-of-work chain at a known time. The raw snapshots
 * themselves stay private — they contain everyone's picks, which is
 * strategic data we don't want to give competitors before a match —
 * and are released only as part of the dispute-resolution process.
 *
 * The combined proof: the anchor script is open-source, the hash is
 * on Bitcoin, therefore the snapshot at time T cannot have been
 * changed without invalidating the on-chain commitment. Anyone can
 * verify the timestamping integrity without seeing the picks.
 *
 * See docs/audit-trail.md in the repo for the full method + the
 * dispute-resolution flow.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import "./verify.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audit trail · Tournamental",
  description:
    "Every Tournamental prediction snapshot is SHA-256 hashed and anchored into Bitcoin via OpenTimestamps. The hash chain is public; raw snapshots are released under formal dispute review.",
};

interface LedgerEntry {
  readonly ts: string;
  readonly reason: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly snapshot: string;
  readonly receipt: string;
  readonly public_sample?: boolean;
}

async function readLedger(): Promise<LedgerEntry[]> {
  const path = join(process.cwd(), "data", "audit", "ledger.json");
  try {
    const raw = await fs.readFile(path, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as LedgerEntry)
      .reverse();
  } catch {
    return [];
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTs(ts: string): string {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/);
  if (!m) return ts;
  return `${m[1]} ${m[2]}:${m[3]}:${m[4]} UTC`;
}

export default async function VerifyPage(): Promise<JSX.Element> {
  const entries = await readLedger();
  const latest = entries[0];

  return (
    <main className="vt-verify">
      <article className="vt-verify-card">
        <header>
          <p className="vt-verify-eyebrow">Audit trail · Open source · Bitcoin-anchored</p>
          <h1>How we prove picks aren&apos;t changed after kickoff</h1>
        </header>

        <section>
          <p>
            At every match kickoff, and once a day in between, Tournamental
            computes a SHA-256 hash of the predictions database and commits
            that hash to Bitcoin via OpenTimestamps. The hash chain is
            public. The script that produces it is open-source. Together
            those two facts prove that picks present at time T cannot be
            changed after T without leaving an unmissable on-chain trail.
          </p>
          <p>
            <strong>The raw snapshots are private.</strong> They contain
            everyone&apos;s in-flight predictions, which is strategic data
            we don&apos;t want competitors mining mid-tournament. Snapshots
            are released only as part of the formal dispute-resolution
            process below.
          </p>
          <p>
            The anchor script lives at{" "}
            <code>
              <a href="https://github.com/0800tim/tournamental/blob/main/infra/audit/anchor.sh">
                infra/audit/anchor.sh
              </a>
            </code>
            . The method, scope, and verification walk-through are at{" "}
            <code>
              <a href="https://github.com/0800tim/tournamental/blob/main/docs/audit-trail.md">
                docs/audit-trail.md
              </a>
            </code>
            .
          </p>
        </section>

        {latest && (
          <section className="vt-verify-latest">
            <h2>Latest anchor</h2>
            <dl>
              <div>
                <dt>Captured</dt>
                <dd>{formatTs(latest.ts)}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>
                  <code>{latest.reason}</code>
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>
                  <code className="vt-verify-hash">{latest.sha256}</code>
                </dd>
              </div>
              <div>
                <dt>Snapshot size</dt>
                <dd>
                  {formatSize(latest.size_bytes)}
                  {" "}
                  {latest.public_sample
                    ? "(public sample)"
                    : "(private; audit request)"}
                </dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>
                  <a href={latest.receipt}>snapshot.db.ots</a>
                  {latest.public_sample && (
                    <>
                      {" · "}
                      <a href={latest.snapshot}>snapshot.db</a>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>
        )}

        <section>
          <h2>Verify the timestamping</h2>
          <p>
            Anyone with a laptop and the OpenTimestamps client can confirm
            that the hash above was committed to Bitcoin at the time we
            claim. You don&apos;t need the snapshot itself to do this —
            the receipt alone proves the hash is sealed into Bitcoin&apos;s
            proof-of-work chain.
          </p>
          <p>
            One anchor on the ledger is also flagged as a{" "}
            <strong>public sample</strong> so visitors can see what an
            end-to-end audit looks like (download the snapshot, recompute
            the hash, run <code>ots verify</code>, inspect the SQLite
            contents). Future anchors don&apos;t publish the snapshot by
            default; raw picks are released under the dispute flow below.
          </p>
          <pre className="vt-verify-code">{`# 1. install the OpenTimestamps client
pip install opentimestamps-client

# 2. download the receipt for the latest anchor
curl -O https://play.tournamental.com${latest?.receipt ?? "/verify/<ts>/snapshot.db.ots"}

# 3. inspect the receipt structure (shows which calendars / Bitcoin
#    transactions the hash is anchored against)
ots info snapshot.db.ots

# 4. for full Bitcoin-chain verification you'd need a file whose
#    sha256 matches the receipt. That file is the private snapshot.
#    Request it via the dispute process below.`}</pre>
        </section>

        <section className="vt-verify-dispute">
          <h2>Dispute resolution</h2>
          <p>
            If you believe a pick of yours, a pool leaderboard position, or
            a match outcome we&apos;ve reported is incorrect, we&apos;ll
            release the snapshot covering that match to you (or to a
            neutral auditor you nominate) so the full predictions table
            can be inspected against the hash on this page.
          </p>
          <ol>
            <li>
              Email <a href="mailto:info@tournamental.com">info@tournamental.com</a>{" "}
              with the subject line <code>Audit request</code>.
            </li>
            <li>
              Include: your @handle, the match or leaderboard in dispute,
              the anchor timestamp from the ledger below, and what you
              expect the snapshot to show.
            </li>
            <li>
              We&apos;ll respond within 48 hours with either the snapshot
              file (delivered over a signed URL) or a written explanation
              of why we&apos;re declining (rare; only if the request
              would itself leak unrelated user data).
            </li>
            <li>
              You can then verify offline:{" "}
              <code>sha256sum snapshot.db</code> must match the hash on
              this page, and <code>ots verify snapshot.db.ots</code> must
              return the Bitcoin block height anchoring that hash.
            </li>
          </ol>
          <p>
            Disputes that involve a third party (a pool you&apos;re in, a
            match you predicted) may have the snapshot shared with that
            party too if it&apos;s needed to settle the dispute fairly.
            We&apos;ll always tell you before doing that.
          </p>
        </section>

        <section>
          <h2>What&apos;s in a snapshot</h2>
          <p>
            Each snapshot is a deterministic SQLite file containing only
            the prediction-bearing tables: bracket payloads, tournament
            fixtures, match results, pool membership (opaque user id +
            public handle only), and pool metadata. Phone numbers, email
            addresses, IP logs, session tokens, invite queues, and API
            keys are explicitly stripped before hashing.
          </p>
        </section>

        <section>
          <h2>Hash chain</h2>
          {entries.length === 0 ? (
            <p className="vt-verify-empty">No anchors recorded yet.</p>
          ) : (
            <table className="vt-verify-table">
              <thead>
                <tr>
                  <th>Captured</th>
                  <th>Reason</th>
                  <th>SHA-256</th>
                  <th>Size</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.ts}>
                    <td>{formatTs(e.ts)}</td>
                    <td>
                      <code>{e.reason}</code>
                    </td>
                    <td>
                      <code className="vt-verify-hash-short" title={e.sha256}>
                        {e.sha256.slice(0, 12)}…{e.sha256.slice(-4)}
                      </code>
                    </td>
                    <td>{formatSize(e.size_bytes)}</td>
                    <td>
                      <a href={e.receipt}>.ots</a>
                      {e.public_sample && (
                        <>
                          {" · "}
                          <a href={e.snapshot} title="Public sample">
                            db
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </article>
    </main>
  );
}
