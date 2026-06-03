import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAdvertiser } from "@/lib/ops-store";
import { StatCard } from "@/components/StatCard";
import { AdvertiserEditForm } from "./AdvertiserEditForm";

export const dynamic = "force-dynamic";

export default async function AdvertiserDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const session = await requireAuth();
  const adv = await getAdvertiser(params.id);
  if (!adv) notFound();

  const canWrite = session.role === "super-admin";
  const ctr = adv.impressions_7d
    ? (adv.clicks_7d / adv.impressions_7d) * 100
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">{adv.name}</h1>
          <p className="text-sm text-ink-200">
            <Link href="/advertisers" className="text-accent-400 hover:underline">
              Advertisers
            </Link>
            {" / "}
            <span className="font-mono">{adv.id}</span>
            {" · "}
            <span className="uppercase text-xs">{adv.surface}</span>
            {" · "}
            <span className="font-mono text-xs">{adv.tournament}</span>
          </p>
        </div>
        {!canWrite && (
          <span className="text-xs text-ink-200">
            Read-only — super-admin required to edit.
          </span>
        )}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Impressions 7d" value={adv.impressions_7d.toLocaleString()} />
        <StatCard label="Clicks 7d" value={adv.clicks_7d.toLocaleString()} />
        <StatCard label="CTR" value={`${ctr.toFixed(2)}%`} />
        <StatCard
          label="Revenue 7d"
          value={`${adv.revenue_units_7d.toLocaleString()} u`}
          tone="good"
        />
      </section>

      <AdvertiserEditForm advertiser={adv} canWrite={canWrite} />
    </div>
  );
}
