/**
 * /verify — Tournamental's public audit trail.
 *
 * Lists every snapshot of the prediction-bearing tables that has been
 * SHA-256 hashed and anchored into Bitcoin via OpenTimestamps. The
 * receipts are static .ots files anyone can verify offline; the
 * snapshots themselves are downloadable so an auditor can reproduce
 * the hash and inspect the picks.
 *
 * The architecture in one sentence: at every match kickoff and once
 * a day, we run infra/audit/anchor.sh which VACUUMs a deterministic
 * copy of game.db (PII tables stripped), hashes it with SHA-256, and
 * timestamps the hash via OpenTimestamps. The .ots receipt upgrades
 * from the public calendars to a Bitcoin commitment within ~3 hours.
 *
 * See docs/audit-trail.md in the repo for the full verification
 * walkthrough that journalists and auditors can follow.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import "./verify.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Audit trail · Tournamental",
  description:
    "Every Tournamental prediction snapshot is SHA-256 hashed and anchored into Bitcoin via OpenTimestamps. Anyone can verify that picks weren't changed after a match kicked off.",
};

interface LedgerEntry {
  readonly ts: string;
  readonly reason: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly snapshot: string;
  readonly receipt: string;
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
  // 2026-06-04T11-19-02Z → 2026-06-04 11:19:02 UTC
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
            At every match kickoff, and once a day, Tournamental publishes a
            SHA-256 hash of the predictions database to the Bitcoin blockchain
            via OpenTimestamps. The full snapshots are downloadable so any
            auditor can reproduce the hash and confirm picks for that match
            weren&apos;t altered after the whistle blew.
          </p>
          <p>
            The whole pipeline is open-source. The script that runs the
            anchor is at{" "}
            <code>
              <a href="https://github.com/0800tim/tournamental/blob/main/infra/audit/anchor.sh">
                infra/audit/anchor.sh
              </a>
            </code>
            . What it does, and how to verify offline, is documented at{" "}
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
                <dt>Size</dt>
                <dd>{formatSize(latest.size_bytes)}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>
                  <a href={latest.snapshot}>snapshot.db</a>
                  {" · "}
                  <a href={latest.receipt}>snapshot.db.ots</a>
                </dd>
              </div>
            </dl>
          </section>
        )}

        <section>
          <h2>Verify it yourself</h2>
          <p>
            Anyone with a laptop and the OpenTimestamps client can verify
            that the snapshot above was committed to Bitcoin at the time we
            claim. The receipt upgrades from the public calendars to a real
            Bitcoin transaction within roughly three hours of capture; before
            that it&apos;s a calendar-server attestation, after that it&apos;s
            a Bitcoin block commitment.
          </p>
          <pre className="vt-verify-code">{`# 1. install the OpenTimestamps client
pip install opentimestamps-client

# 2. download the snapshot + receipt
curl -O https://play.tournamental.com${latest?.snapshot ?? "/verify/<ts>/snapshot.db"}
curl -O https://play.tournamental.com${latest?.receipt ?? "/verify/<ts>/snapshot.db.ots"}

# 3. confirm the hash matches what's on the ledger
sha256sum snapshot.db
# expected: ${latest?.sha256 ?? "<hash>"}

# 4. verify the receipt against Bitcoin (waits for upgrade if pending)
ots verify snapshot.db.ots`}</pre>
        </section>

        <section>
          <h2>What&apos;s in a snapshot</h2>
          <p>
            Snapshots contain only the prediction-bearing tables of the game
            database: bracket payloads, tournament fixtures, match results,
            pool membership (opaque user id + public handle only), and pool
            metadata. Phone numbers, email addresses, IP logs, session
            tokens, invite queues, and API keys are explicitly stripped
            before hashing so the snapshots are safe to publish.
          </p>
        </section>

        <section>
          <h2>Full ledger</h2>
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
                  <th>Files</th>
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
                      <a href={e.snapshot}>db</a>
                      {" · "}
                      <a href={e.receipt}>.ots</a>
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
