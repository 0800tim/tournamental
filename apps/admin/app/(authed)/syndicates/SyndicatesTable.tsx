"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import type { SyndicateRow } from "@/lib/api";

export function SyndicatesTable({ rows }: { rows: SyndicateRow[] }) {
  const columns = useMemo<ColumnDef<SyndicateRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link href={`/syndicates/${row.original.slug}`} className="text-accent-400 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: (c) => <span className="font-mono text-xs">{c.getValue() as string}</span>,
      },
      { accessorKey: "members", header: "Members" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status;
          const tone =
            s === "active" ? "text-emerald-500" : s === "pending" ? "text-flame-500" : "text-ink-500";
          return <span className={`text-xs uppercase ${tone}`}>{s}</span>;
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => new Date(row.original.created_at).toLocaleDateString(),
      },
      { accessorKey: "total_stake_units", header: "Total stake" },
    ],
    [],
  );
  return <DataTable data={rows} columns={columns} searchKeys={["name", "slug"]} caption="Syndicates" />;
}
