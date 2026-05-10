import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { fetchCustomer360 } from "@/lib/customer360";
import { HumannessChip } from "@/components/HumannessChip";
import { PunditChip } from "@/components/PunditChip";
import { StatCard } from "@/components/StatCard";
import { Customer360Tabs } from "./Customer360Tabs";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAuth();
  const [u, customer360] = await Promise.all([
    Api.user(session, params.id),
    fetchCustomer360(params.id),
  ]);

  // The original "Profile" view (kept verbatim) becomes the body of the
  // Profile tab; the new tabs surface predictions, syndicates, revenue, and
  // social around it.
  const profileSlot = (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Predictions" value={u.predictions_count} />
        <StatCard label="Humanness" value={u.humanness} />
        <StatCard
          label="Status"
          value={u.status}
          tone={u.status === "banned" ? "danger" : "default"}
        />
        <StatCard label="Brackets" value={u.brackets.length} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">Brackets</h2>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
          {u.brackets.map((b) => (
            <div key={b.id} className="px-4 py-3 flex justify-between text-sm">
              <span>{b.tournament}</span>
              <span className="text-ink-200">
                Rank <span className="font-mono">#{b.rank}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {customer360.pundit?.verified && (
        <section data-testid="pundit-panel">
          <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">
            Verified Pundit
          </h2>
          <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-3">
              <PunditChip status={customer360.pundit} />
              <span className="text-ink-200">
                Level {customer360.pundit.levels} · since{" "}
                {customer360.pundit.sinceDate
                  ? new Date(customer360.pundit.sinceDate).toLocaleDateString()
                  : "—"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {customer360.pundit.tournaments.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-ink-700 px-2 py-0.5 text-xs text-ink-200 font-mono"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="text-xs text-ink-500">
              Top-100 finish on a settled tournament leaderboard. Foundation for
              the contributor revenue-share signal (docs/19) — payouts are
              parked until the Drips Network integration ships.
            </p>
          </div>
        </section>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <Link href="/users" className="text-xs text-accent-400 hover:underline">
            ← All users
          </Link>
          <h1 className="text-2xl font-display font-semibold mt-1">{u.display_name}</h1>
          <div className="text-sm text-ink-200 flex items-center gap-2">
            <span className="font-mono text-xs">{u.id}</span>
            <span>· {u.email}</span>
            <span>· {u.country}</span>
            <HumannessChip score={u.humanness} />
            <PunditChip status={customer360.pundit} />
          </div>
        </div>
        <div className="text-xs text-ink-500">
          Joined {new Date(u.joined_at).toLocaleDateString()} · Last seen{" "}
          {new Date(u.last_seen).toLocaleDateString()}
        </div>
      </header>

      <Customer360Tabs
        userId={u.id}
        data={customer360}
        role={session.role}
        profileSlot={profileSlot}
      />
    </div>
  );
}
