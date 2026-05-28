import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { liveRecentPools, liveRecentSignups } from "@/lib/live";
import { StatCard } from "@/components/StatCard";
import { GeoMap } from "@/components/GeoMap";
import { RevenueChart } from "@/components/RevenueChart";

export const dynamic = "force-dynamic";

function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < 86_400_000) return "unknown";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString();
}

interface ExtendedOverview {
  dau: number;
  signups_today: number;
  predictions_today: number;
  active_tournaments: number;
  concurrent_viewers: number;
  share_clicks_today: number;
  affiliate_clickouts_today: number;
  revenue_units_today: number;
  by_country: { country: string; users: number }[];
  signups_7d: { day: string; count: number }[];
  total_users?: number;
  total_pools?: number;
  public_pools?: number;
  private_pools?: number;
  pools_with_prizes?: number;
}

export default async function OverviewPage() {
  const session = await requireAuth();
  const stats = (await Api.overview(session)) as unknown as ExtendedOverview;
  const recentSignups = liveRecentSignups(8) ?? [];
  const recentPools = liveRecentPools(8) ?? [];

  const totalUsers = stats.total_users ?? 0;
  const totalPools = stats.total_pools ?? 0;
  const publicPools = stats.public_pools ?? 0;
  const privatePools = stats.private_pools ?? 0;
  const poolsWithPrizes = stats.pools_with_prizes ?? 0;

  // One-line "you asked" summary that answers the original ops
  // questions at a glance: who's signed up, what pools exist, public
  // vs private, and prizes. Tim's specific ask 2026-05-28.
  const summary =
    `You have ${totalUsers.toLocaleString()} ` +
    `user${totalUsers === 1 ? "" : "s"}, ` +
    `${totalPools.toLocaleString()} pool${totalPools === 1 ? "" : "s"} ` +
    `(${publicPools} public, ${privatePools} private), ` +
    `${poolsWithPrizes} with prizes set, and ` +
    `${stats.active_tournaments} active tournament${stats.active_tournaments === 1 ? "" : "s"}.`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Overview</h1>
        <p className="text-sm text-ink-200">
          Live counts from auth.db (users) and game.db (pools, brackets).
          Refresh the page to recompute.
        </p>
      </header>

      <section className="rounded-lg border border-accent-700/40 bg-accent-700/10 px-5 py-4">
        <p className="text-sm text-ink-50">{summary}</p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total users" value={totalUsers} />
        <StatCard label="Signups today" value={stats.signups_today} tone="good" />
        <StatCard label="Active in last 24h" value={stats.dau} />
        <StatCard label="Brackets locked today" value={stats.predictions_today} />
        <StatCard label="Total pools" value={totalPools} tone="good" />
        <StatCard label="Public pools" value={publicPools} />
        <StatCard label="Private pools" value={privatePools} />
        <StatCard label="Pools with prizes" value={poolsWithPrizes} />
        <StatCard label="Active tournaments" value={stats.active_tournaments} />
        <StatCard
          label="Pool entry-fee total"
          value={`${stats.revenue_units_today.toLocaleString()} units`}
          hint="Sum across all pools (NZD)"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RevenueChart data={stats.signups_7d} metric="signups" />
        <GeoMap data={stats.by_country} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-sm uppercase tracking-wider text-ink-500">Recent signups</h2>
            <Link href="/users" className="text-xs text-accent-400 hover:underline">
              All users →
            </Link>
          </div>
          {recentSignups.length === 0 ? (
            <p className="text-sm text-ink-500">No signups yet.</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {recentSignups.map((u) => (
                <li key={u.id} className="py-2 flex justify-between text-sm">
                  <Link
                    href={`/users/${u.id}`}
                    className="text-ink-50 hover:text-accent-400 truncate"
                  >
                    {u.display_name}
                  </Link>
                  <span className="text-xs text-ink-500 whitespace-nowrap">
                    {u.country} · {fmtRelative(u.joined_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-sm uppercase tracking-wider text-ink-500">Recent pools</h2>
            <Link href="/syndicates" className="text-xs text-accent-400 hover:underline">
              All pools →
            </Link>
          </div>
          {recentPools.length === 0 ? (
            <p className="text-sm text-ink-500">No pools yet.</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {recentPools.map((p) => (
                <li key={p.slug} className="py-2 flex justify-between gap-3 text-sm">
                  <Link
                    href={`/syndicates/${p.slug}`}
                    className="text-ink-50 hover:text-accent-400 truncate"
                  >
                    {p.name}
                    <span className="ml-2 text-xs text-ink-500">
                      {p.is_public ? "public" : "private"}
                      {p.owner_handle ? ` · @${p.owner_handle}` : ""}
                    </span>
                  </Link>
                  <span className="text-xs text-ink-500 whitespace-nowrap">
                    {fmtRelative(p.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
