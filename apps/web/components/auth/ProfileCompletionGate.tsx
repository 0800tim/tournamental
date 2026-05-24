"use client";

/**
 * First-sign-in onboarding popup.
 *
 * After an inbound user (WhatsApp/SMS one-time code, Telegram, email OTP, or
 * magic link — id `u_…`) signs in with an empty profile, prompt them once to
 * set up the essentials: avatar, display name, first name, and — when we
 * don't have it yet — their email. We only learn a phone number at first
 * sign-in, so this is where a real name/avatar/email get attached. Because
 * the auth service re-syncs identity fields to HighLevel on profile edit,
 * this also fills the CRM contact (see docs/61-highlevel-integration.md §5a).
 *
 * Lean by design: display name is the only required field; everything else
 * is encouraged but optional, and a "skip for now" sets a per-session flag
 * so we never nag more than once a session.
 *
 * Phone is intentionally NOT captured here: it's a login credential that
 * needs an OTP-verified flow, not a free-text field. Email-only users are
 * offered email; phone-only users (the common WhatsApp case) are offered
 * email as the second handle.
 *
 * Mounted once in the root layout next to <MagicLinkConsumer/>.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

import { AvatarUploader } from "@/components/profile/AvatarUploader";
import {
  fetchInboundUser,
  updateInboundProfile,
} from "@/lib/auth/inbound-login";
import { useUser } from "@/lib/auth/useUser";

import "@/components/profile/avatar-uploader.css";

const SKIP_KEY = "vtourn_name_prompt_skipped";

export function ProfileCompletionGate() {
  const { status, user } = useUser();
  const t = useTranslations();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [needEmail, setNeedEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Inbound users only (id `u_…`); skip guests and Supabase accounts.
    const isInbound = status === "authenticated" && (user?.id?.startsWith("u_") ?? false);
    if (!isInbound) return;
    if (typeof window !== "undefined" && sessionStorage.getItem(SKIP_KEY)) return;

    const ac = new AbortController();
    void (async () => {
      // Authoritative check: useUser masks a missing name as the phone
      // handle, so read the raw record to know if a real name is set.
      const u = await fetchInboundUser(ac.signal);
      if (ac.signal.aborted || !u) return;
      if (!u.displayName) {
        setFirstName(u.firstName ?? "");
        // Offer email only when we don't already have one.
        setNeedEmail(!u.email);
        setShow(true);
      }
    })();
    return () => ac.abort();
  }, [status, user?.id]);

  const dismiss = () => {
    if (typeof window !== "undefined") sessionStorage.setItem(SKIP_KEY, "1");
    setShow(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);

    const patch: Parameters<typeof updateInboundProfile>[0] = {
      display_name: name,
      first_name: firstName.trim() || null,
    };
    const trimmedEmail = email.trim();
    if (needEmail && trimmedEmail) patch.email = trimmedEmail;

    const result = await updateInboundProfile(patch);
    setBusy(false);
    if (!result.ok) {
      const msg =
        result.error === "email-taken"
          ? safeT(t, "profile_gate.err_email_taken", "That email is already on another account.")
          : result.error === "bad-email"
            ? safeT(t, "profile_gate.err_bad_email", "That email doesn't look right.")
            : result.error === "network"
              ? safeT(t, "profile_gate.err_network", "Network hiccup, try again.")
              : safeT(t, "profile_gate.err_generic", "Couldn't save that, try again.");
      setError(msg);
      return;
    }
    // Saved. The auth service mirrors the new details to HighLevel.
    if (typeof window !== "undefined") sessionStorage.setItem(SKIP_KEY, "1");
    setShow(false);
  };

  if (!show || !mounted || !user) return null;

  const modal = (
    <div
      className="vt-signup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vt-name-title"
    >
      <div className="vt-signup-scroll">
        <div className="vt-signup-card">
          <button
            type="button"
            className="vt-signup-close"
            aria-label={safeT(t, "profile_gate.cta_skip", "Skip for now")}
            onClick={dismiss}
          >
            ×
          </button>
          <h2 id="vt-name-title" className="vt-signup-title">
            {safeT(t, "profile_gate.title", "Set up your profile")}
          </h2>
          <p className="vt-signup-sub">
            {safeT(t, "profile_gate.sub", "Add a photo and a display name, this is how you'll appear on the leaderboards and in shared pools.")}
          </p>

          <div className="vt-onboard-avatar">
            <AvatarUploader userId={user.id} />
          </div>

          <form className="vt-signup-form" onSubmit={onSubmit}>
            <input
              aria-label={safeT(t, "profile_gate.display_name", "Display name (shown on leaderboards)")}
              name="display_name"
              type="text"
              autoComplete="nickname"
              placeholder={safeT(t, "profile_gate.display_name", "Display name (shown on leaderboards)")}
              className="auth-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              required
              disabled={busy}
            />
            <input
              aria-label={safeT(t, "profile_gate.first_name", "First name (optional)")}
              name="first_name"
              type="text"
              autoComplete="given-name"
              placeholder={safeT(t, "profile_gate.first_name", "First name (optional)")}
              className="auth-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={80}
              disabled={busy}
            />
            {needEmail && (
              <input
                aria-label={safeT(t, "profile_gate.email", "Email (optional)")}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={safeT(t, "profile_gate.email", "Email (optional)")}
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                disabled={busy}
              />
            )}
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="auth-submit"
              disabled={busy || !displayName.trim()}
            >
              {busy ? safeT(t, "profile_gate.cta_saving", "Saving…") : safeT(t, "profile_gate.cta_save", "Save")}
            </button>
            <button
              type="button"
              className="vt-signup-link"
              onClick={dismiss}
              disabled={busy}
            >
              {safeT(t, "profile_gate.cta_skip", "Skip for now")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
