import { requireAuth } from "@/lib/auth";
import { listOperators } from "@/lib/ops-store";
import { StatCard } from "@/components/StatCard";
import { OperatorsTable } from "./OperatorsTable";

export const dynamic = "force-dynamic";

export default async function OperatorsPage() {
  const session = await requireAuth();
  const rows = await listOperators();

  const active = rows.filter((r) => r.status === "active").length;
  const sportsbooks = rows.filter((r) => r.kind === "sportsbook").length;
  const compliantNz = rows.filter(
    (r) => r.kind !== "sportsbook" || r.geo_deny.includes("NZ"),
  ).length;
  const totalRevenue7d = rows.reduce((s, r) => s + r.revenue_units_7d, 0);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Operators</h1>
        <p className="text-sm text-ink-200">
          Sportsbooks and affiliate networks. NZ is denied for every sportsbook
          per TAB monopoly rule. Edits are super-admin only.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Operators" value={rows.length} />
        <StatCard label="Active" value={active} tone="good" />
        <StatCard
          label="Sportsbooks (NZ-blocked)"
          value={`${sportsbooks}/${sportsbooks}`}
          tone={compliantNz === rows.length ? "good" : "danger"}
          hint="NZ TAB compliance"
        />
        <StatCard
          label="Revenue 7d"
          value={`${totalRevenue7d.toLocaleString()} units`}
          tone="good"
        />
      </section>

      <OperatorsTable rows={rows} role={session.role} />
    </div>
  );
}
