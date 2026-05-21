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

import { AUTH_BASE, verifyMagicToken } from "@/lib/auth/inbound-login";

type Phase =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "success"; phone: string | null }
  | { state: "error"; message: string };

const MAGIC_TOKEN_PARAM = "v";
const POOL_PARAM = "pool";

/** Slug shape — must match the syndicate slug regex used server-side. */
const POOL_SLUG_RE = /^[a-z0-9-]{1,64}$/i;

const LS_PENDING_JOIN = "tnm.pending_join.v1";

interface PendingJoin {
  readonly slug: string;
  readonly handle: string;
  readonly displayName: string;
}

function loadPendingJoin(): PendingJoin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_PENDING_JOIN);
    if (!raw) return null;
    const j = JSON.parse(raw) as PendingJoin;
    if (j && typeof j.slug === "string") return j;
    return null;
  } catch {
    return null;
  }
}

function clearPendingJoin(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_PENDING_JOIN);
  } catch {
    /* ignore */
  }
}

/** After auth-sms mints a session, bind the handle/display_name from a
 * pending-join localStorage record and POST the pool join. Same-device
 * code-paste already does this inside JoinSyndicate; this path handles
 * the magic-link cross-device case. */
async function applyPendingJoinIfPresent(poolFromUrl: string | null): Promise<string | null> {
  const pending = loadPendingJoin();
  // Prefer the slug from the URL ?pool= param when it's present —
  // that's the source of truth from auth-sms's magicLinkUrl builder.
  const slug = poolFromUrl ?? pending?.slug ?? null;
  if (!slug) return null;
  if (pending && pending.displayName) {
    try {
      await fetch(`${AUTH_BASE.replace(/\/$/, "")}/v1/auth/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: pending.displayName }),
      });
    } catch {
      /* non-fatal */
    }
  }
  try {
    await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/join`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: pending?.handle,
        display_name: pending?.displayName,
      }),
    });
  } catch {
    /* non-fatal — user lands on /s/<slug> either way */
  }
  clearPendingJoin();
  return slug;
}

export function MagicLinkConsumer() {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get(MAGIC_TOKEN_PARAM);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return;

    // The link may carry `?pool=<slug>` (set by auth-sms's request-otp
    // when the join modal kicked off the OTP). After successful
    // verify we land the user on /s/<slug> so the magic-link path
    // mirrors the same-device code-paste flow (Tim 2026-05-22).
    const poolRaw = params.get(POOL_PARAM);
    const pool =
      poolRaw && POOL_SLUG_RE.test(poolRaw) ? poolRaw.toLowerCase() : null;

    setPhase({ state: "busy" });

    void verifyMagicToken(token).then(async (res) => {
      // Strip ?v= (and ?pool=) so a refresh doesn't retry a burned
      // token. We hold the pool value in the closure for the redirect.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete(MAGIC_TOKEN_PARAM);
        url.searchParams.delete(POOL_PARAM);
        const clean = url.pathname + (url.search ? `?${url.searchParams.toString()}` : "") + url.hash;
        window.history.replaceState(null, "", clean || "/");
      } catch {
        /* ignore */
      }

      if (res.ok) {
        // If a pending-join is queued in localStorage OR the link
        // carries ?pool=, bind handle/display_name + add the user to
        // the pool, then bounce to /s/<slug>.
        const slug = await applyPendingJoinIfPresent(pool);
        // Show success briefly so the user sees a clear confirmation,
        // then redirect. Replace (not push) so the back button doesn't
        // go back to the now-burned ?v= URL.
        setPhase({ state: "success", phone: res.user.phone });
        window.setTimeout(() => {
          if (slug) {
            window.location.replace(`/s/${encodeURIComponent(slug)}`);
          } else {
            window.location.replace(
              window.location.pathname + window.location.search + window.location.hash,
            );
          }
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
