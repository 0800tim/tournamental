"use client";

/**
 * First-sign-in mandatory name-capture modal.
 *
 * Tim's rule (2026-06-04): a logged-in user without a display_name cannot do
 * anything else on the site. Half the share-link bugs traced back to users
 * wandering into pool creation / bracket save half-onboarded, then later
 * renaming themselves and breaking the URLs other people had shared. The
 * display_name is the user's permanent @handle and the source of their
 * /s/<handle> URL. Once set it's immutable server-side; we capture it here.
 *
 * Gating behaviour:
 *   - blocks the whole viewport (backdrop is a focus trap; no close button)
 *   - no "Skip" affordance, no ESC dismiss
 *   - server-side validation mirrors the client rules so a determined user
 *     can't bypass via direct PATCH
 *
 * Validation:
 *   - 3-32 characters after slugifying
 *   - letters / numbers / underscores only (free-form display can carry
 *     spaces and capitals; the slug derived from it is what matters)
 *   - reserved-handle blocklist (admin / api / www / play / etc.)
 *   - uniqueness (case-insensitive collision check on the slug)
 *
 * Phone is intentionally NOT captured here: it's a login credential that
 * needs an OTP-verified flow, not a free-text field. Email-only users are
 * offered email; phone-only users (the common WhatsApp case) are offered
 * email as the second handle.
 *
 * Mounted once in the root layout next to <MagicLinkConsumer/>.
 */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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

/** Slug derivation that mirrors the auth-sms server's slugifyDisplayName.
 * Lowercase, strip punctuation, collapse separators to underscore. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Mirror of the server-side reserved list. The server is the source of
 * truth; this is just for the client-side preview so we don't ship users
 * to a 409 after they hit Save. */
const RESERVED_HANDLES = new Set<string>([
  "admin", "administrator", "api", "www", "play", "you", "me",
  "anonymous", "anon", "deleted", "support", "help", "tournamental",
  "official", "staff", "team", "mod", "moderator", "root", "system",
  "tim", "null", "undefined",
]);

interface LocalError {
  readonly kind: "format" | "reserved" | "taken" | "network" | "generic";
  readonly message: string;
}

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
  const [error, setError] = useState<LocalError | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Inbound users only (id `u_…`); skip guests and Supabase accounts.
    const isInbound = status === "authenticated" && (user?.id?.startsWith("u_") ?? false);
    if (!isInbound) {
      setShow(false);
      return;
    }

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
      } else {
        setShow(false);
      }
    })();
    return () => ac.abort();
  }, [status, user?.id]);

  // Live slug preview + client-side validity gate.
  const slugPreview = useMemo(() => slugify(displayName), [displayName]);
  const clientValid = useMemo(() => {
    if (!slugPreview) return { ok: false as const, reason: "empty" as const };
    if (slugPreview.length < 3) return { ok: false as const, reason: "short" as const };
    if (slugPreview.length > 32) return { ok: false as const, reason: "long" as const };
    if (RESERVED_HANDLES.has(slugPreview))
      return { ok: false as const, reason: "reserved" as const };
    return { ok: true as const };
  }, [slugPreview]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    if (!clientValid.ok) {
      if (clientValid.reason === "reserved") {
        setError({
          kind: "reserved",
          message: safeT(
            t,
            "profile_gate.err_reserved",
            "That handle is reserved. Please choose another.",
          ),
        });
      } else {
        setError({
          kind: "format",
          message: safeT(
            t,
            "profile_gate.err_invalid_format",
            "Handles need 3 to 32 characters, made of letters, numbers, and underscores.",
          ),
        });
      }
      return;
    }
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
      let next: LocalError;
      switch (result.error) {
        case "email-taken":
          next = {
            kind: "generic",
            message: safeT(
              t,
              "profile_gate.err_email_taken",
              "That email is already on another account.",
            ),
          };
          break;
        case "bad-email":
          next = {
            kind: "generic",
            message: safeT(
              t,
              "profile_gate.err_bad_email",
              "That email doesn't look right.",
            ),
          };
          break;
        case "display_name_taken":
          next = {
            kind: "taken",
            message: safeT(
              t,
              "profile_gate.err_taken",
              "That handle is already taken. Try another.",
            ),
          };
          break;
        case "display_name_reserved":
          next = {
            kind: "reserved",
            message: safeT(
              t,
              "profile_gate.err_reserved",
              "That handle is reserved. Please choose another.",
            ),
          };
          break;
        case "display_name_invalid":
          next = {
            kind: "format",
            message: safeT(
              t,
              "profile_gate.err_invalid_format",
              "Handles need 3 to 32 characters, made of letters, numbers, and underscores.",
            ),
          };
          break;
        case "network":
          next = {
            kind: "network",
            message: safeT(
              t,
              "profile_gate.err_network",
              "Network hiccup, try again.",
            ),
          };
          break;
        default:
          next = {
            kind: "generic",
            message: safeT(
              t,
              "profile_gate.err_generic",
              "Couldn't save that, try again.",
            ),
          };
      }
      setError(next);
      return;
    }
    // Saved. The auth service mirrors the new details to HighLevel.
    setShow(false);
  };

  if (!show || !mounted || !user) return null;

  const submitDisabled = busy || !clientValid.ok;

  const modal = (
    <div
      className="vt-signup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vt-name-title"
    >
      <div className="vt-signup-scroll">
        <div className="vt-signup-card">
          {/* No close affordance: this gate is mandatory per Tim's 2026-06-04
            * rule. The user picks a handle or they don't proceed. */}
          <h2 id="vt-name-title" className="vt-signup-title">
            {safeT(t, "profile_gate.title", "Pick your @handle")}
          </h2>
          <p className="vt-signup-sub">
            {safeT(
              t,
              "profile_gate.sub",
              "This is your name on Tournamental. It appears on every leaderboard, becomes your share URL (tournamental.com/s/yourname), and you cannot change it later. Pick something you're happy to own publicly.",
            )}
          </p>

          <div className="vt-onboard-avatar">
            <AvatarUploader userId={user.id} />
          </div>

          <form className="vt-signup-form" onSubmit={onSubmit}>
            <input
              aria-label={safeT(
                t,
                "profile_gate.display_name",
                "Your @handle (permanent)",
              )}
              name="display_name"
              type="text"
              autoComplete="nickname"
              placeholder={safeT(
                t,
                "profile_gate.placeholder",
                "yourname",
              )}
              className="auth-input"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (error) setError(null);
              }}
              maxLength={80}
              required
              autoFocus
              disabled={busy}
            />
            {/* Live slug preview so the user knows exactly what their
              * URL will be before they commit. */}
            {slugPreview && (
              <div className="vt-signup-preview" aria-live="polite">
                {safeT(t, "profile_gate.preview_url", "Your share URL: ")}
                <code>tournamental.com/s/{slugPreview}</code>
              </div>
            )}
            <div className="vt-signup-hint">
              {safeT(
                t,
                "profile_gate.hint_format",
                "3-32 characters. Letters, numbers, underscores. Cannot be changed later.",
              )}
            </div>
            <input
              aria-label={safeT(
                t,
                "profile_gate.first_name",
                "First name (optional)",
              )}
              name="first_name"
              type="text"
              autoComplete="given-name"
              placeholder={safeT(
                t,
                "profile_gate.first_name",
                "First name (optional)",
              )}
              className="auth-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={80}
              disabled={busy}
            />
            {needEmail && (
              <input
                aria-label={safeT(
                  t,
                  "profile_gate.email",
                  "Email (optional)",
                )}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={safeT(
                  t,
                  "profile_gate.email",
                  "Email (optional)",
                )}
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                disabled={busy}
              />
            )}
            {error && (
              <div className="auth-error" role="alert">
                {error.message}
              </div>
            )}
            <button
              type="submit"
              className="auth-submit"
              disabled={submitDisabled}
            >
              {busy
                ? safeT(t, "profile_gate.cta_saving", "Saving…")
                : safeT(t, "profile_gate.cta_save", "Claim @handle")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
