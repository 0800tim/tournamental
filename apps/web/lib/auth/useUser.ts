"use client";

/**
 * React hook for the current auth/profile state.
 *
 *   const { status, user, profile, loading } = useUser();
 *
 * Status values:
 *   "loading"       , initial fetch is in flight
 *   "guest"         , Supabase is configured but no session exists
 *   "authenticated" , signed-in user with profile loaded
 *   "unconfigured"  , Supabase env vars are missing (dev-without-creds)
 *
 * Subscribes to `auth.onAuthStateChange` so a sign-in / sign-out in
 * another tab flows through here without a refresh.
 *
 * Profile loading: on every auth state change we `select * from
 * user_profiles where id = auth.uid()` once. We do **not** subscribe to
 * the profile table, edits happen via Server Actions that refetch on
 * success, which is cheaper than a realtime subscription.
 */

import { useEffect, useRef, useState } from "react";

import { browserClient } from "./supabase";
import { readPublicConfig } from "./config";
import { AUTH_BASE } from "./inbound-login";
import type { AuthState, UserProfile } from "./types";

/**
 * Probe the auth-sms service for an inbound-login session. Reads the
 * `tnm_session` HttpOnly cookie via /v1/auth/me. Returns the minimal
 * user shape we surface as `state.user` when Supabase has no session,
 * so AuthChip flips to the authed pill after WhatsApp / SMS sign-in.
 */
/**
 * Turn an E.164 phone into a friendlier short handle for the AuthChip
 * label. We can't know the user's preferred handle without a server
 * profile, so we use the last 4 digits, like "+64…1234". Plenty of
 * privacy headroom for screenshots while still being recognisable to
 * the user.
 */
function maskPhoneHandle(phone: string): string {
  const trimmed = phone.replace(/[^0-9+]/g, "");
  if (trimmed.length < 5) return trimmed || "you";
  return `+${trimmed.replace(/^\+/, "").slice(0, 2)}…${trimmed.slice(-4)}`;
}

async function probeInboundSession(signal?: AbortSignal): Promise<{
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string | null;
} | null> {
  try {
    const r = await fetch(AUTH_BASE.replace(/\/$/, "") + "/v1/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      user?: {
        id?: string;
        phone?: string | null;
        email?: string | null;
        displayName?: string | null;
      };
    };
    const u = j.user;
    if (!u || !u.id) return null;
    return {
      id: u.id,
      phone: u.phone ?? null,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
    };
  } catch {
    return null;
  }
}

const INITIAL_LOADING: AuthState = {
  status: "loading",
  user: null,
  profile: null,
};

const UNCONFIGURED: AuthState = {
  status: "unconfigured",
  user: null,
  profile: null,
};

const GUEST: AuthState = {
  status: "guest",
  user: null,
  profile: null,
};

export interface UseUserReturn extends AuthState {
  /** True while the *first* load is in flight. */
  loading: boolean;
  /** Force-refresh the profile (after a server-side edit). */
  refresh: () => Promise<void>;
}

export function useUser(): UseUserReturn {
  const [state, setState] = useState<AuthState>(INITIAL_LOADING);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cfg = readPublicConfig();
  const cfgKey = cfg?.url ?? null;

  useEffect(() => {
    const ac = new AbortController();

    // Helper: when Supabase has no session (or isn't configured at
    // all), fall through to the inbound-login session (tnm_session
    // cookie). If that returns a user, surface as authenticated with
    // a synthetic minimal profile so AuthChip + the rest of the
    // shell render the signed-in state.
    const applyGuestOrInbound = async (fallbackState: AuthState) => {
      const inbound = await probeInboundSession(ac.signal);
      if (ac.signal.aborted || !mountedRef.current) return;
      if (!inbound) {
        setState(fallbackState);
        setLoading(false);
        return;
      }
      // Prefer the user's chosen display name when it looks like a
      // handle (alphanumeric + underscores). Otherwise fall back to a
      // masked phone label so AuthChip still has something to render —
      // the masked label deliberately doesn't match the handle regex,
      // so any UI that gates on "real handle" stays correct.
      const displayName = inbound.displayName ?? null;
      const handle =
        displayName && /^[a-zA-Z0-9_]{2,32}$/.test(displayName)
          ? displayName
          : inbound.phone
            ? maskPhoneHandle(inbound.phone)
            : "you";
      setState({
        status: "authenticated",
        user: { id: inbound.id, email: inbound.email, phone: inbound.phone },
        profile: {
          id: inbound.id,
          handle,
          display_name: displayName ?? handle,
        } as UserProfile,
      });
      setLoading(false);
    };

    if (!cfg) {
      void applyGuestOrInbound(UNCONFIGURED);
      return () => ac.abort();
    }
    const sb = browserClient();
    if (!sb) {
      void applyGuestOrInbound(UNCONFIGURED);
      return () => ac.abort();
    }

    let cancelled = false;

    const loadProfileFor = async (
      userId: string,
      email: string | null,
      phone: string | null,
    ) => {
      const { data, error } = await sb
        .from("user_profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled || !mountedRef.current) return;
      if (error) {
        // Profile not loaded, still authenticated, but the row is missing.
        setState({
          status: "authenticated",
          user: { id: userId, email, phone },
          profile: null,
        });
        setLoading(false);
        return;
      }
      setState({
        status: "authenticated",
        user: { id: userId, email, phone },
        profile: (data ?? null) as UserProfile | null,
      });
      setLoading(false);
    };

    const init = async () => {
      const { data } = await sb.auth.getUser();
      const u = data?.user;
      if (!u) {
        if (cancelled || !mountedRef.current) return;
        await applyGuestOrInbound(GUEST);
        return;
      }
      await loadProfileFor(u.id, u.email ?? null, u.phone ?? null);
    };

    void init();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      if (cancelled || !mountedRef.current) return;
      if (!session?.user) {
        void applyGuestOrInbound(GUEST);
        return;
      }
      void loadProfileFor(
        session.user.id,
        session.user.email ?? null,
        session.user.phone ?? null,
      );
    });

    // Inbound-login (WhatsApp / SMS / email OTP) sets the
    // `tnm_session` cookie but doesn't fire Supabase auth events, so
    // useUser would stay on its pre-auth state until a hard reload.
    // The JoinFlowClient and other inbound-aware components dispatch
    // a `tnm:auth-changed` window event after a successful inbound
    // sign-in; we re-probe here so the ProfileCompletionGate +
    // AuthChip + anything else that reads useUser flip to
    // authenticated without a page reload. Tim 2026-06-06.
    const onInboundAuthChanged = (): void => {
      if (cancelled || !mountedRef.current) return;
      void applyGuestOrInbound(GUEST);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("tnm:auth-changed", onInboundAuthChanged);
    }

    return () => {
      cancelled = true;
      ac.abort();
      subscription.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("tnm:auth-changed", onInboundAuthChanged);
      }
    };
    // We intentionally depend on cfgKey (a string) rather than the cfg
    // object so this effect runs once per provisioned project, not on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const refresh = async () => {
    const sb = browserClient();
    if (!sb || !state.user) return;
    const { data } = await sb
      .from("user_profiles")
      .select("*")
      .eq("id", state.user.id)
      .maybeSingle();
    if (!mountedRef.current) return;
    setState((s) => ({
      ...s,
      profile: (data ?? null) as UserProfile | null,
    }));
  };

  return { ...state, loading, refresh };
}
