"use client";

import { useState } from "react";

/**
 * Two-step OTP form for the admin step-up gate.
 *
 * Step 1: a single "Send code" button. No phone input — the admin phone
 *         is hardcoded server-side so an attacker who clears Cloudflare
 *         Access still can't route an OTP to a number they control.
 *
 * Step 2: 6-digit code input. On success the server sets `admin_session`
 *         and we hard-redirect to `next` (defaults to `/`).
 */
export function LoginForm({ next, disabled }: { next: string; disabled: boolean }) {
  const [stage, setStage] = useState<"send" | "enter">("send");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode() {
    if (disabled || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(errorLabel(data.error) ?? "Could not send the code.");
        return;
      }
      setStage("enter");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(errorLabel(data.error) ?? "Verification failed.");
        return;
      }
      window.location.assign(next || "/");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "send") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-200">
          Press the button below. We'll send a 6-digit code to the admin's
          WhatsApp.
        </p>
        <button
          type="button"
          onClick={sendCode}
          disabled={busy || disabled}
          className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-ink-50 rounded py-2 font-medium"
        >
          {busy ? "Sending..." : "Send code"}
        </button>
        {err && <div className="text-xs text-danger-500">{err}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-3">
      <label htmlFor="admin-otp" className="text-xs uppercase tracking-wider text-ink-200">
        Enter the 6-digit code
      </label>
      <input
        id="admin-otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        disabled={disabled || busy}
        placeholder="123456"
        className="bg-ink-900 border border-ink-700 rounded px-3 py-2 text-ink-50 text-center tracking-[0.5em] font-mono text-lg focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50"
      />
      {err && <div className="text-xs text-danger-500">{err}</div>}
      <button
        type="submit"
        disabled={busy || disabled || code.length !== 6}
        className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-ink-50 rounded py-2 font-medium"
      >
        {busy ? "Verifying..." : "Enter dashboard"}
      </button>
      <button
        type="button"
        onClick={() => {
          setStage("send");
          setCode("");
          setErr(null);
        }}
        disabled={busy}
        className="text-xs text-ink-200 hover:text-ink-50 underline-offset-2 hover:underline self-start"
      >
        Resend
      </button>
    </form>
  );
}

function errorLabel(code: unknown): string | null {
  if (code === "rate_limited") return "Slow down, try again in a minute.";
  if (code === "bad_code") return "That code didn't match. Try again.";
  if (code === "not_admin") return "This account isn't on the admin list.";
  if (code === "login_disabled")
    return "Login is disabled. Check ADMIN_PHONE_E164 + ADMIN_ALLOWED_USER_IDS.";
  if (code === "upstream_unreachable") return "Auth service is unreachable.";
  if (code === "upstream_error") return "Auth service rejected the request.";
  return null;
}
