import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getOperator } from "@/lib/ops-store";
import { StatCard } from "@/components/StatCard";
import { OperatorEditForm } from "./OperatorEditForm";

export const dynamic = "force-dynamic";

export default async function OperatorDetailPage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
  const session = await requireAuth();
  const op = await getOperator(params.slug);
  if (!op) notFound();

  const canWrite = session.role === "super-admin";
  const cvr = op.clicks_7d ? (op.conversions_7d / op.clicks_7d) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">{op.name}</h1>
          <p className="text-sm text-ink-200">
            <Link href="/operators" className="text-accent-400 hover:underline">
              Operators
            </Link>
            {" / "}
            <span className="font-mono">{op.slug}</span>
            {" · "}
            <span className="uppercase text-xs">{op.kind}</span>
          </p>
        </div>
        {!canWrite && (
          <span className="text-xs text-ink-200">
            Read-only — super-admin required to edit.
          </span>
        )}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Clicks 7d" value={op.clicks_7d} />
        <StatCard label="Conversions 7d" value={op.conversions_7d} tone="good" />
        <StatCard label="CVR" value={`${cvr.toFixed(2)}%`} />
        <StatCard
          label="Revenue 7d"
          value={`${op.revenue_units_7d.toLocaleString()} units`}
          tone="good"
        />
      </section>

      <OperatorEditForm operator={op} canWrite={canWrite} />
    </div>
  );
}
