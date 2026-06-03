import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { fetchCustomer360 } from "@/lib/customer360";
import { liveUserPools } from "@/lib/live";
import { HumannessChip } from "@/components/HumannessChip";
import { PunditChip } from "@/components/PunditChip";
import { StatCard } from "@/components/StatCard";
import { Customer360Tabs } from "./Customer360Tabs";

export const dynamic = "force-dynamic";

/** Tolerant date renderer: epoch-0 / null / unparsable → "unknown". */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < 86_400_000) return "unknown";
  return new Date(t).toLocaleDateString();
}

/**
 * Mirror of apps/web/lib/share/handle-slug.ts. Lowercase, decompose
 * accents, drop everything outside [a-z0-9_-], must be 2..32 chars and
 * not collide with the guid / u_<hex> shapes the resolver handles
 * separately. Inlined here so admin doesn't cross-import from the web
 * app. Returns null when the display_name is empty or too short.
 */
function slugifyDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]/g, "");
  if (s.length < 2 || s.length > 32) return null;
  if (/^[0-9a-f]{16}$/.test(s)) return null;
  if (/^u_[0-9a-f]{16,32}$/.test(s)) return null;
  return s;
}

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
  const userPools = liveUserPools(params.id) ?? [];
  const ownedSlugs = userPools.filter((p) => p.role === "owner").map((p) => p.slug);

  // Friendly /s/<handle> share link. Falls back to the immutable
  // /s/<userId> path when display_name can't be cleanly slugified, so
  // every user has a clickable public profile from the admin view.
  const handle = slugifyDisplayName(u.display_name);
  const profileSlug = handle ?? u.id;
  const profileUrl = `https://play.tournamental.com/s/${encodeURIComponent(profileSlug)}`;

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
          {u.brackets.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-500">No brackets yet.</div>
          ) : (
            u.brackets.map((b) => (
              <div key={b.id} className="px-4 py-3 flex justify-between text-sm">
                <span>{b.tournament}</span>
                <span className="text-ink-200">
                  Rank <span className="font-mono">#{b.rank}</span>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-500">
            Pools ({userPools.length})
          </h2>
          {ownedSlugs.length > 0 && (
            <Link
              href={`/broadcast?${ownedSlugs.map((s) => `slug=${encodeURIComponent(s)}`).join("&")}`}
              className="text-xs text-accent-400 hover:underline"
            >
              Message all owned pools →
            </Link>
          )}
        </div>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
          {userPools.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-500">
              This user doesn't belong to any pools yet.
            </div>
          ) : (
            userPools.map((p) => (
              <div key={p.slug} className="px-4 py-2 flex justify-between text-sm">
                <Link
                  href={`/syndicates/${p.slug}`}
                  className="text-ink-50 hover:text-accent-400"
                >
                  {p.name}
                </Link>
                <span className="text-xs text-ink-500">
                  {p.role === "owner" ? "owner" : "member"} ·{" "}
                  {p.is_public ? "public" : "private"}
                </span>
              </div>
            ))
          )}
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
          <h1 className="text-2xl font-display font-semibold mt-1">
            {u.display_name}
            {handle && (
              <span className="ml-2 text-base font-normal text-ink-500">
                @{handle}
              </span>
            )}
          </h1>
          <div className="text-sm text-ink-200 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs">{u.id}</span>
            <span>· {u.email}</span>
            <span>· {u.country}</span>
            <HumannessChip score={u.humanness} />
            <PunditChip status={customer360.pundit} />
          </div>
          <div className="mt-2 text-sm">
            <a
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-400 hover:underline break-all"
            >
              {profileUrl} ↗
            </a>
          </div>
        </div>
        <div className="text-xs text-ink-500">
          Joined {fmtDate(u.joined_at)} · Last seen {fmtDate(u.last_seen)}
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
