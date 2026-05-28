/**
 * HighLevel (GoHighLevel) snapshot page.
 *
 * Pulls live counts + tag breakdown + recent contacts from the CRM
 * sub-account that auth-sms and the web app already mirror to (see
 * docs/61). Surfaces drift between our DB and GHL so the operator
 * can spot users who failed to sync. Read-only; resync actions live
 * on the user detail page.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import {
  fetchContactCountForTag,
  fetchContactsSnapshot,
  fetchTags,
  isHighLevelConfigured,
} from "@/lib/highlevel";
import { authDb } from "@/lib/db";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

function fmtRelative(iso: string | null): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString();
}

export default async function HighLevelPage() {
  await requireAuth();

  if (!isHighLevelConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl font-display font-semibold">HighLevel</h1>
          <p className="text-sm text-ink-200">
            CRM sub-account snapshot, drift detection, and tag breakdowns.
          </p>
        </header>
        <div className="rounded-lg ring-1 ring-flame-500/40 bg-flame-500/10 p-4 text-sm">
          HighLevel is not configured for this admin app. Set{" "}
          <code className="font-mono">GHL_API_KEY</code> and{" "}
          <code className="font-mono">GHL_LOCATION_ID</code> in{" "}
          <code className="font-mono">apps/admin/.env.production</code> and
          restart, or read the keys from auth-sms's env (they're the same
          sub-account).
        </div>
      </div>
    );
  }

  // Fan-out the GHL calls in parallel; everything is read-only so we
  // can race them safely. fetchContactCountForTag is approximate, see
  // the docblock on lib/highlevel.ts.
  const [snapshot, tags] = await Promise.all([
    fetchContactsSnapshot(10),
    fetchTags(),
  ]);

  // Per-tag counts: known Tournamental tags get their own card.
  const TRACKED_TAGS = ["player", "syndicate_owner", "has_pool", "tournament:fifa-wc-2026"];
  const tagCounts = await Promise.all(
    TRACKED_TAGS.map(async (t) => ({
      tag: t,
      count: (await fetchContactCountForTag(t)) ?? 0,
    })),
  );

  // Drift: how many users in auth.db vs how many contacts in GHL.
  const adb = authDb();
  const localUsers = adb
    ? ((adb.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number }).c)
    : 0;
  const ghlTotal = snapshot?.total ?? 0;
  const drift = localUsers - ghlTotal;
  const driftTone: "good" | "danger" =
    Math.abs(drift) <= Math.max(1, Math.ceil(localUsers * 0.1)) ? "good" : "danger";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">HighLevel</h1>
        <p className="text-sm text-ink-200">
          CRM sub-account <span className="font-mono text-xs">{process.env.GHL_LOCATION_ID}</span>.
          Counts refresh on page load.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Contacts in GHL" value={ghlTotal} />
        <StatCard label="Users in our DB" value={localUsers} />
        <StatCard
          label="Drift"
          value={`${drift >= 0 ? "+" : ""}${drift}`}
          tone={driftTone === "good" ? "good" : "danger"}
          hint={
            drift === 0
              ? "Every user is synced"
              : drift > 0
                ? `${drift} users haven't reached GHL yet`
                : `${-drift} GHL contacts have no local user (legacy / manual adds)`
          }
        />
        <StatCard label="Tags defined" value={tags?.length ?? 0} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">
          Tag breakdown
        </h2>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
          {tagCounts.map((t) => (
            <div key={t.tag} className="px-4 py-2 flex justify-between text-sm">
              <span className="font-mono text-xs text-ink-200">{t.tag}</span>
              <span className="text-ink-50">{t.count}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-500 mt-2">
          Counts use the GHL substring `query=` filter, so they're approximate
          when a tag name is a substring of another tag.
        </p>
      </section>

      <section>
        <div className="flex items-end justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-500">
            Recent contacts ({snapshot?.recent.length ?? 0})
          </h2>
          <span className="text-xs text-ink-500">
            Fetched {fmtRelative(snapshot?.fetchedAt ?? null)}
          </span>
        </div>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-200">
              <tr>
                <th className="text-left text-xs uppercase px-4 py-2">Name</th>
                <th className="text-left text-xs uppercase px-4 py-2">Email / Phone</th>
                <th className="text-left text-xs uppercase px-4 py-2">Tags</th>
                <th className="text-left text-xs uppercase px-4 py-2">Source</th>
                <th className="text-left text-xs uppercase px-4 py-2">Added</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.recent ?? []).map((c) => (
                <tr key={c.id} className="border-t border-ink-700">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 text-xs text-ink-200">
                    {c.email ?? c.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-200"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-200">{c.source ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-500">
                    {fmtRelative(c.dateAdded)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-xs text-ink-200">
        <strong className="text-ink-50">Where the writes come from.</strong>{" "}
        New registrations push to <code className="font-mono">/contacts/upsert</code>{" "}
        from <code className="font-mono">apps/auth-sms</code>; new pools push the
        owner from <code className="font-mono">apps/web</code>; ongoing
        lifecycle events come through <code className="font-mono">apps/crm-bridge</code>.
        See <Link href="/audit-log" className="text-accent-400 hover:underline">audit log</Link> for
        every admin-initiated touch.
      </section>
    </div>
  );
}
