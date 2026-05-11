/**
 * Guest-mode session, what the app uses when Supabase is unconfigured
 * or the user hasn't signed in yet.
 *
 * The guest id is the stable per-browser id from
 * `lib/bracket/storage.ts` (so existing draft brackets continue to load
 * after a real sign-in attempt that we fall through). When the user
 * eventually signs in, we read this id and migrate any guest-keyed
 * draft into the Supabase-backed user_id.
 *
 * Nothing about the guest session is sent to a server. It exists
 * entirely in localStorage so the UX of "land on a bracket, start
 * making picks, then sign in to save them" doesn't require a network
 * round-trip before the user can interact.
 */

import { localUserId } from "@/lib/bracket/storage";

const GUEST_FLAG = "vtorn:auth:guest_v1";

export interface GuestSession {
  readonly id: string;
  readonly createdAt: string;
}

export function ensureGuestSession(): GuestSession {
  if (typeof window === "undefined") {
    return { id: "ssr_guest", createdAt: new Date(0).toISOString() };
  }
  const existing = window.localStorage.getItem(GUEST_FLAG);
  if (existing) {
    try {
      return JSON.parse(existing) as GuestSession;
    } catch {
      // fall through and recreate
    }
  }
  const session: GuestSession = {
    id: localUserId(),
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(GUEST_FLAG, JSON.stringify(session));
  return session;
}

export function clearGuestSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GUEST_FLAG);
}

/**
 * Pending-invite cookie. Set when a non-authenticated visitor opens
 * `/i/<code>`; consumed on the next successful sign-in to attribute the
 * friendship.
 */
const PENDING_INVITE_KEY = "vtorn:auth:pending_invite_v1";

export function setPendingInvite(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_INVITE_KEY, code);
}

export function readPendingInvite(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PENDING_INVITE_KEY);
}

export function clearPendingInvite(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_INVITE_KEY);
}
