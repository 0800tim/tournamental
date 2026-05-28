"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import type { OperatorRecord } from "@/lib/ops-store";
import type { Role } from "@/lib/perms";

export function OperatorsTable({
  rows,
  role,
}: {
  rows: OperatorRecord[];
  role: Role;
}) {
  const canWrite = role === "super-admin";
  const [list, setList] = useState(rows);
  const [error, setError] = useState<string | null>(null);

  async function togglePause(slug: string, current: OperatorRecord["status"]) {
    setError(null);
    const next = current === "active" ? "paused" : "active";
    const res = await fetch(`/api/operators/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.reason ?? `Update failed (${res.status}).`);
      return;
    }
    const updated = (await res.json()) as OperatorRecord;
    setList((prev) => prev.map((p) => (p.slug === slug ? updated : p)));
  }

  const columns = useMemo<ColumnDef<OperatorRecord, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            href={`/operators/${row.original.slug}`}
            className="text-accent-400 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "kind",
        header: "Kind",
        cell: (c) => <span className="text-xs uppercase">{c.getValue() as string}</span>,
      },
      {
        accessorKey: "geo_allow",
        header: "Allow",
        cell: ({ row }) => (
          <span className="text-xs font-mono">
            {row.original.geo_allow.length}{" "}
            {row.original.geo_allow.length === 1 ? "country" : "countries"}
          </span>
        ),
      },
      {
        accessorKey: "geo_deny",
        header: "Deny",
        cell: ({ row }) => {
          const denies = row.original.geo_deny;
          const nzBlocked = denies.includes("NZ");
          return (
            <span
              className={`text-xs font-mono ${
                nzBlocked ? "text-emerald-500" : "text-ink-200"
              }`}
              title={denies.join(", ") || "(none)"}
            >
              {nzBlocked ? "NZ blocked" : `${denies.length} blocked`}
            </span>
          );
        },
      },
      {
        accessorKey: "revenue_share_pct",
        header: "Rev share",
        cell: ({ row }) => `${row.original.revenue_share_pct}%`,
      },
      {
        accessorKey: "clicks_7d",
        header: "Clicks 7d",
      },
      {
        accessorKey: "conversions_7d",
        header: "Conv 7d",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status;
          const tone = s === "active" ? "text-emerald-500" : "text-flame-500";
          return <span className={`text-xs uppercase ${tone}`}>{s}</span>;
        },
      },
      {
        id: "pause",
        header: "Action",
        cell: ({ row }) => (
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => togglePause(row.original.slug, row.original.status)}
            className="text-xs px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Toggle pause for ${row.original.name}`}
          >
            {row.original.status === "active" ? "Pause" : "Resume"}
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite],
  );

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div role="alert" className="text-xs text-danger-500">
          {error}
        </div>
      )}
      <DataTable
        data={list}
        columns={columns}
        searchKeys={["name", "kind"]}
        caption="Operators"
      />
    </div>
  );
}
