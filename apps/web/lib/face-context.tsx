"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Player } from "@vtorn/spec";
import {
  buildFaceLookup,
  parseFaceCsv,
  type FaceCsvRow,
} from "@/lib/face-map";

/**
 * Player face URL provider.
 *
 * The renderer fetches the wc2022 player CSV once at scene mount and
 * resolves a per-player face URL (or `undefined`, in which case the
 * `<BillboardFace>` falls back to the kit-coloured initials disc).
 *
 * The lookup is exposed via React context so every <Player> component
 * gets a stable function reference and we don't refetch per player.
 */
const DEFAULT_CSV_URL = "/data/wc2022-final-players.csv";

export interface FaceContextValue {
  /** Resolved face image URL for `player`, or undefined for fallback. */
  resolve(player: Player): string | undefined;
  /** Loading status for diagnostic UIs. */
  status: "idle" | "loading" | "ready" | "error";
  rows: FaceCsvRow[];
}

const FaceContext = createContext<FaceContextValue>({
  resolve: () => undefined,
  status: "idle",
  rows: [],
});

export interface FaceProviderProps {
  /** CSV URL. Defaults to `/data/wc2022-final-players.csv`. */
  url?: string;
  children: ReactNode;
}

export function FaceProvider({ url = DEFAULT_CSV_URL, children }: FaceProviderProps) {
  const [rows, setRows] = useState<FaceCsvRow[]>([]);
  const [status, setStatus] = useState<FaceContextValue["status"]>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`face csv ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setRows(parseFaceCsv(text));
        setStatus("ready");
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[face-provider] failed to load CSV:", err);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const value = useMemo<FaceContextValue>(() => {
    const lookup = buildFaceLookup(rows);
    return {
      resolve: lookup,
      status,
      rows,
    };
  }, [rows, status]);

  return <FaceContext.Provider value={value}>{children}</FaceContext.Provider>;
}

export function useFaceLookup(): FaceContextValue {
  return useContext(FaceContext);
}
