"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState, type ReactNode } from "react";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  initialPageSize?: number;
  /** When set, a search box appears that performs a free-text contains
   * filter across the columns whose `accessorKey` matches one of these. */
  searchKeys?: string[];
  emptyMessage?: ReactNode;
  caption?: string;
}

export function DataTable<T>({
  data,
  columns,
  initialPageSize = 25,
  searchKeys,
  emptyMessage,
  caption,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const filterFn = useMemo(() => {
    if (!searchKeys || searchKeys.length === 0) return undefined;
    return (row: any, _id: string, value: string) => {
      const v = String(value ?? "").toLowerCase();
      if (!v) return true;
      for (const k of searchKeys) {
        const cell = row.getValue(k);
        if (cell == null) continue;
        if (String(cell).toLowerCase().includes(v)) return true;
      }
      return false;
    };
  }, [searchKeys]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: filterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  return (
    <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 overflow-hidden">
      {searchKeys && searchKeys.length > 0 && (
        <div className="px-4 py-3 border-b border-ink-700 flex items-center gap-3">
          <input
            type="search"
            placeholder="Search..."
            aria-label="Search table"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 w-72 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <span className="text-xs text-ink-500">
            {table.getFilteredRowModel().rows.length} of {data.length} rows
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={caption}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-ink-900 text-ink-200">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      className="text-left text-xs uppercase tracking-wider px-4 py-2 font-medium select-none"
                      aria-sort={
                        sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"
                      }
                    >
                      {h.isPlaceholder ? null : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-ink-50"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sort === "asc" ? "▲" : sort === "desc" ? "▼" : ""}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-ink-200"
                >
                  {emptyMessage ?? "No rows."}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-ink-700 hover:bg-ink-700/40">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2 text-ink-100">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-ink-700 flex items-center justify-between text-xs text-ink-200">
        <div>
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {Math.max(1, table.getPageCount())}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
