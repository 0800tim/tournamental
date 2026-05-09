import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const session = await requireAuth();
  const data = await Api.tournaments(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Tournaments</h1>
        <p className="text-sm text-ink-200">
          Manage state per tournament. Toggle active state, lock entries,
          force-recompute leaderboards. Mod+ can edit.
        </p>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">Name</th>
              <th className="text-left text-xs uppercase px-4 py-2">Status</th>
              <th className="text-left text-xs uppercase px-4 py-2">Entries</th>
              <th className="text-left text-xs uppercase px-4 py-2">Lock at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((t) => (
              <tr key={t.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                <td className="px-4 py-2">{t.name}</td>
                <td className="px-4 py-2 text-xs uppercase">{t.status}</td>
                <td className="px-4 py-2">{t.entries.toLocaleString()}</td>
                <td className="px-4 py-2 text-xs text-ink-200">
                  {new Date(t.lock_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs text-ink-500">
                  Edit not yet wired (super-admin only)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
