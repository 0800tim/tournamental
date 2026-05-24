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

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

import {
  AUTH_BASE,
  requestEmailOtp,
  verifyEmailOtp,
  verifyInboundCode,
  whatsAppLoginDeepLink,
} from "@/lib/auth/inbound-login";
import { useUser } from "@/lib/auth/useUser";

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
  const t = useTranslations();
  // Authenticated users skip the whole identity + OTP + verify flow:
  // their session already has the handle / phone / display name, so
  // we POST /join with credentials and jump straight to the success
  // (or "Request sent" for private pools) view. The modal stays
  // available for the unauthenticated path which still needs the
  // identity capture (Tim 2026-05-22).
  const auth = useUser();
  const isAuthed = auth.status === "authenticated";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("identity");

  // Identity step
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [phone, setPhone] = useState("");
  // Email is the WhatsApp-free fallback: either phone or email is
  // required, both is fine, and when both are provided we send the
  // one-time code to BOTH channels so the user can verify with
  // whichever lands first (Tim 2026-05-22).
  const [identityEmail, setIdentityEmail] = useState("");

  // Join outcome captured at the end of the verify step so the
  // success view can render different copy for active vs pending
  // (approval-gated) joins.
  const [joinStatus, setJoinStatus] = useState<"active" | "pending">("active");

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

  /**
   * Authed fast-path. Skip the identity + OTP modal entirely; POST
   * directly to /join with the session cookie + bearer fallback. The
   * server already knows our user_id, display_name and phone -- the
   * /join endpoint falls back to session.displayName when the body
   * doesn't supply a handle, so an empty body is enough for an
   * authed user.
   *
   * Open the modal jumped straight to the "success" step so the
   * existing success / pending UI handles both outcomes without a
   * separate render path.
   */
  const joinAsAuthedUser = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/join`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: "{}",
        },
      );
      const body = (await r.json().catch(() => ({}))) as {
        status?: "active" | "pending";
        already_member?: boolean;
        error?: string;
        message?: string;
      };
      if (!r.ok) {
        setError(body.message ?? body.error ?? `Server returned ${r.status}`);
        setOpen(true);
        setStep("identity"); // surface the error in the modal's identity step
        return;
      }
      setJoinStatus(body.status === "pending" ? "pending" : "active");
      setOpen(true);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setOpen(true);
      setStep("identity");
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const handleCtaClick = useCallback(() => {
    if (isAuthed) void joinAsAuthedUser();
    else openModal();
  }, [isAuthed, joinAsAuthedUser, openModal]);

  const handleIsValid = /^[a-zA-Z0-9_]{2,32}$/.test(handle);
  const nameIsValid = displayName.trim().length >= 1;
  const phoneIsValid = /^\+\d{8,15}$/.test(normalisePhone(phone));
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityEmail.trim());
  // At least one contact channel must validate; both is fine.
  const hasContact = (phone.trim() && phoneIsValid) || (identityEmail.trim() && emailIsValid);
  const canSubmitIdentity = !busy && handleIsValid && nameIsValid && hasContact;

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

        const wantPhone = !!(phone.trim() && phoneIsValid);
        const wantEmail = !!(identityEmail.trim() && emailIsValid);
        const normalised = wantPhone ? normalisePhone(phone) : null;
        const emailTrim = wantEmail ? identityEmail.trim().toLowerCase() : null;

        // 2) Phone registration check (only when the user supplied a
        //    phone). Known phones can't be auto-logged-in via this
        //    flow — that'd let anyone log in as anyone — so we point
        //    them at the WhatsApp inbound-login path instead.
        if (wantPhone && normalised) {
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
        }

        // 3) Fire the OTP request(s). When BOTH channels are supplied
        //    we send to both in parallel so the user gets a code on
        //    whichever they check first. Either request can fail
        //    independently; we only show an error if BOTH fail.
        const reqs: Array<Promise<{
          channel: "whatsapp" | "email";
          ok: boolean;
          phoneMasked?: string;
          error?: string;
          retryAfterSeconds?: number;
        }>> = [];

        if (wantPhone && normalised) {
          reqs.push(
            fetch(`${AUTH_BASE.replace(/\/$/, "")}/v1/auth/request`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({
                phone: normalised,
                channel: "whatsapp",
                pool_slug: slug,
              }),
            })
              .then(async (r) => {
                const j = (await r.json().catch(() => ({}))) as {
                  ok?: boolean;
                  phoneMasked?: string;
                  error?: string;
                  retryAfterSeconds?: number;
                };
                return {
                  channel: "whatsapp" as const,
                  ok: r.ok && !j.error,
                  phoneMasked: j.phoneMasked,
                  error: j.error,
                  retryAfterSeconds: j.retryAfterSeconds,
                };
              })
              .catch((e: unknown) => ({
                channel: "whatsapp" as const,
                ok: false,
                error: e instanceof Error ? e.message : "network",
              })),
          );
        }

        if (wantEmail && emailTrim) {
          reqs.push(
            fetch(`${AUTH_BASE.replace(/\/$/, "")}/v1/auth/email/request`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ email: emailTrim, pool_slug: slug }),
            })
              .then(async (r) => {
                const j = (await r.json().catch(() => ({}))) as {
                  ok?: boolean;
                  error?: string;
                  retryAfterSeconds?: number;
                };
                return {
                  channel: "email" as const,
                  ok: r.ok && !j.error,
                  error: j.error,
                  retryAfterSeconds: j.retryAfterSeconds,
                };
              })
              .catch((e: unknown) => ({
                channel: "email" as const,
                ok: false,
                error: e instanceof Error ? e.message : "network",
              })),
          );
        }

        const results = await Promise.all(reqs);
        const phoneRes = results.find((r) => r.channel === "whatsapp");
        const emailRes = results.find((r) => r.channel === "email");
        const anyOk = results.some((r) => r.ok);

        if (!anyOk) {
          // BOTH (or the only) channel failed. If WhatsApp specifically
          // returned 'send-failed' we still let the user fall through
          // to the verify step with a hint to message us — the
          // localStorage pending-join keeps the join intent alive.
          const sendFailed = phoneRes?.error === "send-failed";
          if (sendFailed && normalised) {
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
          const first = results[0];
          setError(
            first?.error === "rate-limited"
              ? `Too many recent requests. Try again in ${first.retryAfterSeconds ?? 60}s.`
              : first?.error === "bad-phone"
                ? "That phone number doesn't look right. Include the country code."
                : first?.error === "not-configured"
                  ? "Email sign-in isn't configured yet. Use WhatsApp instead."
                  : "Couldn't send a code. Try again in a moment.",
          );
          setBusy(false);
          return;
        }

        // At least one channel sent successfully — persist + advance.
        savePending({
          slug,
          handle: handle.trim(),
          displayName: displayName.trim(),
        });
        if (phoneRes?.ok && normalised) {
          setPhoneMasked(phoneRes.phoneMasked ?? normalised);
        }
        if (emailRes?.ok && emailTrim) {
          // Prime the verify step so the email-fallback panel opens
          // pre-filled with the address the user typed.
          setEmail(emailTrim);
          if (!phoneRes?.ok) setUsingEmail(true);
        }
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
    [
      canSubmitIdentity,
      slug,
      handle,
      phone,
      displayName,
      identityEmail,
      phoneIsValid,
      emailIsValid,
    ],
  );

  /** Once auth-sms returns a valid session, bind the handle + display
   * name on the user record AND POST /join. Used by both the
   * code-verify path and the email-verify path. Returns the join
   * status so the caller can branch (no auto-redirect on pending). */
  const bindAndJoin = useCallback(async (): Promise<
    { ok: false } | { ok: true; status: "active" | "pending" }
  > => {
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
        status?: "active" | "pending";
        error?: string;
        message?: string;
      };
      if (!r.ok && j.error && j.error !== "already_member") {
        setError(j.message ?? `Couldn't join the pool (${j.error}).`);
        return { ok: false };
      }
      const status: "active" | "pending" =
        j.status === "pending" ? "pending" : "active";
      setJoinStatus(status);
      return { ok: true, status };
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error joining pool: ${err.message}`
          : "Network error joining pool.",
      );
      return { ok: false };
    }
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
      const result = await bindAndJoin();
      if (!result.ok) {
        setBusy(false);
        return;
      }
      clearPending();
      setStep("success");
      // Skip the auto-redirect for approval-gated joins — the success
      // view stays put with a "Got it" button so the user reads the
      // "request sent" message and dismisses (Tim 2026-05-22).
      if (result.status === "pending") {
        setBusy(false);
        return;
      }
      window.setTimeout(() => {
        // Redirect to the bracket builder so the user lands on the
        // picks page they actually need to fill out (Tim 2026-05-22:
        // hanging-on-success was caused by redirecting back to the
        // share landing they just came from, which reloads to itself).
        window.location.replace("/world-cup-2026");
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
      const result = await bindAndJoin();
      if (!result.ok) {
        setBusy(false);
        return;
      }
      clearPending();
      setStep("success");
      if (result.status === "pending") {
        setBusy(false);
        return;
      }
      window.setTimeout(() => {
        // Redirect to the bracket builder so the user lands on the
        // picks page they actually need to fill out (Tim 2026-05-22:
        // hanging-on-success was caused by redirecting back to the
        // share landing they just came from, which reloads to itself).
        window.location.replace("/world-cup-2026");
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
        onClick={handleCtaClick}
        disabled={busy && isAuthed}
      >
        {busy && isAuthed
          ? safeT(t, "join.button_joining", "Joining…")
          : safeT(t, "syndicate.cta_join", "Join this pool")}
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
            {/* Gold circular close button. Always available so a user
              * can dismiss the modal without hunting for a "Cancel"
              * (which used to live next to the submit button). Tim
              * 2026-05-22. */}
            <button
              type="button"
              className="vt-share-modal-close"
              onClick={close}
              disabled={busy}
              aria-label="Close"
            >
              <span aria-hidden>×</span>
            </button>
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
                  we&apos;ll send a one-time login code by WhatsApp or email.
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
                  />
                </label>
                <label className="vt-join-label">
                  <span>Email (optional fallback)</span>
                  <input
                    type="email"
                    className="vt-share-modal-input"
                    value={identityEmail}
                    onChange={(e) => setIdentityEmail(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoComplete="email"
                  />
                  <span className="vt-join-help">
                    If you don&apos;t use WhatsApp, enter your email address
                    to get a one-time code. Provide either, or both — we
                    send the code to every channel you give us.
                  </span>
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
                <div className="vt-share-modal-row vt-share-modal-row--single">
                  <button
                    type="submit"
                    className="vt-share-cta"
                    data-variant="primary"
                    disabled={!canSubmitIdentity}
                  >
                    {busy
                      ? safeT(t, "join.modal.cta_sending", "Sending…")
                      : safeT(t, "join.modal.cta_send_code", "Send login code")}
                  </button>
                </div>
                <p className="vt-join-footnote">
                  By joining you agree to our terms. We only use your contact
                  details for sign-in — no marketing, no third parties.
                </p>
              </form>
            )}

            {step === "verify" && (
              <div className="vt-join-form">
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  Enter your code
                </h2>
                <p className="vt-share-modal-body">
                  {phoneMasked ? (
                    <>
                      We&apos;ve just sent a 6-digit code via WhatsApp to{" "}
                      <strong>{phoneMasked}</strong>. Tap the link in the
                      message to sign in instantly, or paste the code here.
                    </>
                  ) : email ? (
                    <>
                      We&apos;ve just sent a 6-digit code by email to{" "}
                      <strong>{email}</strong>. Paste it below to sign in.
                    </>
                  ) : (
                    <>
                      We&apos;ve just sent a 6-digit code. Paste it below to
                      sign in.
                    </>
                  )}
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

                {/* 6-digit code paste. Route to email-verify when the
                  * user requested an email code (the button label flips
                  * too); otherwise hit the inbound-login phone verifier.
                  * Tim 2026-05-22: bug was form-submit always going to
                  * onSubmitCode, so an email-requested code 401'd at
                  * /v1/auth/verify-by-code even though it was valid in
                  * the email-OTP table. */}
                <form
                  onSubmit={usingEmail ? onSubmitEmailCode : onSubmitCode}
                  className="vt-join-code-form"
                >
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

            {step === "success" && joinStatus === "pending" && (
              <div className="vt-join-success">
                <h2 className="vt-share-modal-title">📨 Request sent</h2>
                <p className="vt-share-modal-body">
                  Your request to join <strong>{syndicateName}</strong> has
                  been sent to the pool administrator. You&apos;ll get a
                  notification when they accept it.
                </p>
                <div className="vt-share-modal-row vt-share-modal-row--single">
                  <button
                    type="button"
                    className="vt-share-cta"
                    data-variant="primary"
                    onClick={close}
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}
            {step === "success" && joinStatus !== "pending" && (
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
