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
import { useState } from "react";

import { SignupModal } from "@/components/auth/SignupModal";
import { useUser } from "@/lib/auth/useUser";

export function AuthChip() {
  const { status, profile, loading } = useUser();
  const [open, setOpen] = useState(false);

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
          aria-label="Sign in"
          onClick={() => setOpen(true)}
        >
          Sign in
        </button>
        <SignupModal
          open={open}
          onClose={() => setOpen(false)}
          initialTab="whatsapp"
        />
      </>
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
