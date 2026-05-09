"use client";

import { useState } from "react";

export function LoginForm({ next, disabled }: { next: string; disabled: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || busy) return;
        setBusy(true);
        setErr(null);
        try {
          const r = await fetch("/api/auth/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, next }),
          });
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            setErr(data.error ?? "Could not send link.");
          } else {
            // Always redirect to the same "we sent it" page even on a
            // non-allowlisted email, so we don't leak which addresses
            // are admins (enumeration defence).
            window.location.assign(`/login?sent=1&next=${encodeURIComponent(next)}`);
          }
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-3"
    >
      <label className="text-xs uppercase tracking-wider text-ink-200">
        Admin email
      </label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={disabled}
        placeholder="you@vtourn.com"
        className="bg-ink-900 border border-ink-700 rounded px-3 py-2 text-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50"
      />
      {err && <div className="text-xs text-danger-500">{err}</div>}
      <button
        type="submit"
        disabled={busy || disabled}
        className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-ink-50 rounded py-2 font-medium"
      >
        {busy ? "Sending..." : "Send sign-in link"}
      </button>
    </form>
  );
}
