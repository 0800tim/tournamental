import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await requireAuth();
  const data = await Api.auditLog(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Audit log</h1>
        <p className="text-sm text-ink-200">
          Append-only log of every admin action. Includes auth events, bans,
          flag toggles, and key revocations.
        </p>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">When</th>
              <th className="text-left text-xs uppercase px-4 py-2">Actor</th>
              <th className="text-left text-xs uppercase px-4 py-2">Action</th>
              <th className="text-left text-xs uppercase px-4 py-2">Target</th>
              <th className="text-left text-xs uppercase px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((a) => (
              <tr key={a.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                <td className="px-4 py-2 text-xs text-ink-200">
                  {new Date(a.ts).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs">{a.actor}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.action}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.target}</td>
                <td className="px-4 py-2 text-xs text-ink-200 max-w-md truncate">
                  {a.before || a.after
                    ? JSON.stringify({ before: a.before, after: a.after })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
