"use client";

/**
 * Right-side auth chip for the desktop nav row.
 *
 * Three visual states, all driven by the `useUser()` hook:
 *
 *   - `loading` / `unconfigured` / `guest` → "Sign in" pill (gold-on-
 *     dark), links to /profile where the SignupModal can be opened.
 *     We deliberately default to the same "Sign in" pill on any
 *     non-authenticated status so a missing/misconfigured Supabase
 *     instance still renders a sensible default (Tim's prompt: "If the
 *     hook fails to load, default to Sign in"). /profile already
 *     handles the unconfigured case gracefully.
 *
 *   - `authenticated` with profile → small avatar circle (initial of
 *     handle or display name) + handle text, links to /profile.
 *
 *   - `authenticated` without profile (row missing) → fallback "You"
 *     handle so the chip still renders.
 *
 * This is the only piece of the desktop nav that subscribes to auth
 * state, so on every route change only this chip re-renders.
 *
 * Why a Link not a button: navigating to /profile is a route change,
 * not an in-place action. The /profile page owns the SignupModal so
 * we don't have to mount a duplicate modal at the shell level. This
 * keeps the bundle weight of the shell down.
 */

import Link from "next/link";

import { useUser } from "@/lib/auth/useUser";

export function AuthChip() {
  const { status, profile, loading } = useUser();

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
      <Link
        href="/profile"
        className="vt-appbar-auth vt-appbar-auth-signin"
        aria-label="Sign in"
      >
        Sign in
      </Link>
    );
  }

  // Authenticated.
  const handle = profile?.handle ?? "You";
  const display = profile?.display_name ?? handle;
  const initial = (handle || "Y").trim().charAt(0).toUpperCase();
  return (
    <Link
      href="/profile"
      className="vt-appbar-auth vt-appbar-auth-profile"
      aria-label={`Open profile for ${display}`}
    >
      <span className="vt-appbar-auth-avatar" aria-hidden="true">
        {initial}
      </span>
      <span className="vt-appbar-auth-handle">{handle}</span>
    </Link>
  );
}
