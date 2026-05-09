import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const session = await requireAuth();
  const data = await Api.apiKeys(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">API keys</h1>
        <p className="text-sm text-ink-200">
          Plaintext keys are{" "}
          <span className="text-danger-500">never</span> shown in the dashboard;
          only the key prefix and metadata. Revocation is super-admin only.
        </p>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">Label</th>
              <th className="text-left text-xs uppercase px-4 py-2">Prefix</th>
              <th className="text-left text-xs uppercase px-4 py-2">Created</th>
              <th className="text-left text-xs uppercase px-4 py-2">Last used</th>
              <th className="text-left text-xs uppercase px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((k) => (
              <tr key={k.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                <td className="px-4 py-2">{k.label}</td>
                <td className="px-4 py-2 font-mono text-xs">{k.prefix}_••••••••</td>
                <td className="px-4 py-2 text-xs text-ink-200">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-xs text-ink-200">
                  {k.last_used ? new Date(k.last_used).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-2 text-xs uppercase">
                  {k.revoked ? (
                    <span className="text-danger-500">revoked</span>
                  ) : (
                    <span className="text-emerald-500">active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
