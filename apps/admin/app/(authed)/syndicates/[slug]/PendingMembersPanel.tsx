"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PendingJoinRequest } from "@/lib/live";

interface Props {
  readonly slug: string;
  readonly pending: ReadonlyArray<PendingJoinRequest>;
}

type RowState =
  | { kind: "idle" }
  | { kind: "working"; action: "approve" | "deny" }
  | { kind: "error"; message: string };

/**
 * Renders the pending join queue for a pool with Approve / Deny
 * buttons next to each row. Each click POSTs to the admin route and
 * refreshes the server component on success so the row falls out of
 * the queue and into the active members list above.
 */
export function PendingMembersPanel({ slug, pending }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  if (pending.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-ink-500">
        No pending join requests.
      </div>
    );
  }

  async function run(userId: string, action: "approve" | "deny") {
    setRowState((s) => ({ ...s, [userId]: { kind: "working", action } }));
    try {
      const r = await fetch(
        `/api/admin/syndicates/${encodeURIComponent(slug)}/join-requests/${encodeURIComponent(userId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setRowState((s) => ({
          ...s,
          [userId]: { kind: "error", message: body.error ?? `http_${r.status}` },
        }));
        return;
      }
      setRowState((s) => {
        const { [userId]: _drop, ...rest } = s;
        void _drop;
        return rest;
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setRowState((s) => ({
        ...s,
        [userId]: {
          kind: "error",
          message: err instanceof Error ? err.message : "network",
        },
      }));
    }
  }

  function fmtAgo(epoch: number): string {
    const ms = Date.now() - epoch;
    if (!Number.isFinite(ms) || ms < 0) return "just now";
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  return (
    <ul className="divide-y divide-ink-700">
      {pending.map((m) => {
        const state = rowState[m.user_id] ?? { kind: "idle" };
        const working = state.kind === "working";
        return (
          <li
            key={m.user_id}
            className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
          >
            <div className="min-w-0">
              <div className="text-ink-50">
                {m.display_name}
                {m.handle && (
                  <span className="ml-2 text-xs text-ink-500">@{m.handle}</span>
                )}
              </div>
              <div className="text-xs text-ink-500 flex items-center gap-2 mt-0.5">
                <span className="font-mono">{m.user_id}</span>
                <span>· requested {fmtAgo(m.joined_at)}</span>
              </div>
              {state.kind === "error" && (
                <div className="text-xs text-rose-400 mt-1">
                  Action failed: {state.message}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={working}
                onClick={() => run(m.user_id, "approve")}
                className="rounded-md bg-accent-500/20 text-accent-300 hover:bg-accent-500/30 disabled:opacity-50 px-3 py-1 text-xs font-medium"
              >
                {working && state.action === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => run(m.user_id, "deny")}
                className="rounded-md bg-ink-700 text-ink-200 hover:bg-ink-600 disabled:opacity-50 px-3 py-1 text-xs"
              >
                {working && state.action === "deny" ? "Denying…" : "Deny"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
