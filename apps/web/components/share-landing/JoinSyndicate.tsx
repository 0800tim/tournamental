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
import { useCallback, useEffect, useMemo, useState } from "react";

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
  /** The user's @handle. Per Tim 2026-06-05, display_name IS the @handle. */
  readonly displayName: string;
  readonly firstName: string;
  readonly lastName: string;
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
    const j = JSON.parse(raw) as Partial<PendingJoin> & { handle?: string };
    if (!j || typeof j.slug !== "string") return null;
    // Tolerant load: the v1 schema stored a separate `handle`. v2 uses
    // displayName as the @handle directly. Migrate old saves so an
    // upgraded user with a stale pending row doesn't lose state.
    const displayName =
      typeof j.displayName === "string" && j.displayName.length > 0
        ? j.displayName
        : typeof j.handle === "string"
          ? j.handle
          : "";
    return {
      slug: j.slug,
      displayName,
      firstName: typeof j.firstName === "string" ? j.firstName : "",
      lastName: typeof j.lastName === "string" ? j.lastName : "",
    };
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

/**
 * Standard "the code / link is dead" copy with a tappable WhatsApp
 * deep-link that pre-fills the keyword `login` (carrying the pool
 * slug so the auth-sms inbound-login route returns the user straight
 * to this pool). Tim 2026-06-07. */
function renderWhatsAppRecovery(
  headline: string,
  poolSlug?: string,
): React.ReactNode {
  return (
    <>
      {headline}{" "}
      <a
        href={whatsAppLoginDeepLink(poolSlug ?? null)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#fbbf24",
          textDecoration: "underline",
          fontWeight: 600,
        }}
      >
        Text &ldquo;login&rdquo; to Tournamental on WhatsApp
      </a>{" "}
      to get a fresh code and magic link.
    </>
  );
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

/** Mirror of `slugify` in ProfileCompletionGate.tsx and the auth-sms
 * server's slugifyDisplayName. The form's @handle field is what becomes
 * the user's display_name, and the server slugifies it on save, so the
 * client-side preview here only exists to give early validation feedback
 * before submit. */
function slugifyHandle(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Mirror of the gate's RESERVED_HANDLES list. Server is the source of
 * truth; this is for early UI feedback only. */
const RESERVED_HANDLES = new Set<string>([
  "admin", "administrator", "api", "www", "play", "you", "me",
  "anonymous", "anon", "deleted", "support", "help", "tournamental",
  "official", "staff", "team", "mod", "moderator", "root", "system",
  "null", "undefined",
]);

type Step = "identity" | "verify" | "success" | "exit";

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

  // Identity step. Per Tim 2026-06-05 (cffa1d3 / 2f52efe), display_name
  // IS the user's permanent @handle (URL-safe), and first_name / last_name
  // are the separate human-readable name fields. Before this rewrite the
  // modal asked for a `displayName` (= human name) + a separate `handle`
  // (= slug), and PATCHed the human name into auth-sms as display_name,
  // locking it as the user's @handle. Tim hit the resulting "my full name
  // is now my handle and it's locked" trap 2026-06-06.
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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

  // Whether the authed viewer is already a member of this pool. Drives
  // the CTA: Join (not a member) vs Exit (already a member).
  const [isMember, setIsMember] = useState(false);
  // The pool owner manages from the dashboard, not the public CTA — hide
  // Join/Exit for them entirely.
  const [isOwner, setIsOwner] = useState(false);

  // Verify step
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [usingEmail, setUsingEmail] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);

  // Shared
  const [busy, setBusy] = useState(false);
  // Errors can be plain strings or a small ReactNode (e.g. with an
  // embedded "Text login to Tournamental on WhatsApp" deep-link for
  // already-used / expired codes). Tim 2026-06-07.
  const [error, setError] = useState<React.ReactNode>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Live-slugified preview of the @handle. The user types what they
  // want; we show the resulting slug as a hint, and the server
  // slugifies again on save (it's the source of truth).
  const handleSlug = useMemo(() => slugifyHandle(displayName), [displayName]);

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
      // Active joins land straight in the bracket. Brief delay so the
      // "You're in!" confirmation is seen before the reload. Pending
      // (approval-gated) joins stay on the success/pending message.
      if (body.status !== "pending") {
        window.setTimeout(() => window.location.replace("/world-cup-2026"), 1200);
      }
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

  // Detect existing membership for the authed viewer so the CTA shows
  // Exit instead of Join.
  useEffect(() => {
    if (!isAuthed) {
      setIsMember(false);
      return;
    }
    const ac = new AbortController();
    void (async () => {
      try {
        const r = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/join`,
          { credentials: "include", signal: ac.signal },
        );
        if (!r.ok) return;
        const j = (await r.json().catch(() => ({}))) as {
          is_member?: boolean;
          is_owner?: boolean;
        };
        if (!ac.signal.aborted) {
          setIsMember(!!j.is_member);
          setIsOwner(!!j.is_owner);
        }
      } catch {
        /* best-effort — default to Join on failure */
      }
    })();
    return () => ac.abort();
  }, [isAuthed, slug]);

  // Leave the pool (DELETE membership), then reload so the member count
  // and leaderboard reflect the departure.
  const handleLeave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/join`,
        { method: "DELETE", credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(j.message ?? j.error ?? `Server returned ${r.status}`);
        return;
      }
      setIsMember(false);
      setOpen(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [slug]);

  // @handle validity, must slugify cleanly to 3..32 chars and not be on
  // the reserved list. Same rule the ProfileCompletionGate enforces;
  // the server re-validates on PATCH /v1/auth/me.
  const handleIsValid =
    handleSlug.length >= 3 &&
    handleSlug.length <= 32 &&
    !RESERVED_HANDLES.has(handleSlug);
  const phoneIsValid = /^\+\d{8,15}$/.test(normalisePhone(phone));
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityEmail.trim());
  // At least one contact channel must validate; both is fine.
  const hasContact = (phone.trim() && phoneIsValid) || (identityEmail.trim() && emailIsValid);
  const canSubmitIdentity = !busy && handleIsValid && hasContact;

  const onSubmitIdentity = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmitIdentity) return;
      setBusy(true);
      setError(null);
      setInfo(null);

      try {
        // 1) @handle availability check against the slugified value (cheap,
        //    no OTP consumed). Server-side uniqueness lives in auth-sms
        //    `display_name`; this endpoint is a quick lookahead so the
        //    user finds out before they paste an OTP.
        const checkRes = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/handle-check?handle=${encodeURIComponent(handleSlug)}`,
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
              ? "That handle isn't valid. Letters, numbers, and underscores, 3 to 32 chars."
              : `Sorry, "${handleSlug}" is already taken. Pick a different handle.`,
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
              displayName: handleSlug,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
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
          displayName: handleSlug,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
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
      phone,
      displayName,
      handleSlug,
      firstName,
      lastName,
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
    // Bind the user's @handle (display_name) + first/last name on the
    // auth-sms record. Per Tim 2026-06-05 display_name IS the @handle;
    // first/last are the separate human-readable fields. We slugify
    // client-side for early validation and again before send so the
    // saved value matches what the user previewed.
    const handleForSave = slugifyHandle(displayName);
    try {
      await fetch(`${AUTH_BASE.replace(/\/$/, "")}/v1/auth/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: handleForSave,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        }),
      });
    } catch {
      /* non-fatal; user can edit later */
    }
    // Add to the pool. The /join route ignores the body's handle /
    // display_name and uses session.displayName as the membership
    // handle (per the 2026-06-05 'one identity per user' rule), but we
    // still send them for older clients / log clarity.
    try {
      const r = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/join`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: handleForSave,
            display_name: handleForSave,
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
  }, [slug, displayName, firstName, lastName]);

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
            ? renderWhatsAppRecovery(
                "That code has already been used or expired.",
                slug,
              )
            : res.error === "ip-throttled"
              ? "Too many tries from this network. Wait a minute and try again."
              : renderWhatsAppRecovery("Sign-in failed.", slug),
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
      setFirstName(p.firstName);
      setLastName(p.lastName);
    }
  }, [open, slug]);

  return (
    <>
      {!isOwner && (
        <button
          className="vt-share-cta"
          data-variant={isMember ? "ghost" : "primary"}
          type="button"
          onClick={
            isMember
              ? () => {
                  setError(null);
                  setStep("exit");
                  setOpen(true);
                }
              : handleCtaClick
          }
          disabled={busy && isAuthed}
        >
          {busy && isAuthed
            ? isMember
              ? safeT(t, "join.button_leaving", "Leaving…")
              : safeT(t, "join.button_joining", "Joining…")
            : isMember
              ? safeT(t, "syndicate.cta_exit", "Exit this pool")
              : safeT(t, "syndicate.cta_join", "Join this pool")}
        </button>
      )}
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
            {step === "exit" && (
              <div className="vt-join-form">
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  {safeT(t, "join.exit.title", "Leave {pool_name}?").replace("{pool_name}", syndicateName)}
                </h2>
                <p className="vt-share-modal-body">
                  {safeT(
                    t,
                    "join.exit.body",
                    "Are you sure you want to leave {pool_name}? You can rejoin any time before kickoff.",
                  ).replace("{pool_name}", syndicateName)}
                </p>
                {error && <p className="vt-join-error">{error}</p>}
                <div className="vt-share-modal-row vt-share-modal-row--single">
                  <button
                    type="button"
                    className="vt-share-cta"
                    data-variant="primary"
                    onClick={() => void handleLeave()}
                    disabled={busy}
                  >
                    {busy
                      ? safeT(t, "join.button_leaving", "Leaving…")
                      : safeT(t, "join.exit.confirm", "Leave pool")}
                  </button>
                </div>
                <button
                  type="button"
                  className="vt-join-footnote vt-join-exit-cancel"
                  onClick={close}
                  disabled={busy}
                >
                  {safeT(t, "join.exit.cancel", "Cancel, stay in the pool")}
                </button>
              </div>
            )}
            {step === "identity" && (
              <form
                onSubmit={onSubmitIdentity}
                className="vt-join-form"
              >
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  {safeT(t, "join.modal.title", "Join {pool_name}").replace("{pool_name}", syndicateName)}
                </h2>
                <p className="vt-share-modal-body">
                  {safeT(t, "join.modal.body", "Pick your @handle for the leaderboard, then we'll send a one-time login code by WhatsApp or email.")}
                </p>
                <label className="vt-join-label">
                  <span>{safeT(t, "join.modal.field_handle_v2", "Your @handle (permanent)")}</span>
                  <input
                    type="text"
                    className="vt-share-modal-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={safeT(t, "join.modal.field_handle_placeholder_v2", "e.g. tim_thomas")}
                    autoFocus
                    maxLength={60}
                    required
                    aria-describedby="vt-join-handle-help"
                  />
                  <span id="vt-join-handle-help" className="vt-join-help">
                    {handleSlug && handleSlug !== displayName.toLowerCase()
                      ? safeT(t, "join.modal.field_handle_preview", "Will be saved as: ").concat(`@${handleSlug}`)
                      : safeT(
                          t,
                          "join.modal.field_handle_help",
                          "3 to 32 characters. Letters, numbers, and underscores. Can't be changed once set.",
                        )}
                  </span>
                </label>
                <div className="vt-share-modal-row vt-share-modal-row--two">
                  <label className="vt-join-label">
                    <span>{safeT(t, "join.modal.field_first_name", "First name")}</span>
                    <input
                      type="text"
                      className="vt-share-modal-input"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={safeT(t, "join.modal.field_first_name_placeholder", "Tim")}
                      maxLength={40}
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="vt-join-label">
                    <span>{safeT(t, "join.modal.field_last_name", "Last name")}</span>
                    <input
                      type="text"
                      className="vt-share-modal-input"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={safeT(t, "join.modal.field_last_name_placeholder", "Thomas")}
                      maxLength={40}
                      autoComplete="family-name"
                    />
                  </label>
                </div>
                <label className="vt-join-label">
                  <span>{safeT(t, "join.modal.field_phone", "Mobile number (for WhatsApp login)")}</span>
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
                  <span>{safeT(t, "join.modal.field_email", "Email (optional fallback)")}</span>
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
                    {safeT(t, "join.modal.field_email_help", "If you don't use WhatsApp, enter your email address to get a one-time code. Provide either, or both, we send the code to every channel you give us.")}
                  </span>
                </label>
                {error === "PHONE_ALREADY_REGISTERED" ? (
                  <div className="vt-join-error vt-join-error--registered">
                    <p>
                      <strong>{safeT(t, "join.error.phone_registered_strong", "That phone is already registered.")}</strong>{" "}
                      {safeT(t, "join.error.phone_registered_body", "If it's yours, log in via WhatsApp instead, you'll get the one-time code and a tap-to-sign-in link, then we add you to {pool_name} automatically.").replace("{pool_name}", syndicateName)}
                    </p>
                    <a
                      className="vt-share-cta"
                      data-variant="primary"
                      href={whatsAppLoginDeepLink(slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {safeT(t, "join.error.whatsapp_login", "Log in via WhatsApp →")}
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
                  {safeT(t, "join.modal.footnote", "By joining you agree to our terms. We only use your contact details for sign-in, no marketing, no third parties.")}
                </p>
              </form>
            )}

            {step === "verify" && (
              <div className="vt-join-form">
                <h2 className="vt-share-modal-title" id="vt-join-modal-title">
                  {safeT(t, "join.verify.title", "Enter your code")}
                </h2>
                <p className="vt-share-modal-body">
                  {phoneMasked
                    ? safeT(t, "join.verify.label_whatsapp", "We've just sent a 6-digit code via WhatsApp to {phone}. Tap the link in the message to sign in instantly, or paste the code here.").replace("{phone}", phoneMasked)
                    : email
                      ? safeT(t, "join.verify.label_email", "We've just sent a 6-digit code by email to {email}. Paste it below to sign in.").replace("{email}", email)
                      : safeT(t, "join.verify.label_generic", "We've just sent a 6-digit code. Paste it below to sign in.")}
                </p>

                {/* WhatsApp self-trigger fallback (also surfaces when the
                  * outbound send failed at submit-time, info message
                  * above directs the user here). */}
                <a
                  className="vt-share-cta vt-join-wa-btn"
                  data-variant="secondary"
                  href={whatsAppLoginDeepLink(slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {safeT(t, "join.verify.button_whatsapp", "💬 Open WhatsApp & message us")}
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
                    {busy
                      ? safeT(t, "join.verify.button_verifying", "Verifying…")
                      : usingEmail
                        ? safeT(t, "join.verify.button_verify_email", "Verify email code")
                        : safeT(t, "join.verify.button_verify_code", "Sign in with code")}
                  </button>
                </form>

                {/* Always-visible email fallback (Tim 2026-05-22: no fade
                  * delay — show it from the start so non-WhatsApp users
                  * can switch immediately). */}
                <div className="vt-join-fallback">
                  <p className="vt-join-fallback-lede">
                    {safeT(t, "join.verify.fallback_lede", "Don't use WhatsApp? Get the code by email instead.")}
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
                      {safeT(t, "join.verify.button_send_email", "Send email code")}
                    </button>
                  </div>
                  {usingEmail && (
                    <p className="vt-join-info">
                      {safeT(t, "join.verify.fallback_sent", "Email code sent. Use the input above to enter it, then tap Verify email code.")}
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
                    {safeT(t, "join.verify.button_cancel", "Cancel")}
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
                    {safeT(t, "join.verify.button_edit", "← Edit details")}
                  </button>
                </div>
              </div>
            )}

            {step === "success" && joinStatus === "pending" && (
              <div className="vt-join-success">
                <h2 className="vt-share-modal-title">{safeT(t, "join.success.title_pending", "📨 Request sent")}</h2>
                <p className="vt-share-modal-body">
                  {safeT(t, "join.success.body_pending", "Your request to join {pool_name} has been sent to the pool administrator. You'll get a notification when they accept it.").replace("{pool_name}", syndicateName)}
                </p>
                <div className="vt-share-modal-row vt-share-modal-row--single">
                  <button
                    type="button"
                    className="vt-share-cta"
                    data-variant="primary"
                    onClick={close}
                  >
                    {safeT(t, "join.success.cta_pending", "Got it")}
                  </button>
                </div>
              </div>
            )}
            {step === "success" && joinStatus !== "pending" && (
              <div className="vt-join-success">
                <h2 className="vt-share-modal-title">{safeT(t, "join.success.title_active", "✅ You're in!")}</h2>
                <p className="vt-share-modal-body">
                  {safeT(t, "join.success.body_active", "Welcome to {pool_name}. Loading your bracket…").replace("{pool_name}", syndicateName)}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
