"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import { HumannessChip } from "@/components/HumannessChip";
import { BanDialog } from "@/components/BanDialog";
import type { UserRow } from "@/lib/api";
import type { Role } from "@/lib/perms";

const ROLE_RANK: Record<Role, number> = { viewer: 0, mod: 1, "super-admin": 2 };

export function UsersTable({ initial, role }: { initial: UserRow[]; role: Role }) {
  const [rows, setRows] = useState<UserRow[]>(initial);
  const [banTarget, setBanTarget] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canBan = ROLE_RANK[role] >= ROLE_RANK.mod;

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: "display_name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            href={`/users/${encodeURIComponent(row.original.id)}`}
            className="text-accent-400 hover:underline"
          >
            {row.original.display_name}
          </Link>
        ),
      },
      { accessorKey: "id", header: "ID", cell: (c) => <span className="font-mono text-xs">{c.getValue() as string}</span> },
      { accessorKey: "email", header: "Email" },
      { accessorKey: "country", header: "Geo" },
      {
        accessorKey: "humanness",
        header: "Humanness",
        cell: ({ row }) => <HumannessChip score={row.original.humanness} />,
      },
      { accessorKey: "predictions_count", header: "Preds" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status;
          const tone =
            s === "active"
              ? "text-emerald-500"
              : s === "banned"
                ? "text-danger-500"
                : "text-flame-500";
          return <span className={`text-xs uppercase tracking-wide ${tone}`}>{s}</span>;
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          if (!canBan) return null;
          if (r.status === "banned") {
            return (
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  const res = await fetch(`/api/users/${r.id}/unban`, { method: "POST" });
                  if (!res.ok) {
                    setError(`Unban failed (${res.status}).`);
                    return;
                  }
                  setRows((prev) =>
                    prev.map((p) => (p.id === r.id ? { ...p, status: "active" } : p)),
                  );
                }}
                className="text-xs text-accent-400 hover:underline"
              >
                Unban
              </button>
            );
          }
          return (
            <button
              type="button"
              onClick={() => setBanTarget(r)}
              className="text-xs text-danger-500 hover:underline"
            >
              Ban
            </button>
          );
        },
      },
    ],
    [canBan],
  );

  return (
    <>
      {error && (
        <div role="alert" className="text-xs text-danger-500">
          {error}
        </div>
      )}
      <DataTable
        data={rows}
        columns={columns}
        searchKeys={["display_name", "email", "id", "country"]}
        caption="User accounts"
      />
      {banTarget && (
        <BanDialog
          userId={banTarget.id}
          displayName={banTarget.display_name}
          onCancel={() => setBanTarget(null)}
          onConfirm={async (reason) => {
            setError(null);
            const res = await fetch(`/api/users/${banTarget.id}/ban`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason }),
            });
            if (!res.ok) {
              setError(`Ban failed (${res.status}).`);
              setBanTarget(null);
              return;
            }
            setRows((prev) =>
              prev.map((p) => (p.id === banTarget.id ? { ...p, status: "banned" } : p)),
            );
            setBanTarget(null);
          }}
        />
      )}
    </>
  );
}
