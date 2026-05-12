"use client";

/**
 * SignupModal, the in-app sign-in / sign-up sheet.
 *
 * Three tabs at the top: Email, Telegram, WhatsApp. Each tab is a tiny
 * form with one input and one button. The "unconfigured" state (no
 * Supabase env vars) renders a single "Sign in coming soon" message and
 * disables all inputs, this is what `pnpm dev` sees on a fresh checkout.
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
  type TelegramAuthPayload,
} from "@/lib/auth/signIn";
import {
  detectSmsCountry,
  smsLoginDeepLink,
  verifyInboundCode,
  whatsAppLoginDeepLink,
  WHATSAPP_NUMBER,
} from "@/lib/auth/inbound-login";
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
  initialTab = "whatsapp",
  redirectTo,
}: SignupModalProps) {
  const [tab, setTab] = useState<SignupTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Supabase-gated paths (email + Telegram). The WhatsApp tab uses the
  // standalone inbound-login flow at auth.tournamental.com and works
  // without Supabase.
  const supabaseConfigured = useMemo(() => readPublicConfig() !== null, []);

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

        <div className="vt-signup-tabs" role="tablist" aria-label="Sign-in method">
          {TABS.map((t) => {
            // Email + Telegram still ride Supabase; gate them when
            // Supabase isn't configured. WhatsApp is always available
            // (inbound-login flow, no Supabase dependency).
            const tabDisabled = t.id !== "whatsapp" && !supabaseConfigured;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                data-active={tab === t.id ? "1" : "0"}
                type="button"
                className="vt-signup-tab"
                onClick={() => setTab(t.id)}
                disabled={tabDisabled}
                title={tabDisabled ? "Coming soon" : undefined}
              >
                <span className="vt-signup-tab-icon" aria-hidden="true">
                  {t.icon}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "email" && (
          <EmailTab disabled={!supabaseConfigured} redirectTo={redirectTo} />
        )}
        {tab === "telegram" && <TelegramTab disabled={!supabaseConfigured} />}
        {tab === "whatsapp" && <WhatsAppTab />}
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
        Check your inbox, we sent a magic link to <strong>{email}</strong>.
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

// ---------------- WHATSAPP + SMS (inbound-login flow) ----------------

/**
 * The inbound-login flow: user messages the keyword `login` to our
 * public WhatsApp / SMS number, the Aiva SMS gateway forwards the
 * inbound message to auth.tournamental.com, the auth-sms service
 * replies with a 6-digit code + a one-tap magic link, and the user
 * either taps the link (`?v=<token>` → MagicLinkConsumer) or pastes
 * the code here.
 *
 * No phone number to type. No Supabase needed.
 */
function WhatsAppTab() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsCountry, setSmsCountry] = useState<"NZ" | "AU" | null>(null);
  const [success, setSuccess] = useState<{ phone: string | null } | null>(null);

  useEffect(() => {
    setSmsCountry(detectSmsCountry());
  }, []);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await verifyInboundCode(code);
    setBusy(false);
    if (!result.ok) {
      setError(humanReadable(result.error));
      return;
    }
    // Cookie is set on .tournamental.com; surface the success state
    // in-place rather than reloading, since the play app's user hook
    // now picks up tnm_session automatically on its next probe.
    setSuccess({ phone: result.user.phone });
    // Soft-reload after a short pause so any cached SSR / RSC
    // state flips to the authed view.
    window.setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  if (success) {
    return (
      <div className="vt-signup-success" role="status">
        ✅ Signed in
        {success.phone ? (
          <>
            {" "}
            as <strong>{success.phone}</strong>
          </>
        ) : null}
        . Welcome back.
      </div>
    );
  }

  return (
    <div className="auth-telegram">
      <p className="auth-info" style={{ marginTop: 4 }}>
        Tap the green button. WhatsApp opens with <strong>login</strong> already
        typed; press send. We reply in seconds with a one-tap sign-in link plus
        a 6-digit code.
      </p>
      <a
        href={whatsAppLoginDeepLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="auth-submit"
        style={{
          background: "#25D366",
          color: "#0a0e1a",
          borderColor: "#1eb456",
          display: "block",
          textAlign: "center",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        Sign in with WhatsApp →
      </a>
      {smsCountry ? (
        <a
          href={smsLoginDeepLink()}
          className="vt-signup-link"
          style={{ display: "block", textAlign: "center", marginBottom: 16 }}
        >
          …or sign in with SMS (you&apos;re in {smsCountry})
        </a>
      ) : (
        <p
          className="auth-info"
          style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}
        >
          SMS sign-in is available in NZ + AU only. Use WhatsApp from anywhere
          else.
        </p>
      )}

      <p className="auth-info" style={{ fontSize: 12, opacity: 0.7 }}>
        Already received your code? Paste it here:
      </p>
      <form className="auth-form vt-signup-form" onSubmit={submitCode}>
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
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          disabled={busy}
        />
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="auth-submit"
          disabled={busy || code.length !== 6}
        >
          {busy ? "Verifying…" : "Sign in"}
        </button>
      </form>
      <p
        className="auth-info"
        style={{ fontSize: 11, opacity: 0.55, marginTop: 12, textAlign: "center" }}
      >
        Manually: message <strong>login</strong> to <code>+{WHATSAPP_NUMBER}</code>
      </p>
    </div>
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
    case "bad-body":
      return "Enter the 6-digit code.";
    case "send-failed":
      return "Couldn't send the code. Try again in a moment.";
    case "verify-failed":
    case "unknown-or-expired":
      return "That code is wrong, expired, or already used. Message 'login' again.";
    case "fingerprint-mismatch":
      return "This code was first used on a different device. Use that device, or message 'login' again.";
    case "ip-throttled":
      return "Too many sign-in attempts from this network. Try again in a few minutes.";
    case "network":
      return "Couldn't reach the sign-in service. Check your connection.";
    case "telegram-failed":
      return "Telegram login didn't go through. Try again.";
    default:
      return error ?? "Something went wrong. Try again.";
  }
}
