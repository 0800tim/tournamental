import Link from "next/link";
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { SyndicatesTable } from "./SyndicatesTable";

export const dynamic = "force-dynamic";

export default async function SyndicatesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const session = await requireAuth();
  const data = await Api.syndicates(session, searchParams.q ?? "", searchParams.status ?? "");

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Syndicates</h1>
        <p className="text-sm text-ink-200">
          Friend-graph and creator-cohort prediction pools. Filter by status.{" "}
          <Link href="/syndicates" className="text-accent-400 hover:underline">All</Link>{" · "}
          <Link href="/syndicates?status=active" className="text-accent-400 hover:underline">Active</Link>{" · "}
          <Link href="/syndicates?status=pending" className="text-accent-400 hover:underline">Pending</Link>{" · "}
          <Link href="/syndicates?status=closed" className="text-accent-400 hover:underline">Closed</Link>
        </p>
      </header>

      <SyndicatesTable rows={data.rows} />
    </div>
  );
}
