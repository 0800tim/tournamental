"use client";

import { useState } from "react";

export interface BanDialogProps {
  userId: string;
  displayName: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}

export function BanDialog({ userId, displayName, onConfirm, onCancel }: BanDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ban-dialog-title"
      className="fixed inset-0 bg-ink-900/80 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-ink-800 ring-1 ring-ink-700 rounded-lg w-full max-w-md p-6">
        <h2 id="ban-dialog-title" className="text-lg font-display font-semibold mb-2">
          Ban user?
        </h2>
        <p className="text-sm text-ink-200 mb-4">
          You are about to ban <span className="font-mono text-ink-50">{displayName}</span>{" "}
          (<span className="font-mono text-xs">{userId}</span>). This is reversible
          but will immediately revoke their session and hide their content.
        </p>
        <label className="block text-xs uppercase tracking-wider text-ink-200 mb-1">
          Reason (required)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-500"
          placeholder="e.g. Coordinated multi-account abuse on bracket leaderboard"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-ink-700 hover:bg-ink-600 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-1.5 rounded bg-danger-600 hover:bg-danger-500 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Banning..." : "Ban user"}
          </button>
        </div>
      </div>
    </div>
  );
}
