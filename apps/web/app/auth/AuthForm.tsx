"use client";

/**
 * Two-step OTP form.
 *
 * Step "phone":
 *   - Country code + local digits.
 *   - Channel toggle: SMS (default) or WhatsApp.
 *   - POSTs /v1/auth/request, transitions to "code" on 200.
 *
 * Step "code":
 *   - 6-digit input with `autoComplete="one-time-code"` so iOS / Chrome
 *     can autofill from the SMS we just sent.
 *   - Tries the WebOTP API (`navigator.credentials.get({otp:...})`) so
 *     supported browsers paste the code automatically.
 *   - POSTs /v1/auth/verify; on success stores the JWT in localStorage
 *     and redirects to the `?next=` param or `/world-cup-2026`.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Step = "phone" | "code" | "done";
type Channel = "sms" | "whatsapp";

const AUTH_API_BASE =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:3330";

const STORAGE_KEY = "vtourn_jwt";

function readableError(reason?: string): string {
  switch (reason) {
    case "phone-cooldown":
      return "Too many requests. Wait a minute and try again.";
    case "phone-hourly":
      return "Hourly limit reached for this number. Try again later.";
    case "ip-hourly":
      return "Too many requests from your network. Try again later.";
    case "bad-phone":
      return "That phone number doesn't look right. Use international format like +6421999000.";
    case "bad-channel":
      return "Pick SMS or WhatsApp.";
    case "send-failed":
      return "Couldn't send the code. Try the other channel?";
    case "invalid-or-expired":
      return "Code didn't match — or it expired. Request a new one.";
    case "too-many-attempts":
      return "Too many wrong tries. Request a new code.";
    default:
      return "Something went wrong. Try again.";
  }
}

export default function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/world-cup-2026";

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState<string>("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [code, setCode] = useState<string>("");
  const [phoneMasked, setPhoneMasked] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement | null>(null);

  // WebOTP API: when on step "code", listen for an SMS-delivered code.
  // Must run client-side; not all browsers support it.
  useEffect(() => {
    if (step !== "code" || channel !== "sms") return;
    if (typeof window === "undefined") return;
    if (!("OTPCredential" in window)) return;
    const ac = new AbortController();
    // The cast is required because the OTPCredential type isn't in
    // lib.dom yet across all TS versions.
    (
      navigator.credentials as unknown as {
        get: (init: {
          otp: { transport: string[] };
          signal: AbortSignal;
        }) => Promise<{ code?: string } | null>;
      }
    )
      .get({ otp: { transport: ["sms"] }, signal: ac.signal })
      .then((cred) => {
        if (cred?.code && /^\d{6}$/.test(cred.code)) {
          setCode(cred.code);
          // auto-submit
          setTimeout(() => {
            void submitCode(cred.code);
          }, 50);
        }
      })
      .catch(() => {
        /* user dismissed or unsupported */
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, channel]);

  async function submitPhone(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${AUTH_API_BASE}/v1/auth/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, channel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readableError(body?.reason ?? body?.error));
        setBusy(false);
        return;
      }
      setPhoneMasked(body.phoneMasked ?? phone);
      setStep("code");
      setBusy(false);
      // Focus the code input on next tick.
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
      setBusy(false);
    }
  }

  async function submitCode(rawCode?: string): Promise<void> {
    const c = (rawCode ?? code).trim();
    setError(null);
    if (!/^\d{6}$/.test(c)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${AUTH_API_BASE}/v1/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code: c }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(readableError(body?.error));
        setBusy(false);
        return;
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, body.jwt);
      } catch {
        /* storage disabled — proceed anyway */
      }
      setStep("done");
      router.push(next);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
      setBusy(false);
    }
  }

  if (step === "phone") {
    return (
      <form className="auth-form" onSubmit={submitPhone}>
        <label className="auth-label" htmlFor="phone">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+64 21 999 000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="auth-input"
          required
          disabled={busy}
        />
        <fieldset className="auth-channel">
          <legend className="auth-label">Send code via</legend>
          <label className={channel === "sms" ? "auth-chip auth-chip-on" : "auth-chip"}>
            <input
              type="radio"
              name="channel"
              value="sms"
              checked={channel === "sms"}
              onChange={() => setChannel("sms")}
              disabled={busy}
            />
            SMS
          </label>
          <label
            className={channel === "whatsapp" ? "auth-chip auth-chip-on" : "auth-chip"}
          >
            <input
              type="radio"
              name="channel"
              value="whatsapp"
              checked={channel === "whatsapp"}
              onChange={() => setChannel("whatsapp")}
              disabled={busy}
            />
            WhatsApp
          </label>
        </fieldset>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submitCode();
        }}
      >
        <p className="auth-info">
          Code sent to <strong>{phoneMasked}</strong>.
        </p>
        <label className="auth-label" htmlFor="code">
          6-digit code
        </label>
        <input
          id="code"
          ref={codeRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          className="auth-input auth-input-code"
          required
          disabled={busy}
        />
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Verifying…" : "Verify"}
        </button>
        <button
          className="auth-link"
          type="button"
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

  return <p className="auth-info">Signing you in…</p>;
}
