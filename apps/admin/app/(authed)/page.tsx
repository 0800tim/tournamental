import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";
import { GeoMap } from "@/components/GeoMap";
import { RevenueChart } from "@/components/RevenueChart";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await requireAuth();
  const stats = await Api.overview(session);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Overview</h1>
        <p className="text-sm text-ink-200">
          Live and today metrics. Live counters update every minute via
          /v1/admin/overview (Redis-fanout, see docs/23).
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="DAU" value={stats.dau} delta={{ sign: "up", pct: 12.4, window: "vs 7d avg" }} />
        <StatCard label="Signups today" value={stats.signups_today} delta={{ sign: "up", pct: 4.2 }} />
        <StatCard label="Predictions today" value={stats.predictions_today} delta={{ sign: "up", pct: 8.1 }} />
        <StatCard label="Active tournaments" value={stats.active_tournaments} />
        <StatCard
          label="Concurrent viewers"
          value={stats.concurrent_viewers}
          tone="good"
          hint="Live, last minute"
        />
        <StatCard label="Share clicks today" value={stats.share_clicks_today} />
        <StatCard label="Affiliate clickouts" value={stats.affiliate_clickouts_today} delta={{ sign: "up", pct: 22.7, window: "wow" }} />
        <StatCard
          label="Revenue today"
          value={`${stats.revenue_units_today.toLocaleString()} units`}
          tone="good"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RevenueChart data={stats.signups_7d} metric="signups" />
        <GeoMap data={stats.by_country} />
      </section>
    </div>
  );
}
