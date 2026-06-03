import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { UsersTable } from "./UsersTable";

export const dynamic = "force-dynamic";

export default async function UsersPage(
  props: {
    searchParams: Promise<{ q?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireAuth();
  const q = searchParams.q ?? "";
  const page = Math.max(1, Number(searchParams.page ?? "1"));
  const data = await Api.users(session, q, page);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold">Users</h1>
          <p className="text-sm text-ink-200">
            {data.total.toLocaleString()} accounts. Search by id, email, or display name.
            Humanness from docs/20.
          </p>
        </div>
        <a
          href="/api/admin/export/users"
          className="text-xs text-accent-400 hover:underline whitespace-nowrap"
        >
          Export CSV ↓
        </a>
      </header>

      <UsersTable initial={data.rows} role={session.role} />

      <div className="text-xs text-ink-500">
        Showing page {page}.{" "}
        <Link className="text-accent-400 hover:underline" href={`/users?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
          Next page →
        </Link>
      </div>
    </div>
  );
}
