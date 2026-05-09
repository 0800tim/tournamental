import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

export default async function SyndicateDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const session = await requireAuth();
  const s = await Api.syndicate(session, params.slug);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/syndicates" className="text-xs text-accent-400 hover:underline">
          ← All syndicates
        </Link>
        <h1 className="text-2xl font-display font-semibold mt-1">{s.name}</h1>
        <div className="text-sm text-ink-200">
          <span className="font-mono text-xs">{s.slug}</span> · {s.status}
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Members" value={s.members} />
        <StatCard label="Total stake" value={s.total_stake_units} />
        <StatCard label="Status" value={s.status} />
        <StatCard label="Created" value={new Date(s.created_at).toLocaleDateString()} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">Members (top)</h2>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
          {s.members_list.map((m) => (
            <div key={m.id} className="px-4 py-2 flex justify-between text-sm">
              <span>
                <span className="font-mono text-xs text-ink-500 mr-2">#{m.rank}</span>
                {m.handle}
              </span>
              <Link href={`/users/${m.id}`} className="text-accent-400 hover:underline text-xs">
                Open user
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
