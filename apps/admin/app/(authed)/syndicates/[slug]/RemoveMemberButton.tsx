"use client";

/**
 * "Remove user" button on the admin syndicate detail page.
 *
 * Confirms before sending DELETE
 * /api/admin/syndicates/[slug]/members/[userId]; on success, reloads
 * the page so the Members list (and the cached member count above it)
 * re-renders from the database. Tim 2026-06-04.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RemoveMemberButtonProps {
  readonly slug: string;
  readonly userId: string;
  readonly handle: string;
}

export function RemoveMemberButton({
  slug,
  userId,
  handle,
}: RemoveMemberButtonProps): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick(): Promise<void> {
    if (busy) return;
    const ok = window.confirm(
      `Remove ${handle || "this user"} from this pool? They'll lose access to the leaderboard and their picks won't count. This can't be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/syndicates/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(`Removal failed: ${body.error ?? res.statusText}`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      window.alert(
        `Network error: ${e instanceof Error ? e.message : "unknown"}`,
      );
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-rose-400 hover:underline text-xs disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy ? "Removing…" : "Remove user"}
    </button>
  );
}
