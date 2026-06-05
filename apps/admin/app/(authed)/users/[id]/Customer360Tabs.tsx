"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Role } from "@/lib/perms";
import type {
  AdminMatchPrediction,
  AffiliateRevenueSummary,
  BracketHistoryEntry,
  CrmContact,
  Customer360,
  SocialPost,
  SyndicateMembership,
  UserBracketDraft,
} from "@/lib/customer360";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "predictions", label: "Predictions" },
  { id: "syndicates", label: "Syndicates" },
  { id: "revenue", label: "Revenue" },
  { id: "social", label: "Clips & social" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface Customer360TabsProps {
  userId: string;
  data: Customer360;
  role: Role;
  /** Built-in profile section (existing brackets list etc.) — passed in as
   *  ReactNode so the server-rendered "Profile" stays a server component. */
  profileSlot: React.ReactNode;
}

export function Customer360Tabs({ userId, data, role, profileSlot }: Customer360TabsProps) {
  const [active, setActive] = useState<TabId>("profile");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuper = role === "super-admin";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-ink-700">
        <nav role="tablist" aria-label="Customer 360 sections" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={[
                "px-3 py-2 text-sm border-b-2 -mb-px",
                active === t.id
                  ? "border-accent-500 text-ink-50"
                  : "border-transparent text-ink-200 hover:text-ink-50",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {isSuper && (
            <a
              href={`/api/users/${encodeURIComponent(userId)}/export`}
              download
              className="text-xs px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 text-ink-50"
              data-testid="export-json-btn"
            >
              Export JSON
            </a>
          )}
          {isSuper && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs px-2 py-1 rounded bg-danger-600 hover:bg-danger-500 text-ink-50"
              data-testid="delete-data-btn"
            >
              Delete user
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="text-xs text-danger-500">
          {error}
        </div>
      )}

      {active === "profile" && (
        <section role="tabpanel" aria-label="Profile">
          {profileSlot}
          <CrmContactCard contact={data.crmContact} />
        </section>
      )}

      {active === "predictions" && (
        <section role="tabpanel" aria-label="Predictions">
          <PredictionsPanel
            draft={data.bracketDraft}
            history={data.bracketHistory}
          />
        </section>
      )}

      {active === "syndicates" && (
        <section role="tabpanel" aria-label="Syndicates">
          <SyndicatesPanel rows={data.syndicates} />
        </section>
      )}

      {active === "revenue" && (
        <section role="tabpanel" aria-label="Revenue">
          <RevenuePanel summary={data.affiliateRevenue} />
        </section>
      )}

      {active === "social" && (
        <section role="tabpanel" aria-label="Clips and social">
          <SocialPanel posts={data.socialPosts} />
        </section>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete user permanently?"
          body={`HARD deletes ${userId} across auth.db + game.db: the user row, all sessions, OTP + rate-limit state for their phone, every bracket they've saved, and every pool membership (with member_count decremented for any active pools).\n\nThis cannot be undone. Type the user id below to confirm.`}
          confirmPhrase={userId}
          confirmLabel={busy ? "Deleting…" : "Delete user"}
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setError(null);
            setBusy(true);
            try {
              const r = await fetch(`/api/users/${encodeURIComponent(userId)}/data`, {
                method: "DELETE",
              });
              if (!r.ok) {
                const body = (await r.json().catch(() => ({}))) as {
                  error?: string;
                };
                setError(`Delete failed (${r.status}${body.error ? `: ${body.error}` : ""}).`);
                return;
              }
              setConfirmDelete(false);
              // Bounce to the users list — the detail page would 404
              // immediately on this id anyway.
              window.location.href = "/users";
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------- sub-panels --------------------------------------------

function MissingData({ label, todo }: { label: string; todo: string }) {
  return (
    <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
      <div className="font-display text-ink-50 mb-1">{label} unavailable</div>
      <div className="text-xs text-ink-500">{todo}</div>
    </div>
  );
}

function CrmContactCard({ contact }: { contact: CrmContact | null }) {
  if (!contact) {
    return (
      <div className="mt-4">
        <h3 className="text-sm uppercase tracking-wider text-ink-500 mb-2">CRM contact</h3>
        <MissingData
          label="CRM contact"
          todo="apps/crm-bridge GET /v1/customer/:userId not reachable. The wrapper swallowed the error; bring crm-bridge up locally on port 3395 to populate this card."
        />
      </div>
    );
  }
  return (
    <div className="mt-4">
      <h3 className="text-sm uppercase tracking-wider text-ink-500 mb-2">CRM contact</h3>
      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 grid grid-cols-2 gap-3 text-sm">
        <Row label="Email" value={contact.email ?? "—"} />
        <Row label="Phone" value={contact.phone ?? "—"} />
        <Row
          label="Marketing opt-in"
          value={contact.marketingOptIn === undefined ? "—" : contact.marketingOptIn ? "yes" : "no"}
        />
        <Row label="Last synced" value={contact.lastSyncedAt ? fmtDate(contact.lastSyncedAt) : "—"} />
        {contact.notes && (
          <div className="col-span-2">
            <div className="text-xs uppercase tracking-wider text-ink-500">Notes</div>
            <div className="text-ink-50 whitespace-pre-line">{contact.notes}</div>
          </div>
        )}
        {contact.attributes && Object.keys(contact.attributes).length > 0 && (
          <details className="col-span-2 text-xs">
            <summary className="cursor-pointer text-ink-200">Raw attributes</summary>
            <pre className="mt-2 bg-ink-900 rounded p-2 overflow-x-auto text-ink-200">
              {JSON.stringify(contact.attributes, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-ink-50 font-mono text-xs break-all">{value}</div>
    </div>
  );
}

function PredictionsPanel({
  draft,
  history,
}: {
  draft: UserBracketDraft | null;
  history: BracketHistoryEntry[] | null;
}) {
  const [sortKey, setSortKey] = useState<"matchId" | "lockedAt">("matchId");

  const allPredictions: AdminMatchPrediction[] = useMemo(() => {
    if (!draft) return [];
    return [
      ...Object.values(draft.matchPredictions ?? {}),
      ...Object.values(draft.knockoutPredictions ?? {}),
    ];
  }, [draft]);

  const sorted = useMemo(() => {
    const out = [...allPredictions];
    out.sort((a, b) => {
      if (sortKey === "matchId") {
        const ai = numericMatchId(a.matchId);
        const bi = numericMatchId(b.matchId);
        if (ai !== null && bi !== null) return ai - bi;
        return a.matchId.localeCompare(b.matchId);
      }
      return (b.lockedAt ?? "").localeCompare(a.lockedAt ?? "");
    });
    return out;
  }, [allPredictions, sortKey]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm uppercase tracking-wider text-ink-500">
            Bracket draft {draft?.lockedAt ? "(locked)" : "(in-progress)"}
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-500">Sort by</span>
            <button
              type="button"
              onClick={() => setSortKey("matchId")}
              className={[
                "px-2 py-0.5 rounded",
                sortKey === "matchId" ? "bg-accent-700/40 text-ink-50" : "text-ink-200 hover:text-ink-50",
              ].join(" ")}
            >
              Match
            </button>
            <button
              type="button"
              onClick={() => setSortKey("lockedAt")}
              className={[
                "px-2 py-0.5 rounded",
                sortKey === "lockedAt" ? "bg-accent-700/40 text-ink-50" : "text-ink-200 hover:text-ink-50",
              ].join(" ")}
            >
              Locked at
            </button>
          </div>
        </div>
        {draft === null ? (
          <MissingData
            label="Bracket draft"
            todo="apps/game GET /v1/users/:userId/bracket not reachable. TODO: ship endpoint or stand up game-service on port 3315."
          />
        ) : sorted.length === 0 ? (
          <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
            No predictions submitted yet.
          </div>
        ) : (
          <table className="w-full text-sm rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
            <thead className="bg-ink-900/40">
              <tr className="text-xs uppercase text-ink-500">
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Outcome</th>
                <th className="px-3 py-2 text-left">Score</th>
                <th className="px-3 py-2 text-left">Odds at lock</th>
                <th className="px-3 py-2 text-left">Locked at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {sorted.map((p) => (
                <tr key={p.matchId} className="text-ink-50">
                  <td className="px-3 py-2 font-mono text-xs">{p.matchId}</td>
                  <td className="px-3 py-2">{outcomeLabel(p.outcome)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.homeScore !== undefined && p.awayScore !== undefined
                      ? `${p.homeScore}–${p.awayScore}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtOdds(p.oddsAtLock)}</td>
                  <td className="px-3 py-2 text-xs text-ink-200">{fmtDate(p.lockedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-sm uppercase tracking-wider text-ink-500 mb-2">
          Edit history
        </h3>
        {history === null ? (
          <MissingData
            label="History ledger"
            todo="apps/game GET /v1/users/:userId/history not reachable. TODO: ship the history ledger endpoint on game-service (per the per-match-predictions branch)."
          />
        ) : history.length === 0 ? (
          <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
            No edits recorded yet.
          </div>
        ) : (
          <table className="w-full text-sm rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
            <thead className="bg-ink-900/40">
              <tr className="text-xs uppercase text-ink-500">
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Prev</th>
                <th className="px-3 py-2 text-left">New</th>
                <th className="px-3 py-2 text-left">Odds at lock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {history.map((h) => (
                <tr key={h.id} className="text-ink-50">
                  <td className="px-3 py-2 text-xs text-ink-200">{fmtDate(h.ts)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.matchId}</td>
                  <td className="px-3 py-2 text-xs">{h.prevOutcome ? outcomeLabel(h.prevOutcome) : "—"}</td>
                  <td className="px-3 py-2 text-xs">{outcomeLabel(h.newOutcome)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtOdds(h.oddsAtLock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SyndicatesPanel({ rows }: { rows: SyndicateMembership[] | null }) {
  if (rows === null) {
    return (
      <MissingData
        label="Syndicate memberships"
        todo="apps/game GET /v1/users/:userId/syndicates not reachable. TODO: ship endpoint, or query the existing syndicates_members table directly."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
        Not a member of any syndicate.
      </div>
    );
  }
  return (
    <table className="w-full text-sm rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
      <thead className="bg-ink-900/40">
        <tr className="text-xs uppercase text-ink-500">
          <th className="px-3 py-2 text-left">Syndicate</th>
          <th className="px-3 py-2 text-left">Role</th>
          <th className="px-3 py-2 text-left">Joined</th>
          <th className="px-3 py-2 text-left">Rank</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-700">
        {rows.map((r) => (
          <tr key={r.slug} className="text-ink-50">
            <td className="px-3 py-2">
              <a className="text-accent-400 hover:underline" href={`/syndicates/${encodeURIComponent(r.slug)}`}>
                {r.name}
              </a>
            </td>
            <td className="px-3 py-2 text-xs uppercase tracking-wider">{r.role}</td>
            <td className="px-3 py-2 text-xs text-ink-200">{fmtDate(r.joinedAt)}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.rank ? `#${r.rank}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RevenuePanel({ summary }: { summary: AffiliateRevenueSummary | null }) {
  if (summary === null) {
    return (
      <MissingData
        label="Affiliate revenue"
        todo="apps/affiliate-router GET /v1/admin/audit/by-user/:userId not reachable. The audit JSONL exporter is shipped; expose it as an HTTP endpoint."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Clicks" value={summary.totalClicks} />
        <StatTile label="Conversions" value={summary.totalConversions} />
        <StatTile label="Revenue" value={summary.totalRevenueUnits.toLocaleString() + " u"} />
      </div>
      {summary.recent.length === 0 ? (
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
          No clicks recorded yet.
        </div>
      ) : (
        <table className="w-full text-sm rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
          <thead className="bg-ink-900/40">
            <tr className="text-xs uppercase text-ink-500">
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Affiliate</th>
              <th className="px-3 py-2 text-left">Geo</th>
              <th className="px-3 py-2 text-left">Converted</th>
              <th className="px-3 py-2 text-left">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {summary.recent.map((r) => (
              <tr key={r.id} className="text-ink-50">
                <td className="px-3 py-2 text-xs text-ink-200">{fmtDate(r.ts)}</td>
                <td className="px-3 py-2 text-xs">{r.partnerLabel ?? r.affiliateId}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.geoCountry ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.converted ? "yes" : "no"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.revenueUnits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SocialPanel({ posts }: { posts: SocialPost[] | null }) {
  if (posts === null) {
    return (
      <MissingData
        label="Clips & social posts"
        todo="apps/social-publisher GET /v1/posts?userId=… not reachable. TODO: ship the social-publisher post-listing endpoint (parallel branch)."
      />
    );
  }
  if (posts.length === 0) {
    return (
      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 px-4 py-6 text-sm text-ink-200">
        No clips or social posts yet.
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {posts.map((p) => (
        <li
          key={p.id}
          className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-1"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="uppercase tracking-wider text-ink-500">{p.platform}</span>
            <span className="text-ink-200">{relationLabel(p.relation)}</span>
          </div>
          {p.url ? (
            <a className="text-accent-400 hover:underline text-sm" href={p.url} target="_blank" rel="noreferrer">
              {p.caption ?? p.url}
            </a>
          ) : (
            <span className="text-sm text-ink-50">{p.caption ?? "—"}</span>
          )}
          <div className="flex items-center gap-3 text-xs text-ink-200">
            <span>{fmtDate(p.publishedAt)}</span>
            {p.views !== undefined && <span>{p.views.toLocaleString()} views</span>}
            {p.shares !== undefined && <span>{p.shares.toLocaleString()} shares</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-ink-800 ring-1 ring-ink-700 p-4 flex flex-col gap-1">
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-2xl font-display font-semibold text-ink-50">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

// ---------------- helpers -----------------------------------------------

function outcomeLabel(o: AdminMatchPrediction["outcome"]): string {
  switch (o) {
    case "home_win":
      return "Home win";
    case "away_win":
      return "Away win";
    case "draw":
      return "Draw";
  }
}

function fmtOdds(o: AdminMatchPrediction["oddsAtLock"]): string {
  if (!o) return "—";
  return `H ${o.home.toFixed(2)} / D ${o.draw.toFixed(2)} / A ${o.away.toFixed(2)}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function numericMatchId(id: string): number | null {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) && /^\d+$/.test(id) ? n : null;
}

function relationLabel(r: SocialPost["relation"]): string {
  switch (r) {
    case "appeared_in":
      return "appeared in";
    case "shared_by":
      return "shared by user";
    case "authored":
      return "authored";
  }
}
