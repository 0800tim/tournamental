import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const session = await requireAuth();
  const data = await Api.content(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Content moderation</h1>
        <p className="text-sm text-ink-200">
          User-generated text: display names, avatars, bracket descriptions.
          Flagged items appear first. Auto-flagging from `apps/api` content
          filter; manual review here.
        </p>
      </header>

      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-200">
            <tr>
              <th className="text-left text-xs uppercase px-4 py-2">Kind</th>
              <th className="text-left text-xs uppercase px-4 py-2">User</th>
              <th className="text-left text-xs uppercase px-4 py-2">Content</th>
              <th className="text-left text-xs uppercase px-4 py-2">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <tr key={c.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                <td className="px-4 py-2 font-mono text-xs">{c.kind}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.user}</td>
                <td className="px-4 py-2 max-w-md truncate" title={c.text}>
                  {c.text}
                </td>
                <td className="px-4 py-2">
                  {c.flagged ? (
                    <span className="text-danger-500 text-xs uppercase">flagged</span>
                  ) : (
                    <span className="text-ink-500 text-xs">ok</span>
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
