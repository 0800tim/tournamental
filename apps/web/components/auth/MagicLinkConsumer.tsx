"use client";

/**
 * Magic-link consumer for play.tournamental.com.
 *
 * Mirrors the script in apps/marketing/src/layouts/Layout.astro: any
 * page that loads with `?v=<token>` in the URL POSTs to the auth-sms
 * service, lets the server set a `tnm_session` cookie on
 * `.tournamental.com`, then strips ?v= and reloads so the user lands
 * on the page they actually wanted with a fresh authenticated state.
 *
 * Mounted at the root layout so any deep link works (e.g. someone
 * shares /world-cup-2026?v=... or /match/abc?v=... from a WhatsApp
 * reply).
 *
 * We show a small fixed-position banner during the in-flight call so
 * the user sees "Signing you in…" rather than a silent loading state.
 */

import { useEffect, useState } from "react";

import { verifyMagicToken } from "@/lib/auth/inbound-login";

type Phase =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "success"; phone: string | null }
  | { state: "error"; message: string };

const MAGIC_TOKEN_PARAM = "v";

export function MagicLinkConsumer() {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get(MAGIC_TOKEN_PARAM);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return;

    setPhase({ state: "busy" });

    void verifyMagicToken(token).then((res) => {
      // Strip ?v= so a refresh doesn't retry a now-burned token.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete(MAGIC_TOKEN_PARAM);
        const clean = url.pathname + (url.search ? `?${url.searchParams.toString()}` : "") + url.hash;
        window.history.replaceState(null, "", clean || "/");
      } catch {
        /* ignore */
      }

      if (res.ok) {
        // Show success briefly so the user sees a clear confirmation,
        // then reload so the auth context picks up the new session
        // cookie. Replace (not push) so the back button doesn't go
        // back to the now-burned ?v= URL.
        setPhase({ state: "success", phone: res.user.phone });
        window.setTimeout(() => {
          window.location.replace(
            window.location.pathname + window.location.search + window.location.hash,
          );
        }, 1200);
        return;
      }

      const message =
        res.error === "fingerprint-mismatch"
          ? "This sign-in link was opened on a different device. Use the device you messaged us from, or paste the 6-digit code."
          : res.error === "unknown-or-expired"
          ? "This sign-in link has expired or already been used. Message 'login' on WhatsApp again to get a fresh one."
          : res.error === "ip-throttled"
          ? "Too many sign-in attempts from this network. Try again in a few minutes."
          : res.error === "network"
          ? "Could not reach the sign-in service. Check your connection and try again."
          : "Sign-in failed. Try again, or paste the 6-digit code.";
      setPhase({ state: "error", message });
    });
  }, []);

  if (phase.state === "idle") return null;

  const tone =
    phase.state === "error"
      ? { bg: "#3a0e0e", border: "#cf3c3c" }
      : phase.state === "success"
      ? { bg: "#0e3a26", border: "#34d399" }
      : { bg: "#0e2548", border: "#3c8bcf" };

  const message =
    phase.state === "busy"
      ? "Signing you in…"
      : phase.state === "success"
      ? phase.phone
        ? `✅ Signed in as ${phase.phone}. Welcome back.`
        : "✅ Signed in. Welcome back."
      : phase.message;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "12px 18px",
        borderRadius: 10,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 14,
        background: tone.bg,
        color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,.4)",
        border: `1px solid ${tone.border}`,
        maxWidth: "92vw",
      }}
    >
      {message}
    </div>
  );
}
