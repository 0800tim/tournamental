"use client";

/**
 * Masked phone or email with an audited "Show".
 *
 * Renders the masked value the server supplied; clicking Show posts to
 * /api/users/:id/reveal, which writes the audit entry and returns the
 * full value. The raw value never reaches the browser until then.
 */
import { useState } from "react";
import type { PiiKind } from "@/lib/pii";

export interface RevealPiiProps {
  readonly userId: string;
  readonly kind: PiiKind;
  /** Masked text from the server, or "" when there is no value. */
  readonly masked: string;
  /** Where to POST { kind }. Defaults to the user reveal route. */
  readonly revealUrl?: string;
  /** Optional: fetch implementation for tests. */
  readonly fetchImpl?: typeof fetch;
}

export function RevealPii({ userId, kind, masked, revealUrl, fetchImpl }: RevealPiiProps) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = kind === "email" ? "email" : "phone";

  if (!masked) return <span className="text-ink-500">—</span>;

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const f = fetchImpl ?? fetch;
      const r = await f(revealUrl ?? `/api/users/${encodeURIComponent(userId)}/reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!r.ok) throw new Error(`reveal ${r.status}`);
      const body = (await r.json()) as { value?: string | null };
      setValue(body.value ?? "");
    } catch {
      setError("Could not reveal; the attempt was still logged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs break-all" data-revealed={value !== null ? "1" : "0"}>
        {value ?? masked}
      </span>
      {value === null ? (
        <button
          type="button"
          className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-200 hover:text-ink-50"
          onClick={reveal}
          disabled={busy}
          aria-busy={busy ? "true" : undefined}
          aria-label={`Show ${label} (this is logged)`}
          title="Logged to the admin audit trail"
        >
          {busy ? "…" : "Show"}
        </button>
      ) : (
        <button
          type="button"
          className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-200 hover:text-ink-50"
          onClick={() => setValue(null)}
          aria-label={`Hide ${label}`}
        >
          Hide
        </button>
      )}
      {error ? <span role="alert" className="text-[10px] text-flame-500">{error}</span> : null}
    </span>
  );
}
