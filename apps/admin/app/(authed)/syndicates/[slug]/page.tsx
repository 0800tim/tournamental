import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { StatCard } from "@/components/StatCard";
import type { PendingJoinRequest } from "@/lib/live";
import { PendingMembersPanel } from "./PendingMembersPanel";

export const dynamic = "force-dynamic";

interface ExtendedSyndicate {
  slug: string;
  name: string;
  members: number;
  status: string;
  created_at: string;
  total_stake_units: number;
  members_list: { id: string; handle: string; rank: number }[];
  pending_members?: PendingJoinRequest[];
  is_public?: boolean;
  tier?: string;
  prize_text?: string | null;
  owner_email?: string;
  owner_phone?: string;
  owner_handle?: string | null;
  owner_user_id?: string | null;
  entry_fee_cents?: number | null;
  entry_fee_currency?: string | null;
  tournament_id?: string;
  /** Cached counter from `syndicates.member_count`. Diverges from the
   *  real membership table when an anonymous user clicks join but never
   *  completes signup. */
  members_cached?: number;
}

function maskPhone(p?: string): string {
  if (!p || p.length < 6) return p ?? "—";
  return `${p.slice(0, 3)}${"*".repeat(p.length - 7)}${p.slice(-4)}`;
}

export default async function SyndicateDetailPage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
  const session = await requireAuth();
  const s = (await Api.syndicate(session, params.slug)) as unknown as ExtendedSyndicate;

  const visibility = s.is_public ? "public" : "private";
  const entryFee =
    typeof s.entry_fee_cents === "number"
      ? `${(s.entry_fee_cents / 100).toFixed(2)} ${s.entry_fee_currency ?? "NZD"}`
      : "free";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <Link href="/syndicates" className="text-xs text-accent-400 hover:underline">
            ← All syndicates
          </Link>
          <h1 className="text-2xl font-display font-semibold mt-1">{s.name}</h1>
          <div className="text-sm text-ink-200">
            <span className="font-mono text-xs">{s.slug}</span> · {visibility} ·{" "}
            <span className="uppercase">{s.tier ?? "free"}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end whitespace-nowrap">
          <a
            href={`/api/admin/syndicates/${encodeURIComponent(s.slug)}/impersonate`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-400 hover:underline"
            title="Mints a 30-minute manage token and opens the public pool manage page"
          >
            Send bulk invites ↗
          </a>
          <a
            href={`https://play.tournamental.com/s/${encodeURIComponent(s.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-400 hover:underline"
          >
            View public page ↗
          </a>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Members"
          value={s.members}
          hint={
            typeof s.members_cached === "number" && s.members_cached !== s.members
              ? `Public counter says ${s.members_cached}; drift from anonymous join clicks`
              : undefined
          }
        />
        <StatCard label="Visibility" value={visibility} />
        <StatCard label="Tier" value={(s.tier ?? "free").toUpperCase()} />
        <StatCard label="Entry fee" value={entryFee} />
        <StatCard
          label="Total stake (NZD)"
          value={s.total_stake_units.toLocaleString()}
        />
        <StatCard label="Created" value={new Date(s.created_at).toLocaleDateString()} />
        <StatCard label="Tournament" value={s.tournament_id ?? "—"} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
          <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">Prize</h2>
          {s.prize_text ? (
            <p className="text-sm text-ink-50 whitespace-pre-line">{s.prize_text}</p>
          ) : (
            <p className="text-sm text-ink-500">No prize set.</p>
          )}
        </div>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
          <h2 className="text-sm uppercase tracking-wider text-ink-500 mb-2">Owner</h2>
          <dl className="text-sm space-y-1">
            <Row k="Handle" v={s.owner_handle ?? "—"} />
            <Row k="User id" v={s.owner_user_id ?? "—"} mono />
            <Row k="Email" v={s.owner_email ?? "—"} />
            <Row k="Phone" v={maskPhone(s.owner_phone)} />
          </dl>
          {s.owner_user_id && (
            <Link
              href={`/users/${s.owner_user_id}`}
              className="text-accent-400 hover:underline text-xs mt-3 inline-block"
            >
              Open owner profile →
            </Link>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-500">
            Pending join requests ({(s.pending_members ?? []).length})
          </h2>
        </div>
        <div className="rounded-lg ring-1 ring-amber-700/40 bg-ink-800">
          <PendingMembersPanel
            slug={s.slug}
            pending={s.pending_members ?? []}
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-500">
            Members ({s.members_list.length})
          </h2>
          <Link
            href={`/broadcast?slug=${encodeURIComponent(s.slug)}`}
            className="text-xs text-accent-400 hover:underline"
          >
            Message all members →
          </Link>
        </div>
        <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 divide-y divide-ink-700">
          {s.members_list.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-500">No members yet.</div>
          ) : (
            s.members_list.map((m) => (
              <div key={m.id} className="px-4 py-2 flex justify-between text-sm">
                <span>
                  <span className="font-mono text-xs text-ink-500 mr-2">#{m.rank}</span>
                  {m.handle}
                </span>
                <Link
                  href={`/users/${m.id}`}
                  className="text-accent-400 hover:underline text-xs"
                >
                  Open user
                </Link>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-200 whitespace-nowrap">{k}</span>
      <span
        className={`text-ink-50 text-right break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
