"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import type { AdvertiserRecord } from "@/lib/ops-store";
import type { Role } from "@/lib/perms";

export function AdvertisersTable({
  rows,
  role,
}: {
  rows: AdvertiserRecord[];
  role: Role;
}) {
  const canWrite = role === "super-admin";
  const [list, setList] = useState(rows);
  const [error, setError] = useState<string | null>(null);

  async function togglePause(id: string, current: AdvertiserRecord["status"]) {
    setError(null);
    const next = current === "active" ? "paused" : "active";
    const res = await fetch(`/api/advertisers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setError(`Update failed (${res.status}).`);
      return;
    }
    const updated = (await res.json()) as AdvertiserRecord;
    setList((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }

  const columns = useMemo<ColumnDef<AdvertiserRecord, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Campaign",
        cell: ({ row }) => (
          <Link
            href={`/advertisers/${row.original.id}`}
            className="text-accent-400 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "surface",
        header: "Surface",
        cell: (c) => <span className="text-xs uppercase">{c.getValue() as string}</span>,
      },
      { accessorKey: "tournament", header: "Tournament" },
      {
        accessorKey: "geo_allow",
        header: "Geo",
        cell: ({ row }) => (
          <span className="text-xs font-mono" title={row.original.geo_allow.join(", ")}>
            {row.original.geo_allow.length} country
            {row.original.geo_allow.length === 1 ? "" : "s"}
          </span>
        ),
      },
      {
        accessorKey: "fill_rate_pct",
        header: "Fill",
        cell: ({ row }) => `${row.original.fill_rate_pct.toFixed(1)}%`,
      },
      {
        accessorKey: "ecpm_units",
        header: "eCPM",
        cell: ({ row }) => `${row.original.ecpm_units.toFixed(2)} u`,
      },
      {
        accessorKey: "revenue_units_7d",
        header: "Revenue 7d",
        cell: ({ row }) => row.original.revenue_units_7d.toLocaleString(),
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
            onClick={() => togglePause(row.original.id, row.original.status)}
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
        searchKeys={["name", "tournament", "surface"]}
        caption="Advertisers"
      />
    </div>
  );
}
