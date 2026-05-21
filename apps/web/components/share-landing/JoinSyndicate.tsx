"use client";

/**
 * "Join this pool" CTA + signup modal for the `/s/<slug>` syndicate
 * landing.
 *
 * Three-step flow (Tim 2026-05-22):
 *
 *   1) Identity   — display name + handle + phone. On submit:
 *                   a) GET /handle-check?handle=… — block if taken.
 *                   b) POST {AUTH}/v1/auth/request {phone, channel,
 *                      pool_slug} — sends a WhatsApp OTP + magic link.
 *
 *   2) Verify     — 6-digit code input + an ALWAYS-visible email
 *                   fallback ("Don't use WhatsApp? Get the code by
 *                   email instead.") so non-WhatsApp users don't have
 *                   to wait or guess.
 *
 *   3) Bind+Join  — on successful verify, PATCH /me with display_name,
 *                   POST /api/v1/syndicates/<slug>/join with handle +
 *                   display_name, then redirect to /s/<slug>.
 *
 * Cross-device path: the magic link in the WhatsApp message lands on
 * `play.tournamental.com/?v=<token>&pool=<slug>` so a phone tap also
 * resolves to /s/<slug> after auth-sms mints the session.
 *
 * State persistence: the user's chosen {handle, displayName, slug} is
 * mirrored to localStorage on submit so a same-device reload during
 * Step 2 keeps the join going.
 */

import { useCallback, useEffect, useState } from "react";

import {
  AUTH_BASE,
  requestEmailOtp,
  verifyEmailOtp,
  verifyInboundCode,
  whatsAppLoginDeepLink,
} from "@/lib/auth/inbound-login";

export interface JoinSyndicateProps {
  readonly slug: string;
  readonly syndicateName: string;
}

interface PendingJoin {
  readonly slug: string;
  readonly handle: string;
  readonly displayName: string;
}

const LS_PENDING_JOIN = "tnm.pending_join.v1";

function savePending(p: PendingJoin): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_PENDING_JOIN, JSON.stringify(p));
  } catch {
    /* private-mode safari etc. */
  }
}
function loadPending(): PendingJoin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_PENDING_JOIN);
    if (!raw) return null;
    const j = JSON.parse(raw) as PendingJoin;
    if (j && typeof j.slug === "string" && typeof j.handle === "string") return j;
    return null;
  } catch {
    return null;
  }
}
function clearPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_PENDING_JOIN);
  } catch {
    /* ignore */
  }
}

/** Normalise a free-text phone input to a best-effort E.164. Falls back
 * to the digits-only string if no country code was supplied. The
 * server runs the same normalisation, so a slightly off value here
 * still verifies; we only need it tight enough for the auth-sms call
 * to accept it. */
function normalisePhone(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  // Already E.164.
  if (/^\+\d{8,15}$/.test(t)) return t;
  // 00 international prefix → +.
  if (/^00\d{8,15}$/.test(t)) return `+${t.slice(2)}`;
  // Leading 0 with NZ default (best guess for the alpha launch).
  if (/^0\d{8,10}$/.test(t)) return `+64${t.slice(1)}`;
  // Bare digits, prepend +.
  if (/^\d{8,15}$/.test(t)) return `+${t}`;
  return t;
}

function deriveHandleFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

type Step = "identity" | "verify" | "success";

export function JoinSyndicate({ slug, syndicateName }: JoinSyndicateProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("identity");

  // Identity step
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [phone, setPhone] = useState("");

  // Verify step
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [usingEmail, setUsingEmail] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);

  // Shared
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Auto-derive a handle from the display name until the user edits
  // the handle field directly.
  useEffect(() => {
    if (!handleTouched) {
      setHandle(deriveHandleFromName(displayName));
    }
  }, [displayName, handleTouched]);

  // Reset state when the modal closes.
  const close = useCallback(() => {
    setOpen(false);
    setStep("identity");
    setError(null);
    setInfo(null);
    setCode("");
    setUsingEmail(false);
    setEmail("");
    setBusy(false);
  }, []);

  const openModal = useCallback(() => {
    setOpen(true);
    setError(null);
    setInfo(null);
  }, []);

  const handleIsValid = /^[a-zA-Z0-9_]{2,32}$/.test(handle);
  const nameIsValid = displayName.trim().length >= 1;
  const phoneIsValid = /^\+\d{8,15}$/.test(normalisePhone(phone));
  const canSubmitIdentity =
    !busy && handleIsValid && nameIsValid && phoneIsValid;

  const onSubmitIdentity = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmitIdentity) return;
      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        // 1) Handle availability check (cheap, no OTP consumed).
        const checkRes = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/handle-check?handle=${encodeURIComponent(handle)}`,
          { method: "GET", headers: { Accept: "application/json" } },
        );
        const checkJson = (await checkRes.json().catch(() => ({}))) as {
          available?: boolean;
          error?: string;
          message?: string;
        };
        if (!checkRes.ok || checkJson.error || checkJson.available !== true) {
          setError(
            checkJson.error === "bad_handle"
              ? "That handle isn't valid. Letters, numbers, and underscores, 2–32 chars."
              : `Sorry, "${handle}" is already taken. Pick a different handle.`,
          );
          setBusy(false);
          return;
        }

        // 2) Phone registration check. If the number already has an
        //    account we MUST NOT silently sign them in (that would let
        //    anyone log in as anyone by typing a phone). Point them at
        //    the WhatsApp login path instead, which still requires the
        //    one-time code they get back.
        const normalised = normalisePhone(phone);
        const regRes = await fetch(
          `${AUTH_BASE.replace(/\/$/, "")}/v1/auth/phone-registered?phone=${encodeURIComponent(normalised)}`,
          { method: "GET", headers: { Accept: "application/json" } },
        );
        const regJson = (await regRes.json().catch(() => ({}))) as {
          registered?: boolean;
          error?: string;
        };
        if (regRes.ok && regJson.registered === true) {
          setError("PHONE_ALREADY_REGISTERED");
          setBusy(false);
          return;
        }

        // 3) Request the WhatsApp OTP (auth-sms returns the masked
        //    phone + builds the magic-link URL with ?v=&pool=<slug>).
        const reqRes = await fetch(
          `${AUTH_BASE.replace(/\/$/, "")}/v1/auth/request`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              phone: normalised,
              channel: "whatsapp",
              pool_slug: slug,
            }),
          },
        );
        const reqJson = (await reqRes.json().catch(() => ({}))) as {
          ok?: boolean;
          phoneMasked?: string;
          error?: string;
          reason?: string;
          retryAfterSeconds?: number;
        };
        if (!reqRes.ok || reqJson.error) {
          // Send failed (Baileys not paired, gateway down, etc.). We
          // still saved the pending-join, so falling back to the
          // user-initiated WhatsApp deep-link keeps the flow working:
          // when they DM "login", aiva-sms triggers inbound-login,
          // they sign in, MagicLinkConsumer picks the pending-join
          // out of localStorage and adds them to the pool.
          if (reqJson.error === "send-failed") {
            savePending({
              slug,
              handle: handle.trim(),
              displayName: displayName.trim(),
            });
            setPhoneMasked(normalised);
            setStep("verify");
            setBusy(false);
            setInfo(
              "We couldn't send a code automatically. Tap the WhatsApp button below to message us instead — you'll get the code + magic link back.",
            );
            return;
          }
          setError(
            reqJson.error === "rate-limited"
              ? `Too many recent requests. Try again in ${reqJson.retryAfterSeconds ?? 60}s.`
              : reqJson.error === "bad-phone"
                ? "That phone number doesn't look right. Include the country code."
                : "Couldn't request a code. Try again in a moment.",
          );
          setBusy(false);
          return;
        }

        // Persist so a same-device reload between request + verify
        // keeps the join going.
        savePending({
          slug,
          handle: handle.trim(),
          displayName: displayName.trim(),
        });
        setPhoneMasked(reqJson.phoneMasked ?? normalised);
        setStep("verify");
        setBusy(false);
      } catch (err) {
        setError(
          err instanceof Error
            ? `Network error: ${err.message}`
            : "Network error. Try again.",
        );
        setBusy(false);
      }
    },
    [canSubmitIdentity, slug, handle, phone, displayName],
  );

  /** Once auth-sms returns a valid session, bind the handle + display
   * name on the user record AND POST /join. Used by both the
   * code-verify path and the email-verify path. */
  const bindAndJoin = useCallback(async (): Promise<boolean> => {
    // Bind display name on the auth-sms user (PATCH /v1/auth/me).
    try {
      await fetch(`${AUTH_BASE.replace(/\/$/, "")}/v1/auth/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
    } catch {
      /* non-fatal; user can edit later */
    }
    // Add to the pool (handle + display_name).
    try {
      const r = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/join`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: handle.trim(),
            display_name: displayName.trim(),
          }),
        },
      );
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!r.ok && j.error && j.error !== "already_member") {
        setError(j.message ?? `Couldn't join the pool (${j.error}).`);
        return false;
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error joining pool: ${err.message}`
          : "Network error joining pool.",
      );
      return false;
    }
    return true;
  }, [slug, handle, displayName]);

  const onSubmitCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      if (!/^\d{6}$/.test(code)) {
        setError("Enter the 6-digit code from your message.");
        return;
      }
      setBusy(true);
      setError(null);
      setInfo(null);
      const res = await verifyInboundCode(code);
      if (!res.ok) {
        setError(
          res.error === "unknown-or-expired"
            ? "That code didn't match. It may have already been used or expired — request a new one."
            : res.error === "ip-throttled"
              ? "Too many tries from this network. Wait a minute and try again."
              : "Sign-in failed. Try again.",
        );
        setBusy(false);
        return;
      }
      const ok = await bindAndJoin();
      if (!ok) {
        setBusy(false);
        return;
      }
      clearPending();
      setStep("success");
      // Redirect to the pool's share landing in 1.2s so the user sees
      // the confirmation tick first.
      window.setTimeout(() => {
        window.location.replace(`/s/${encodeURIComponent(slug)}`);
      }, 1200);
    },
    [busy, code, bindAndJoin, slug],
  );

  const onRequestEmailCode = useCallback(async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const r = await requestEmailOtp(email);
    if (!r.ok) {
      setError(
        r.error === "cooldown"
          ? "Just sent a code — wait a moment, then check your inbox."
          : "Couldn't send an email code. Check the address and try again.",
      );
      setBusy(false);
      return;
    }
    setInfo(`Code sent to ${email}. Check your inbox (and spam).`);
    setUsingEmail(true);
    setBusy(false);
  }, [busy, email]);

  const onSubmitEmailCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      if (!/^\d{6}$/.test(code)) {
        setError("Enter the 6-digit code from your email.");
        return;
      }
      setBusy(true);
      setError(null);
      const res = await verifyEmailOtp(email, code);
      if (!res.ok) {
        setError(
          res.error === "unknown-or-expired"
            ? "That code didn't match. It may have already been used or expired — request a new one."
            : "Sign-in failed. Try again.",
        );
        setBusy(false);
        return;
      }
      const ok = await bindAndJoin();
      if (!ok) {
        setBusy(false);
        return;
      }
      clearPending();
      setStep("success");
      window.setTimeout(() => {
        window.location.replace(`/s/${encodeURIComponent(slug)}`);
      }, 1200);
    },
    [busy, code, email, bindAndJoin, slug],
  );

  // On first open: if a pending-join already exists for this slug
  // (user reloaded between steps), restore the form values.
  useEffect(() => {
    if (!open) return;
    const p = loadPending();
    if (p && p.slug === slug) {
      setDisplayName(p.displayName);
      setHandle(p.handle);
      setHandleTouched(true);
    }
  }, [open, slug]);

  return (
    <>
      <button
        className="vt-share-cta"
        data-variant="primary"
        type="button"
        onClick={openModal}
      >
        Join this pool
      </button>
      {open ? (
        <div
          className="vt-share-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vt-join-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) close();
          }}
        >
          <div className="vt-share-modal">
            {step === "identity" && (
              <form
                onSubmit={onSubmitIdentity}
                className="vt-join-form"
              >
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  Join {syndicateName}
                </h2>
                <p className="vt-share-modal-body">
                  Pick a display name and handle for the leaderboard, then
                  we&apos;ll send a one-time login code to your WhatsApp.
                </p>
                <label className="vt-join-label">
                  <span>Your name</span>
                  <input
                    type="text"
                    className="vt-share-modal-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Tim Thomas"
                    autoFocus
                    maxLength={60}
                    required
                  />
                </label>
                <label className="vt-join-label">
                  <span>Handle (shown on the leaderboard)</span>
                  <input
                    type="text"
                    className="vt-share-modal-input"
                    value={handle}
                    onChange={(e) => {
                      setHandle(e.target.value);
                      setHandleTouched(true);
                    }}
                    placeholder="tim_thomas"
                    maxLength={32}
                    pattern="[a-zA-Z0-9_]{2,32}"
                    required
                  />
                </label>
                <label className="vt-join-label">
                  <span>Mobile number (for WhatsApp login)</span>
                  <input
                    type="tel"
                    className="vt-share-modal-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+64 21 535 832"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                  />
                </label>
                {error === "PHONE_ALREADY_REGISTERED" ? (
                  <div className="vt-join-error vt-join-error--registered">
                    <p>
                      <strong>That phone is already registered.</strong> If
                      it&apos;s yours, log in via WhatsApp instead — you&apos;ll get
                      the one-time code and a tap-to-sign-in link, then we
                      add you to {syndicateName} automatically.
                    </p>
                    <a
                      className="vt-share-cta"
                      data-variant="primary"
                      href={whatsAppLoginDeepLink(slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Log in via WhatsApp →
                    </a>
                  </div>
                ) : error ? (
                  <p className="vt-join-error">{error}</p>
                ) : null}
                <div className="vt-share-modal-row">
                  <button
                    type="button"
                    className="vt-share-cta"
                    data-variant="secondary"
                    onClick={close}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="vt-share-cta"
                    data-variant="primary"
                    disabled={!canSubmitIdentity}
                  >
                    {busy ? "Sending…" : "Send login code"}
                  </button>
                </div>
                <p className="vt-join-footnote">
                  By joining you agree to our terms. We only use your phone
                  number for sign-in — no marketing, no third parties.
                </p>
              </form>
            )}

            {step === "verify" && (
              <div className="vt-join-form">
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  Enter your code
                </h2>
                <p className="vt-share-modal-body">
                  We&apos;ve just sent a 6-digit code via WhatsApp to{" "}
                  <strong>{phoneMasked}</strong>. Tap the link in the message
                  to sign in instantly, or paste the code here.
                </p>

                {/* WhatsApp self-trigger fallback (also surfaces when the
                  * outbound send failed at submit-time — info message
                  * above directs the user here). */}
                <a
                  className="vt-share-cta vt-join-wa-btn"
                  data-variant="secondary"
                  href={whatsAppLoginDeepLink(slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span aria-hidden="true">💬</span> Open WhatsApp &amp; message us
                </a>

                {/* Primary path: WhatsApp 6-digit code paste. */}
                <form onSubmit={onSubmitCode} className="vt-join-code-form">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    className="vt-share-modal-input vt-join-code-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    autoFocus
                    required
                  />
                  <button
                    type="submit"
                    className="vt-share-cta"
                    data-variant="primary"
                    disabled={busy || code.length !== 6}
                  >
                    {busy ? "Verifying…" : usingEmail ? "Verify email code" : "Sign in with code"}
                  </button>
                </form>

                {/* Always-visible email fallback (Tim 2026-05-22: no fade
                  * delay — show it from the start so non-WhatsApp users
                  * can switch immediately). */}
                <div className="vt-join-fallback">
                  <p className="vt-join-fallback-lede">
                    Don&apos;t use WhatsApp? <strong>Get the code by email instead.</strong>
                  </p>
                  <div className="vt-join-fallback-row">
                    <input
                      type="email"
                      className="vt-share-modal-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      inputMode="email"
                    />
                    <button
                      type="button"
                      className="vt-share-cta"
                      data-variant="secondary"
                      onClick={onRequestEmailCode}
                      disabled={busy || !email.includes("@")}
                    >
                      Send email code
                    </button>
                  </div>
                  {usingEmail && (
                    <p className="vt-join-info">
                      Email code sent. Use the input above to enter it, then
                      tap <button
                        type="button"
                        className="vt-join-inline-link"
                        onClick={(e) => {
                          e.preventDefault();
                          void onSubmitEmailCode(e as unknown as React.FormEvent);
                        }}
                      >Verify email code</button>.
                    </p>
                  )}
                </div>

                {info && <p className="vt-join-info">{info}</p>}
                {error && <p className="vt-join-error">{error}</p>}
                <div className="vt-share-modal-row">
                  <button
                    type="button"
                    className="vt-share-cta"
                    data-variant="secondary"
                    onClick={close}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vt-share-cta vt-join-back"
                    onClick={() => {
                      setStep("identity");
                      setError(null);
                      setInfo(null);
                      setCode("");
                    }}
                    disabled={busy}
                  >
                    ← Edit details
                  </button>
                </div>
              </div>
            )}

            {step === "success" && (
              <div className="vt-join-success">
                <h2 className="vt-share-modal-title">✅ You&apos;re in!</h2>
                <p className="vt-share-modal-body">
                  Welcome to {syndicateName}. Loading your bracket…
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
