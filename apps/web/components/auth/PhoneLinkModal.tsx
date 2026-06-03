/**
 * PhoneLinkModal
 *
 * Two-step modal opened from the profile page's "Add phone number"
 * button when an email-OTP-signed-up user has no phone on file.
 *
 *   Step 1, Message login to our WhatsApp.
 *     Tap the green WhatsApp button to open WhatsApp with the body
 *     "login" prefilled to our gateway number. We never ask the user
 *     to type a phone; possession is proven by sending us the inbound
 *     message. (Tim 2026-06-04: "they should just click a button to
 *     say Add phone number, which sends a login to our WhatsApp.")
 *
 *   Step 2, Paste the 6-digit code we reply with.
 *     The gateway POSTs /v1/auth/inbound-login with the message's
 *     sender phone; auth-sms mints an OTP and the gateway sends it
 *     back via WhatsApp. The user pastes that code here. The web
 *     calls /v1/auth/phone-link/verify, which attaches the verified
 *     phone to the signed-in account (cannot hijack: 409 phone-taken
 *     if it already belongs to someone else).
 *
 * The modal is intentionally minimal, same visual rhythm as the
 * sign-in modal's WhatsApp + code-paste section, no fluff.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import {
  WHATSAPP_NUMBER,
  linkPhoneByCode,
  type InboundUser,
} from "@/lib/auth/inbound-login";

import "./signup-modal.css";
import "./phone-link-modal.css";

export interface PhoneLinkModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the updated user record on successful link. */
  readonly onLinked: (user: InboundUser) => void;
}

type Step = "start" | "code";

export function PhoneLinkModal({ open, onClose, onLinked }: PhoneLinkModalProps) {
  const [step, setStep] = useState<Step>("start");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Reset internal state every time the modal opens, so a previous
  // attempt's error / code / step doesn't leak into the next session.
  useEffect(() => {
    if (open) {
      setStep("start");
      setCode("");
      setError(null);
      setBusy(false);
      inFlightRef.current = false;
    }
  }, [open]);

  // ESC to close. We only attach the listener when open so this
  // component doesn't fight other modals for the key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const waHref = `https://wa.me/${WHATSAPP_NUMBER}?text=login`;

  const onVerify = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (inFlightRef.current) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code we sent on WhatsApp.");
      return;
    }
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    const result = await linkPhoneByCode(code);
    if (result.ok) {
      onLinked(result.user);
      // onClose follows from onLinked in the parent (it sets open=false).
      return;
    }
    inFlightRef.current = false;
    setBusy(false);
    setError(humanise(result.error));
  };

  return (
    <div
      className="vt-phone-link-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vt-phone-link-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="vt-phone-link-card">
        <button
          type="button"
          className="vt-phone-link-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="vt-phone-link-title" className="vt-phone-link-title">
          Add your phone number
        </h2>
        <p className="vt-phone-link-sub">
          Verify by sending us a WhatsApp message, no typing required.
        </p>

        <ol className="vt-phone-link-steps">
          <li data-active={step === "start" ? "true" : "false"}>
            <span className="vt-phone-link-step-num">1</span>
            Message <strong>login</strong> to our WhatsApp
          </li>
          <li data-active={step === "code" ? "true" : "false"}>
            <span className="vt-phone-link-step-num">2</span>
            Paste the 6-digit code we reply with
          </li>
        </ol>

        {step === "start" ? (
          <div className="vt-phone-link-step-body">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="vt-signin-btn vt-signin-btn-whatsapp vt-phone-link-wa-btn"
              onClick={() => {
                // Advance the step so the user lands on the code-paste
                // form when they switch back to the tab. We don't
                // wait for any server signal; the inbound webhook
                // will populate the OTP table whether the user comes
                // back to this tab or not.
                window.setTimeout(() => setStep("code"), 400);
              }}
            >
              <span className="vt-signin-btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zm-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488" />
                </svg>
              </span>
              Message &lsquo;login&rsquo; to our WhatsApp
            </a>
            <p className="vt-phone-link-already">
              Already sent it?{" "}
              <button
                type="button"
                className="vt-phone-link-link"
                onClick={() => setStep("code")}
              >
                Enter the code
              </button>
            </p>
            <p className="vt-phone-link-pool-note">
              Some Pools restrict access by mobile phone country code, so the
              number you link here may affect which Pools you can join.
            </p>
          </div>
        ) : (
          <form className="vt-phone-link-step-body" onSubmit={onVerify}>
            <label className="vt-phone-link-label" htmlFor="vt-phone-link-code">
              6-digit code
            </label>
            <input
              id="vt-phone-link-code"
              className="auth-input vt-phone-link-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
              autoFocus
            />
            {error ? (
              <p className="vt-phone-link-error" role="alert">{error}</p>
            ) : null}
            <button
              type="submit"
              className="vt-signin-btn vt-phone-link-verify-btn"
              disabled={busy || code.length !== 6}
            >
              {busy ? "Linking…" : "Link phone"}
            </button>
            <p className="vt-phone-link-back">
              <button
                type="button"
                className="vt-phone-link-link"
                onClick={() => setStep("start")}
                disabled={busy}
              >
                ← Back to step 1
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function humanise(err: string): string {
  switch (err) {
    case "bad-body":
      return "Enter the 6-digit code we sent on WhatsApp.";
    case "unauthorized":
      return "Your session expired. Sign in again, then try once more.";
    case "unknown-or-expired":
      return "That code does not match. Send a fresh login message and try again.";
    case "phone-taken":
      return "That phone is already linked to another account. Sign in with it from the home page, or use a different number.";
    case "ip-throttled":
      return "Too many wrong codes from this connection. Wait an hour and try again.";
    case "network":
      return "Network error. Check your connection and try again.";
    default:
      return "Could not link the phone. Try again, or contact support if it keeps failing.";
  }
}
