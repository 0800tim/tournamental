"use client";

/**
 * Right-side auth chip for the desktop nav row.
 *
 * Three visual states, all driven by the `useUser()` hook:
 *
 *   - `loading` / `unconfigured` / `guest` → "Sign in" pill (gold-on-
 *     dark). Clicking opens the SignupModal IN PLACE rather than
 *     routing to /profile. This is one less hop for the user (Tim's
 *     ask: "the sign-in page should just trigger the pop-up directly").
 *
 *   - `authenticated` with profile → small avatar circle (initial of
 *     handle or display name) + handle text, links to /profile.
 *
 *   - `authenticated` without profile (row missing) → fallback "You"
 *     handle so the chip still renders.
 *
 * This is the only piece of the desktop nav that subscribes to auth
 * state, so on every route change only this chip re-renders. The
 * SignupModal mount adds ~6 KB to the shell bundle (gzipped) when
 * Sign-in is the active state; the trade is one fewer click.
 */

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SignupModal } from "@/components/auth/SignupModal";
import { useUser } from "@/lib/auth/useUser";

/**
 * Best-effort initials from the resolved auth profile. Per Tim
 * 2026-05-21: previously this was just the first character of the
 * handle (e.g. "0" for "0800tim"), which neither matches the user's
 * real initials nor their uploaded photo. Now:
 *   1. If display_name parses into 2+ words, use first letter of each
 *      of the first two words (e.g. "Tim Thomas" → "TT").
 *   2. Else first character of the handle, uppercased.
 * The avatar element below renders an <img src="/avatars/<id>.jpg">
 * first; this initial only shows when the image fails to load.
 */
function initialsFrom(profile: { display_name?: string | null; handle?: string | null } | null): string {
  const display = (profile?.display_name ?? "").trim();
  if (display) {
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
    }
    if (parts.length === 1 && parts[0]!.length >= 2) {
      return parts[0]!.slice(0, 2).toUpperCase();
    }
  }
  const handle = (profile?.handle ?? "Y").trim();
  return (handle.charAt(0) || "Y").toUpperCase();
}

export function AuthChip() {
  const { status, profile, user, loading } = useUser();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const signInLabel = (() => {
    try {
      const out = t("authchip.sign_in_up");
      return out === "authchip.sign_in_up" ? "Sign In/Up" : out;
    } catch {
      return "Sign In/Up";
    }
  })();

  // Unauthenticated default — show a "Sign in" chip. We render this for
  // `loading` too because the chip is small and a flashing skeleton at
  // the top-right is noisier than a stable pill. If the hook resolves
  // to `authenticated` the chip swaps.
  if (
    loading ||
    status === "loading" ||
    status === "guest" ||
    status === "unconfigured"
  ) {
    return (
      <>
        <button
          type="button"
          className="vt-appbar-auth vt-appbar-auth-signin"
          aria-label="Sign in or sign up"
          onClick={() => setOpen(true)}
        >
          {signInLabel}
        </button>
        <SignupModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  // Authenticated.
  const handle = profile?.handle ?? "You";
  const display = profile?.display_name ?? handle;
  const initials = initialsFrom(profile);
  // /avatars/<id>.jpg is the canonical avatar URL (see
  // apps/web/app/avatars/[filename]/route.ts). Falls back to initials
  // when the file is missing or 404s. A query string lets a fresh
  // upload bust the cache; we only need one consistent value per page
  // load, so the user id itself is fine.
  const avatarSrc = user?.id ? `/avatars/${user.id}.jpg` : null;
  const showAvatar = !!avatarSrc && !avatarFailed;
  return (
    <Link
      href="/profile"
      className="vt-appbar-auth vt-appbar-auth-profile"
      aria-label={`Open profile for ${display}`}
    >
      {showAvatar ? (
        <img
          src={avatarSrc!}
          alt=""
          width={24}
          height={24}
          className="vt-appbar-auth-avatar vt-appbar-auth-avatar-img"
          onError={() => setAvatarFailed(true)}
          decoding="async"
        />
      ) : (
        <span className="vt-appbar-auth-avatar" aria-hidden="true">
          {initials}
        </span>
      )}
      <span className="vt-appbar-auth-handle">{handle}</span>
    </Link>
  );
}
