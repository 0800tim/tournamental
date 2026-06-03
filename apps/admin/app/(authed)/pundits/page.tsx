/**
 * Pundit leaderboard. Top users by `brackets.score_total` for the
 * selected tournament. Useful for spotting our power-users + sourcing
 * "verified pundit" candidates for the contributor revenue share
 * (docs/19) once that lands.
 */

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { livePundits } from "@/lib/live";

export const dynamic = "force-dynamic";

export default async function PunditsPage(
  props: {
    searchParams: Promise<{ tournament?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireAuth();
  const tournament = searchParams.tournament ?? "fifa-wc-2026";
  const rows = livePundits(tournament, 50) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Pundits</h1>
          <p className="text-sm text-ink-200">
            Top brackets by score for{" "}
            <span className="font-mono text-xs">{tournament}</span>. Tie-broken
            by who locked their picks first.
          </p>
        </div>
        <a
          href={`/api/admin/export/users`}
          className="text-xs text-accent-400 hover:underline whitespace-nowrap"
        >
          Export users CSV ↓
        </a>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">#</th>
              <th className="text-left text-xs uppercase px-4 py-2">Pundit</th>
              <th className="text-left text-xs uppercase px-4 py-2">Country</th>
              <th className="text-left text-xs uppercase px-4 py-2">Score</th>
              <th className="text-left text-xs uppercase px-4 py-2">Locked</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-ink-500 text-center">
                  No brackets locked for this tournament yet.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.user_id} className="border-t border-ink-700">
                  <td className="px-4 py-2 font-mono text-xs text-ink-500">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/users/${r.user_id}`}
                      className="text-ink-50 hover:text-accent-400"
                    >
                      {r.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-200">
                    {r.country ?? "XX"}
                  </td>
                  <td className="px-4 py-2 font-mono">{r.score}</td>
                  <td className="px-4 py-2 text-xs text-ink-500">
                    {new Date(r.locked_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        Scoring uses the tournament's settle pipeline; until matches lock
        and results come in, every bracket scores 0. Visit{" "}
        <Link href="/tournaments" className="text-accent-400 hover:underline">
          Tournaments
        </Link>{" "}
        for tournament state.
      </p>
    </div>
  );
}
