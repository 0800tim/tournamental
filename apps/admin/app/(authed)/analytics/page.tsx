import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";
import { FunnelChart } from "./FunnelChart";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await requireAuth();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const data = await Api.funnel(session, from, to);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Analytics</h1>
        <p className="text-sm text-ink-200">
          GA4-style conversion funnel + retention from the canonical event store
          (docs/23).{" "}
          <span className="text-ink-500">
            {from} → {to}
          </span>
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="D1 retention" value={`${(data.retention_d1 * 100).toFixed(1)}%`} />
        <StatCard label="D7 retention" value={`${(data.retention_d7 * 100).toFixed(1)}%`} />
        <StatCard label="D30 retention" value={`${(data.retention_d30 * 100).toFixed(1)}%`} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">
          Conversion funnel
        </h2>
        <FunnelChart steps={data.steps} />
      </section>
    </div>
  );
}
