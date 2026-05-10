"use client";

import { useState } from "react";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  /** User must type this exact string into the box before "Confirm" enables.
   *  Set to undefined to skip the typed-confirmation hurdle. */
  confirmPhrase?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Generic destructive-action confirm modal. Mirrors <BanDialog>'s shape and
 * accessibility behaviour so the dashboard's modals look and feel uniform.
 */
export function ConfirmDialog({
  title,
  body,
  confirmPhrase,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const phraseOk = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 bg-ink-900/80 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-ink-800 ring-1 ring-ink-700 rounded-lg w-full max-w-md p-6">
        <h2 id="confirm-dialog-title" className="text-lg font-display font-semibold mb-2">
          {title}
        </h2>
        <p className="text-sm text-ink-200 mb-4 whitespace-pre-line">{body}</p>
        {confirmPhrase && (
          <>
            <label className="block text-xs uppercase tracking-wider text-ink-200 mb-1">
              Type <span className="font-mono text-ink-50">{confirmPhrase}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1 text-sm text-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-500"
              aria-label="confirm phrase"
            />
          </>
        )}
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
            disabled={busy || !phraseOk}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            className={[
              "px-3 py-1.5 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed",
              destructive
                ? "bg-danger-600 hover:bg-danger-500"
                : "bg-accent-600 hover:bg-accent-500",
            ].join(" ")}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
