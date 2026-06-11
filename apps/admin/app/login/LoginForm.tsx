"use client";

import { useState } from "react";

/**
 * Two-step OTP form for the admin step-up gate.
 *
 * Step 1: chooser of three send channels.
 *           - WhatsApp (primary, what we have used historically)
 *           - SMS      (NZ/AU primary fallback when WhatsApp is degraded)
 *           - Email    (transport-of-last-resort; survives Meta + carrier
 *                       outages because it goes through SendGrid)
 *         No input fields — the destination is hardcoded server-side so
 *         an attacker who clears Cloudflare Access still cannot route
 *         the OTP to a destination they control.
 *
 * Step 2: 6-digit code input. The selected channel travels with the
 *         verify request so the upstream call hits the right path
 *         (`/v1/auth/verify` for phone, `/v1/auth/email/verify` for
 *         email). On success the server sets `admin_session` and we
 *         hard-redirect to `next` (defaults to `/`).
 *
 * Tim 2026-06-12: added SMS + email fallback after a Meta-side WhatsApp
 * account suspension locked the admin out for ten hours.
 */
type Channel = "whatsapp" | "sms" | "email";

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

export function LoginForm({
  next,
  disabled,
}: {
  next: string;
  disabled: boolean;
}) {
  const [stage, setStage] = useState<"send" | "enter">("send");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Channel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(viaChannel: Channel) {
    if (disabled || busy) return;
    setBusy(viaChannel);
    setErr(null);
    try {
      const r = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: viaChannel }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(errorLabel(data.error) ?? "Could not send the code.");
        return;
      }
      setChannel(viaChannel);
      setStage("enter");
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit code.");
      return;
    }
    setBusy(channel);
    setErr(null);
    try {
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, channel }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(errorLabel(data.error) ?? "Verification failed.");
        return;
      }
      window.location.assign(next || "/");
    } finally {
      setBusy(null);
    }
  }

  if (stage === "send") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-200">
          Pick a delivery channel. We'll send a 6-digit code to the
          admin's hard-wired destination.
        </p>
        <SendButton
          channel="whatsapp"
          label="Send code via WhatsApp"
          busy={busy}
          disabled={disabled}
          onClick={() => sendCode("whatsapp")}
        />
        <SendButton
          channel="sms"
          label="Send code via SMS"
          busy={busy}
          disabled={disabled}
          onClick={() => sendCode("sms")}
          tone="secondary"
        />
        <SendButton
          channel="email"
          label="Send code via Email"
          busy={busy}
          disabled={disabled}
          onClick={() => sendCode("email")}
          tone="secondary"
        />
        {err && <div className="text-xs text-danger-500">{err}</div>}
        <p className="text-[11px] text-ink-300 mt-1 leading-relaxed">
          WhatsApp is the default. SMS works whenever WhatsApp is
          degraded. Email is the lock-out fallback, configure
          ADMIN_EMAIL to enable it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-3">
      <label
        htmlFor="admin-otp"
        className="text-xs uppercase tracking-wider text-ink-200"
      >
        Enter the 6-digit code sent via {CHANNEL_LABEL[channel]}
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
        onChange={(e) =>
          setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
        }
        disabled={disabled || !!busy}
        placeholder="123456"
        className="bg-ink-900 border border-ink-700 rounded px-3 py-2 text-ink-50 text-center tracking-[0.5em] font-mono text-lg focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50"
      />
      {err && <div className="text-xs text-danger-500">{err}</div>}
      <button
        type="submit"
        disabled={!!busy || disabled || code.length !== 6}
        className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-ink-50 rounded py-2 font-medium"
      >
        {busy ? "Verifying..." : "Enter dashboard"}
      </button>
      <div className="flex justify-between text-xs text-ink-200">
        <button
          type="button"
          onClick={() => {
            setStage("send");
            setCode("");
            setErr(null);
          }}
          disabled={!!busy}
          className="hover:text-ink-50 underline-offset-2 hover:underline"
        >
          Use a different channel
        </button>
        <button
          type="button"
          onClick={() => sendCode(channel)}
          disabled={!!busy}
          className="hover:text-ink-50 underline-offset-2 hover:underline"
        >
          Resend
        </button>
      </div>
    </form>
  );
}

function SendButton({
  channel,
  label,
  busy,
  disabled,
  onClick,
  tone = "primary",
}: {
  channel: Channel;
  label: string;
  busy: Channel | null;
  disabled: boolean;
  onClick: () => void;
  tone?: "primary" | "secondary";
}) {
  const isBusy = busy === channel;
  const base =
    tone === "primary"
      ? "bg-accent-600 hover:bg-accent-500 text-ink-50"
      : "bg-ink-800 hover:bg-ink-700 text-ink-50 border border-ink-700";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!busy || disabled}
      className={`${base} disabled:opacity-40 disabled:cursor-not-allowed rounded py-2 font-medium`}
    >
      {isBusy ? "Sending..." : label}
    </button>
  );
}

function errorLabel(code: unknown): string | null {
  if (code === "rate_limited") return "Slow down, try again in a minute.";
  if (code === "bad_code") return "That code didn't match. Try again.";
  if (code === "not_admin") return "This account isn't on the admin list.";
  if (code === "login_disabled")
    return "Login is disabled. Check ADMIN_PHONE_E164 + ADMIN_ALLOWED_USER_IDS.";
  if (code === "email_not_configured")
    return "Email fallback isn't configured. Set ADMIN_EMAIL in the admin env.";
  if (code === "upstream_unreachable") return "Auth service is unreachable.";
  if (code === "upstream_error") return "Auth service rejected the request.";
  return null;
}
