"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest to the server log; the actual rendering
    // never includes the raw error message (PII risk).
    // eslint-disable-next-line no-console
    console.error("[admin] error boundary:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="text-xs uppercase tracking-wider text-danger-500 mb-2">
          Error
        </div>
        <h1 className="text-2xl font-display font-semibold mb-2">
          Something broke.
        </h1>
        <p className="text-sm text-ink-200 mb-4">
          Tell the team and include this code:{" "}
          <code className="font-mono text-ink-50">{error.digest ?? "unknown"}</code>
        </p>
        <button
          type="button"
          onClick={reset}
          className="bg-accent-600 hover:bg-accent-500 text-ink-50 rounded px-3 py-1.5 text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
