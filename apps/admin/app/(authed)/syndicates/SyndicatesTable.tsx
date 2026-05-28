"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import type { SyndicateRow } from "@/lib/api";

/** Extended row carrying the public/private flag + prize text the live
 *  reader surfaces. The base `SyndicateRow` type tolerates the extras
 *  because the table just walks accessor keys. */
interface SyndicateTableRow extends SyndicateRow {
  is_public?: boolean;
  prize_text?: string | null;
  tier?: string;
  owner_handle?: string | null;
}

export function SyndicatesTable({ rows }: { rows: SyndicateTableRow[] }) {
  const columns = useMemo<ColumnDef<SyndicateTableRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            href={`/syndicates/${row.original.slug}`}
            className="text-accent-400 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: (c) => <span className="font-mono text-xs">{c.getValue() as string}</span>,
      },
      {
        accessorKey: "is_public",
        header: "Visibility",
        cell: ({ row }) => {
          const isPublic = row.original.is_public === true;
          return (
            <span
              className={`text-xs uppercase tracking-wider ${
                isPublic ? "text-accent-400" : "text-ink-200"
              }`}
            >
              {isPublic ? "public" : "private"}
            </span>
          );
        },
      },
      { accessorKey: "members", header: "Members" },
      {
        accessorKey: "tier",
        header: "Tier",
        cell: ({ row }) => (
          <span className="text-xs uppercase">{row.original.tier ?? "free"}</span>
        ),
      },
      {
        accessorKey: "prize_text",
        header: "Prize",
        cell: ({ row }) => {
          const p = row.original.prize_text ?? "";
          if (!p) return <span className="text-ink-500">—</span>;
          return (
            <span className="text-xs text-ink-100 line-clamp-1" title={p}>
              {p}
            </span>
          );
        },
      },
      {
        accessorKey: "owner_handle",
        header: "Owner",
        cell: ({ row }) => (
          <span className="text-xs text-ink-200">
            {row.original.owner_handle ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => new Date(row.original.created_at).toLocaleDateString(),
      },
      {
        accessorKey: "total_stake_units",
        header: "Total stake",
        cell: ({ row }) => row.original.total_stake_units.toLocaleString(),
      },
    ],
    [],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchKeys={["name", "slug", "prize_text", "owner_handle"]}
      caption="Syndicates"
    />
  );
}
