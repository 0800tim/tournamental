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
import type { AuthState, UserProfile } from "./types";

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
    if (!cfg) {
      setState(UNCONFIGURED);
      setLoading(false);
      return;
    }
    const sb = browserClient();
    if (!sb) {
      setState(UNCONFIGURED);
      setLoading(false);
      return;
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
        setState(GUEST);
        setLoading(false);
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
        setState(GUEST);
        setLoading(false);
        return;
      }
      void loadProfileFor(
        session.user.id,
        session.user.email ?? null,
        session.user.phone ?? null,
      );
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
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
