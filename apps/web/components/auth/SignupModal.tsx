"use client";

/**
 * SignupModal, the in-app sign-in / sign-up sheet.
 *
 * Single-screen layout, no tabs:
 *
 *   1. Telegram Login Widget (blue button, renders inline). Free,
 *      worldwide, one-tap. Verified directly by auth-sms against the
 *      bot token, no Supabase / Aiva in the loop.
 *   2. WhatsApp deep-link (green button). User taps, WhatsApp opens
 *      with "login" pre-typed, they send, auth-sms replies with a code
 *      + magic link.
 *   3. SMS deep-link (small grey link, footer). Only useful from NZ
 *      (+64) or AU (+61) phones; labelled as such.
 *
 * Below those three, a 6-digit code-paste form for users who'd rather
 * type the code than tap the magic link.
 *
 * The Telegram and WhatsApp paths both set the apex-domain
 * `tnm_session` cookie via auth.tournamental.com. useUser() picks it up
 * on the next probe.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  signInWithTelegram,
  type TelegramAuthPayload,
} from "@/lib/auth/signIn";
import {
  requestEmailOtp,
  smsLoginDeepLink,
  verifyEmailOtp,
  verifyInboundCode,
  whatsAppLoginDeepLink,
  WHATSAPP_NUMBER,
} from "@/lib/auth/inbound-login";
import "./signup-modal.css";
// Reuse the auth-page primitives (auth-input, auth-submit, auth-error).
import "@/app/auth/auth.css";

/**
 * Legacy hint kept as a no-op so existing call sites (AuthChip,
 * ProfilePage) and test fixtures don't need an immediate cleanup pass.
 * The single-screen modal shows all three options at once.
 */
export type SignupTab = "email" | "telegram" | "whatsapp";

export interface SignupModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Where to redirect after a successful sign-in (unused in the
      single-screen modal; cookies + useUser re-probe handle it). */
  readonly redirectTo?: string;
  /** Legacy: which tab to open first. The new modal has no tabs; this
      prop is accepted and ignored for source-compatibility. */
  readonly initialTab?: SignupTab;
}

export function SignupModal({ open, onClose }: SignupModalProps) {
  // Portal to <body> so the modal escapes any ancestor that creates a
  // new containing block (the appbar uses backdrop-filter, which makes
  // `position: fixed` anchor to the appbar — collapsing the backdrop
  // to the appbar's ~100px height instead of full viewport).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const modal = (
    <div
      className="vt-signup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vt-signup-title"
      onClick={(e) => {
        // Close when the user clicks outside the card. With the
        // wrapper-div pattern, "outside" means the inner flex wrapper
        // (which is the click target when the empty padding is hit).
        if (
          e.target === e.currentTarget ||
          (e.target as HTMLElement).classList?.contains("vt-signup-scroll")
        ) {
          onClose();
        }
      }}
    >
      <div className="vt-signup-scroll">
        <div className="vt-signup-card">
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

          <SignInOptions />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ---------------- Single-screen sign-in options ----------------

function SignInOptions() {
  return (
    <div className="vt-signin-stack">
      <TelegramButton />
      <WhatsAppButton />
      <EmailBlock />
      <CodePasteForm />
      <SmsFooter />
    </div>
  );
}

// ---------------- EMAIL (request + verify) ----------------

/**
 * Two-step email flow: type address → tap "Email me a code" → paste the
 * 6-digit code that arrives → signed in. Lives next to Telegram + WhatsApp
 * as a peer option for users who don't use either, especially on shared
 * desktops where typing an email is faster than opening a phone app.
 */
function EmailBlock() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"address" | "code" | "success">("address");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await requestEmailOtp(email);
    setBusy(false);
    if (!result.ok) {
      setError(humanReadable(result.error));
      return;
    }
    setStage("code");
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await verifyEmailOtp(email, code);
    setBusy(false);
    if (!result.ok) {
      setError(humanReadable(result.error));
      return;
    }
    setStage("success");
    window.setTimeout(() => window.location.reload(), 1200);
  };

  if (stage === "success") {
    return (
      <div className="vt-signup-success" role="status">
        ✅ Signed in as <strong>{email}</strong>. Welcome.
      </div>
    );
  }

  return (
    <div className="vt-signin-block">
      <div className="vt-signin-divider">
        <span>or by email</span>
      </div>
      {stage === "address" ? (
        <form className="vt-signup-form" onSubmit={onRequest}>
          <input
            aria-label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            disabled={busy || !email}
          >
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form className="vt-signup-form" onSubmit={onVerify}>
          <p className="auth-info" style={{ fontSize: 12, opacity: 0.7 }}>
            Code sent to <strong>{email}</strong>. Check your inbox.
          </p>
          <input
            aria-label="6-digit code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123 456"
            className="auth-input auth-input-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
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
            {busy ? "Verifying…" : "Sign in with email code"}
          </button>
          <button
            type="button"
            className="vt-signup-link"
            onClick={() => {
              setStage("address");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------- TELEGRAM (Login Widget) ----------------

function TelegramButton() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const botUsername =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "TournamentalGamesBot";

    interface WindowWithCallback extends Window {
      __vtornTelegramAuth?: (payload: TelegramAuthPayload) => void;
    }
    (window as WindowWithCallback).__vtornTelegramAuth = async (payload) => {
      setBusy(true);
      setError(null);
      const result = await signInWithTelegram(payload);
      setBusy(false);
      if (!result.ok) {
        setError(humanReadable(result.error));
        return;
      }
      setSuccess(true);
      window.setTimeout(() => window.location.reload(), 1200);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "__vtornTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    mount.appendChild(script);

    return () => {
      if (mount.contains(script)) mount.removeChild(script);
      delete (window as WindowWithCallback).__vtornTelegramAuth;
    };
  }, []);

  if (success) {
    return (
      <div className="vt-signup-success" role="status">
        ✅ Signed in with Telegram. Welcome back.
      </div>
    );
  }

  return (
    <div className="vt-signin-block">
      <div
        ref={mountRef}
        className="vt-telegram-mount"
        aria-busy={busy}
        aria-label="Sign in with Telegram"
      />
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------- WHATSAPP (deep-link) ----------------

function WhatsAppButton() {
  return (
    <div className="vt-signin-whatsapp-wrap">
      <a
        href={whatsAppLoginDeepLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="vt-signin-btn vt-signin-btn-whatsapp"
      >
        <span className="vt-signin-btn-icon" aria-hidden="true">
          {/* WhatsApp glyph */}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
          </svg>
        </span>
        Sign in/up with WhatsApp
      </a>
      {/* Cross-device fallback for users without WhatsApp on this
        * device: send a plain "login" text from any messaging client.
        * The inbound-login flow on auth-sms picks it up and replies
        * with the magic link + 6-digit code. (Tim 2026-05-22) */}
      <p className="vt-signin-whatsapp-hint">
        Or text <strong>login</strong> to{" "}
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=login`}
          target="_blank"
          rel="noopener noreferrer"
        >
          +{formatWhatsAppNumber(WHATSAPP_NUMBER)}
        </a>{" "}
        to get a magic link and instantly sign in.
      </p>
    </div>
  );
}

/** Pretty-print the raw E.164 string (no plus sign) used as our
 * WhatsApp number into "64 20 4259 096" for the sign-in hint. Keep
 * the implementation in this file so the SignupModal renders without
 * a round-trip through `lib/`. */
function formatWhatsAppNumber(raw: string): string {
  // Hard-coded to NZ +64 for now; if we ever pick up a second WA
  // number this becomes a tiny country-prefix lookup.
  if (raw.startsWith("64") && raw.length === 11) {
    return `64 ${raw.slice(2, 4)} ${raw.slice(4, 8)} ${raw.slice(8)}`;
  }
  return raw;
}

// ---------------- 6-digit code paste ----------------

function CodePasteForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ phone: string | null } | null>(
    null,
  );
  // Ref guards against synchronous double-submits (button double-tap,
  // React Strict Mode dev double-render, form-submit + Enter-key
  // racing). useState alone can't catch these because the second call
  // fires before the first setState commits.
  const inFlightRef = useRef(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current || success) return;
    inFlightRef.current = true;
    setError(null);
    setBusy(true);
    const result = await verifyInboundCode(code);
    if (!result.ok) {
      // Only unlock the in-flight guard on failure so the user can
      // retry with a corrected code.
      inFlightRef.current = false;
      setBusy(false);
      setError(humanReadable(result.error));
      return;
    }
    // Keep busy=true and inFlightRef.current=true through reload so
    // any late re-render or accidental tap can't fire a second submit.
    setSuccess({ phone: result.user.phone });
    window.setTimeout(() => window.location.reload(), 1200);
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
    <div className="vt-signin-codeblock">
      <div className="vt-signin-divider">
        <span>Already got a 6-digit code?</span>
      </div>
      <form className="vt-signup-form" onSubmit={onSubmit}>
        <input
          aria-label="6-digit code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123 456"
          className="auth-input auth-input-code"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
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
          {busy ? "Verifying…" : "Sign in with code"}
        </button>
      </form>
    </div>
  );
}

// ---------------- SMS footer (NZ + AU only) ----------------

function SmsFooter() {
  return (
    <div className="vt-signin-sms-footer">
      <a
        href={smsLoginDeepLink()}
        className="vt-signin-sms-link"
      >
        Sign in by SMS
      </a>
      <span className="vt-signin-sms-note">
        New Zealand &amp; Australia only · message <strong>login</strong> to{" "}
        <code>+{WHATSAPP_NUMBER}</code>
      </span>
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
    case "unknown":
      return "That code didn't match. It may have already been used or expired, tap WhatsApp, SMS, or 'Email me a code' for a fresh one.";
    case "cooldown":
      return "Give it 60 seconds before requesting another email code.";
    case "hourly-cap":
      return "Too many codes sent to this address. Try again in an hour, or use Telegram or WhatsApp.";
    case "send-failed":
      return "Couldn't send the email. Double-check the address and try again.";
    case "not-configured":
      return "Email sign-in isn't configured on this environment.";
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
