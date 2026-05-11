"use client";

/**
 * SignupModal — the in-app sign-in / sign-up sheet.
 *
 * Three tabs at the top: Email, Telegram, WhatsApp. Each tab is a tiny
 * form with one input and one button. The "unconfigured" state (no
 * Supabase env vars) renders a single "Sign in coming soon" message and
 * disables all inputs — this is what `pnpm dev` sees on a fresh checkout.
 *
 * The modal is intentionally self-contained: it doesn't import the
 * shell layout primitives (AppShell, AppBar) so other parts of the app
 * can mount it from anywhere.
 *
 * Replaces the salvaged custom-auth registration sheet from the sister
 * agent's PR; uses Supabase Auth as the only backend.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  signInWithMagicLink,
  signInWithTelegram,
  signInWithWhatsAppOtp,
  verifyWhatsAppOtp,
  type TelegramAuthPayload,
} from "@/lib/auth/signIn";
import { readPublicConfig } from "@/lib/auth/config";
import "./signup-modal.css";
// Reuse the auth-page primitives (auth-input, auth-submit, auth-error).
import "@/app/auth/auth.css";

export type SignupTab = "email" | "telegram" | "whatsapp";

export interface SignupModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Default tab on open. */
  readonly initialTab?: SignupTab;
  /** Where to redirect after a successful sign-in. */
  readonly redirectTo?: string;
}

const TABS: { id: SignupTab; label: string; icon: string }[] = [
  { id: "email", label: "Email", icon: "✉" },
  { id: "telegram", label: "Telegram", icon: "✈" },
  { id: "whatsapp", label: "WhatsApp", icon: "✆" },
];

export function SignupModal({
  open,
  onClose,
  initialTab = "email",
  redirectTo,
}: SignupModalProps) {
  const [tab, setTab] = useState<SignupTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const configured = useMemo(() => readPublicConfig() !== null, []);

  if (!open) return null;

  return (
    <div
      className="vt-signup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vt-signup-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vt-signup-card" style={{ position: "relative" }}>
        <button
          type="button"
          className="vt-signup-close"
          aria-label="Close sign-in"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="vt-signup-title" className="vt-signup-title">
          Save your bracket
        </h2>
        <p className="vt-signup-sub">
          One tap to keep your picks, follow friends, and see your rank live.
        </p>

        {!configured && (
          <div className="vt-signup-banner" role="status">
            Sign-in coming soon. You can still build a bracket as a guest —
            picks are saved on this device.
          </div>
        )}

        <div className="vt-signup-tabs" role="tablist" aria-label="Sign-in method">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              data-active={tab === t.id ? "1" : "0"}
              type="button"
              className="vt-signup-tab"
              onClick={() => setTab(t.id)}
              disabled={!configured}
            >
              <span className="vt-signup-tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "email" && (
          <EmailTab disabled={!configured} redirectTo={redirectTo} />
        )}
        {tab === "telegram" && <TelegramTab disabled={!configured} />}
        {tab === "whatsapp" && <WhatsAppTab disabled={!configured} />}
      </div>
    </div>
  );
}

// ---------------- EMAIL ----------------

function EmailTab({
  disabled,
  redirectTo,
}: {
  disabled: boolean;
  redirectTo?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signInWithMagicLink(email, redirectTo);
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(humanReadable(result.error));
  };

  if (sent) {
    return (
      <div className="vt-signup-success" role="status">
        Check your inbox — we sent a magic link to <strong>{email}</strong>.
        Tap it to finish signing in.
      </div>
    );
  }

  return (
    <form className="auth-form vt-signup-form" onSubmit={onSubmit}>
      <label className="auth-label" htmlFor="vt-signup-email">
        Email
      </label>
      <input
        id="vt-signup-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        className="auth-input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={busy || disabled}
      />
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button
        type="submit"
        className="auth-submit"
        disabled={busy || disabled || !email}
      >
        {busy ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}

// ---------------- TELEGRAM ----------------

function TelegramTab({ disabled }: { disabled: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (disabled || !mountRef.current) return;
    const mount = mountRef.current;
    const botUsername =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "TournamentalBot";

    // Expose the callback on window so the Telegram widget can call it.
    interface WindowWithCallback extends Window {
      __vtornTelegramAuth?: (payload: TelegramAuthPayload) => void;
    }
    (window as WindowWithCallback).__vtornTelegramAuth = async (payload) => {
      setBusy(true);
      setError(null);
      const result = await signInWithTelegram(payload);
      setBusy(false);
      if (!result.ok) setError(humanReadable(result.error));
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "__vtornTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    mount.appendChild(script);

    return () => {
      if (mount.contains(script)) mount.removeChild(script);
      delete (window as WindowWithCallback).__vtornTelegramAuth;
    };
  }, [disabled]);

  return (
    <div className="auth-telegram">
      <p className="auth-info">
        Sign in with Telegram in one tap. Your username and avatar are imported;
        no password needed.
      </p>
      <div ref={mountRef} className="auth-telegram-mount" aria-busy={busy} />
      {disabled && (
        <p className="auth-info" style={{ fontSize: 12, opacity: 0.6 }}>
          Telegram sign-in becomes available once the Supabase project is
          provisioned.
        </p>
      )}
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------- WHATSAPP OTP ----------------

function WhatsAppTab({ disabled }: { disabled: boolean }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signInWithWhatsAppOtp(phone);
    setBusy(false);
    if (!result.ok) {
      setError(humanReadable(result.error));
      return;
    }
    setStep("code");
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await verifyWhatsAppOtp(phone, code);
    setBusy(false);
    if (!result.ok) {
      setError(humanReadable(result.error));
      return;
    }
    // The auth state listener will fire and close the modal upstream.
  };

  if (step === "phone") {
    return (
      <form className="auth-form vt-signup-form" onSubmit={requestOtp}>
        <label className="auth-label" htmlFor="vt-signup-phone">
          WhatsApp phone number
        </label>
        <input
          id="vt-signup-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+64 21 999 000"
          className="auth-input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          disabled={busy || disabled}
        />
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="auth-submit"
          disabled={busy || disabled || !phone}
        >
          {busy ? "Sending…" : "Send code on WhatsApp"}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form vt-signup-form" onSubmit={submitCode}>
      <p className="auth-info">
        We sent a 6-digit code to <strong>{phone}</strong> on WhatsApp.
      </p>
      <label className="auth-label" htmlFor="vt-signup-code">
        6-digit code
      </label>
      <input
        id="vt-signup-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="123456"
        className="auth-input auth-input-code"
        value={code}
        onChange={(e) =>
          setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
        }
        required
        disabled={busy || disabled}
      />
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button
        type="submit"
        className="auth-submit"
        disabled={busy || disabled || code.length !== 6}
      >
        {busy ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        className="vt-signup-link"
        onClick={() => {
          setStep("phone");
          setCode("");
          setError(null);
        }}
        disabled={busy}
      >
        Use a different number
      </button>
    </form>
  );
}

// ---------------- helpers ----------------

function humanReadable(error?: string): string {
  switch (error) {
    case "unconfigured":
      return "Sign-in isn't wired up yet on this environment.";
    case "bad-email":
      return "That email doesn't look right.";
    case "bad-phone":
      return "Use international format like +6421999000.";
    case "bad-code":
      return "Enter the 6-digit code.";
    case "send-failed":
      return "Couldn't send the code. Try again in a moment.";
    case "verify-failed":
      return "Code didn't match — or it expired. Request a new one.";
    case "telegram-failed":
      return "Telegram login didn't go through. Try again.";
    default:
      return error ?? "Something went wrong. Try again.";
  }
}
