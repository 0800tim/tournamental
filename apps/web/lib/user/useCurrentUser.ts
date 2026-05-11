/**
 * `useCurrentUser` — a tiny client hook that exposes the locally-stored
 * user + an imperative refresh.
 *
 * No SWR / React-Query because this is read once per page (the AppShell
 * mounts it and passes the result down). On mount it also fires a
 * once-per-session /v1/users/:id/visit so the engagement-band counter
 * stays current.
 *
 * The hook is intentionally tolerant: if the API call fails for any
 * reason (cold server, network glitch, CORS misconfig) we keep the
 * local-storage view and reconcile next session.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { getMe, postVisit, type MeResponse } from "./api";
import {
  clearLocalUser,
  getLocalUser,
  markVisitPosted,
  shouldPostVisit,
  type LocalUser,
} from "./storage";

export interface UseCurrentUserResult {
  readonly user: LocalUser | null;
  readonly profile: MeResponse | null;
  readonly isLoading: boolean;
  readonly isHydrated: boolean;
  refresh(): Promise<void>;
  signOutLocally(): void;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isHydrated, setHydrated] = useState(false);

  const refresh = useCallback(async () => {
    const local = getLocalUser();
    setUser(local);
    setHydrated(true);
    if (!local) {
      setProfile(null);
      return;
    }
    setLoading(true);
    try {
      const me = await getMe(local.id);
      setProfile(me);
    } catch {
      // Network / 404 / 410: keep the local view. If the API says 410,
      // the user was soft-deleted somewhere else and we'd want to clear.
      // We bias toward "keep showing the user" so a flaky connection
      // doesn't kick them out mid-session.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fire a visit ping once per session (the storage helper enforces
  // the 8h debounce).
  useEffect(() => {
    if (!user) return;
    if (!shouldPostVisit()) return;
    markVisitPosted();
    void postVisit(user.id).catch(() => {
      // best-effort; the next session will retry.
    });
  }, [user]);

  const signOutLocally = useCallback(() => {
    clearLocalUser();
    setUser(null);
    setProfile(null);
  }, []);

  return { user, profile, isLoading, isHydrated, refresh, signOutLocally };
}
