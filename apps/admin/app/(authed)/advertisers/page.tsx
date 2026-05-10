import { requireAuth } from "@/lib/auth";
import { listAdvertisers, revenueSummary } from "@/lib/ops-store";
import { StatCard } from "@/components/StatCard";
import { AdvertisersTable } from "./AdvertisersTable";

export const dynamic = "force-dynamic";

export default async function AdvertisersPage() {
  const session = await requireAuth();
  const [rows, rev] = await Promise.all([listAdvertisers(), revenueSummary()]);

  const active = rows.filter((r) => r.status === "active").length;
  const totalImpressions = rows.reduce((s, r) => s + r.impressions_7d, 0);
  const avgFill = rows.length
    ? rows.reduce((s, r) => s + r.fill_rate_pct, 0) / rows.length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Advertisers</h1>
        <p className="text-sm text-ink-200">
          Display-ad placements by surface, geo and tournament. Edits are
          super-admin only. v0.1 uses on-disk JSONL; production wiring lives in
          docs/30.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Campaigns" value={rows.length} />
        <StatCard label="Active" value={active} tone="good" />
        <StatCard
          label="Avg fill rate"
          value={`${avgFill.toFixed(1)}%`}
        />
        <StatCard
          label="Impressions 7d"
          value={totalImpressions.toLocaleString()}
        />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Operator rev 7d"
          value={`${rev.operator_units_7d.toLocaleString()} u`}
        />
        <StatCard
          label="Advertiser rev 7d"
          value={`${rev.advertiser_units_7d.toLocaleString()} u`}
        />
        <StatCard
          label="Drips rev 7d"
          value={`${rev.drips_units_7d.toLocaleString()} u`}
        />
        <StatCard
          label="Total rev 7d"
          value={`${rev.total_units_7d.toLocaleString()} u`}
          tone="good"
        />
      </section>

      <AdvertisersTable rows={rows} role={session.role} />
    </div>
  );
}
