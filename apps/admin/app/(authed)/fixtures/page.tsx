import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FixturesPage() {
  const session = await requireAuth();
  const data = await Api.fixtures(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Fixtures</h1>
        <p className="text-sm text-ink-200">
          Live tournament fixtures. Mods can override results when match
          data is wrong (rare; always logged).
        </p>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">Tournament</th>
              <th className="text-left text-xs uppercase px-4 py-2">Match</th>
              <th className="text-left text-xs uppercase px-4 py-2">Kickoff</th>
              <th className="text-left text-xs uppercase px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((f) => (
              <tr key={f.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                <td className="px-4 py-2">{f.tournament}</td>
                <td className="px-4 py-2 font-mono text-xs">{f.teams}</td>
                <td className="px-4 py-2 text-xs text-ink-200">
                  {new Date(f.kickoff).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs uppercase">{f.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
