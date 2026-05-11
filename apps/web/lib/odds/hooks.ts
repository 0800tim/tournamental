/**
 * React hooks for the live odds client.
 *
 * `useMatchOdds(matchNo, homeTeam, awayTeam)` is the primary consumer.
 * It runs the tier-fallback `fetchMatchOdds` on mount, refreshes every
 * 60s while the component is mounted, and exposes `data | null`,
 * `tier`, `error | null`, and a `refresh()` function.
 *
 * Why a custom hook (rather than SWR / React Query), we want zero
 * extra deps. The chip is on every group/knockout match (~120 of them
 * on the page), so we avoid kicking off a request storm with simple
 * jittered polling.
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import { fetchMatchOdds } from "./client";
import type { MatchOdds, OddsClientResult } from "./types";

const REFRESH_MS = 60_000;
const ON_MOUNT_JITTER_MAX_MS = 800;

export interface UseMatchOddsArgs {
  readonly matchNo: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly noDraw?: boolean;
  readonly enabled?: boolean;
}

export interface UseMatchOddsState {
  readonly data: MatchOdds | null;
  readonly tier: "live" | "stub" | "mock" | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useMatchOdds(args: UseMatchOddsArgs): UseMatchOddsState {
  const { matchNo, homeTeam, awayTeam, noDraw, enabled = true } = args;

  const [data, setData] = useState<MatchOdds | null>(null);
  const [tier, setTier] = useState<"live" | "stub" | "mock" | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Latest controller so a refresh aborts an in-flight previous fetch.
  const ctrlRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!enabled) return;
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    try {
      const result: OddsClientResult<MatchOdds> = await fetchMatchOdds({
        matchNo,
        homeTeam,
        awayTeam,
        noDraw,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (result.ok) {
        setData(result.data);
        setTier(result.tier);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError((e as Error).message);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [matchNo, homeTeam, awayTeam, noDraw, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Stagger initial fetches on a busy page (12 groups × 6 matches = 72
    // chips) so we don't synchronously kick off 72 requests on mount.
    const jitter = Math.floor(Math.random() * ON_MOUNT_JITTER_MAX_MS);
    const t0 = setTimeout(() => {
      run();
    }, jitter);
    return () => {
      clearTimeout(t0);
      if (ctrlRef.current) ctrlRef.current.abort();
    };
  }, [run, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      run();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [run, enabled]);

  return { data, tier, loading, error, refresh: run };
}
