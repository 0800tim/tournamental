"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-900 text-ink-100 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-xs uppercase tracking-wider text-danger-500 mb-2">
            Fatal error
          </div>
          <h1 className="text-2xl font-display font-semibold mb-2">
            Something broke at the root.
          </h1>
          <p className="text-sm text-ink-200 mb-4">
            Code:{" "}
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
      </body>
    </html>
  );
}
