import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";
import { GeoMap } from "@/components/GeoMap";
import { RevenueChart } from "@/components/RevenueChart";

export const dynamic = "force-dynamic";

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

  const totalUsers = stats.total_users ?? 0;
  const totalPools = stats.total_pools ?? 0;
  const publicPools = stats.public_pools ?? 0;
  const privatePools = stats.private_pools ?? 0;
  const poolsWithPrizes = stats.pools_with_prizes ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Overview</h1>
        <p className="text-sm text-ink-200">
          Live counts from auth.db (users) and game.db (pools, brackets).
          Refresh the page to recompute.
        </p>
      </header>

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
    </div>
  );
}
