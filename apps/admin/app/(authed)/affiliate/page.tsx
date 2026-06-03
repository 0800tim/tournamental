import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

export default async function AffiliatePage(
  props: {
    searchParams: Promise<{ period?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireAuth();
  const period = searchParams.period ?? "7d";
  const data = await Api.affiliateClicks(session, period);
  const conversionRate = data.total_clicks ? (data.conversions / data.total_clicks) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Affiliate revenue</h1>
          <p className="text-sm text-ink-200">
            Polymarket + pay-TV CTR/CVR per docs/30. Period:{" "}
            <span className="font-mono">{period}</span>
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <a className="text-accent-400" href="?period=24h">24h</a>
          <a className="text-accent-400" href="?period=7d">7d</a>
          <a className="text-accent-400" href="?period=30d">30d</a>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total clicks" value={data.total_clicks} />
        <StatCard label="Conversions" value={data.conversions} tone="good" />
        <StatCard label="CVR" value={`${conversionRate.toFixed(2)}%`} />
        <StatCard label="Revenue" value={`${data.total_revenue.toLocaleString()} units`} tone="good" />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">Recent clicks</h2>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-200">
              <tr>
                <th className="text-left text-xs uppercase px-4 py-2">Affiliate</th>
                <th className="text-left text-xs uppercase px-4 py-2">User</th>
                <th className="text-left text-xs uppercase px-4 py-2">Geo</th>
                <th className="text-left text-xs uppercase px-4 py-2">When</th>
                <th className="text-left text-xs uppercase px-4 py-2">Converted</th>
                <th className="text-left text-xs uppercase px-4 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                  <td className="px-4 py-2">{c.affiliate_id}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.user_id}</td>
                  <td className="px-4 py-2">{c.geo_country}</td>
                  <td className="px-4 py-2 text-xs text-ink-200">
                    {new Date(c.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    {c.converted ? (
                      <span className="text-emerald-500 text-xs">YES</span>
                    ) : (
                      <span className="text-ink-500 text-xs">no</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.revenue_units.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
