"use client";

/**
 * Shell-mode context for client components (2026-10-16).
 *
 * The root layout reads request headers set by middleware.ts and
 * mounts <ShellModeProvider>:
 *   - `x-tnm-archive: <slug>`  -> mode "archive" (read-only past
 *     tournament, e.g. fwc2026.tournamental.com)
 *   - `x-tnm-hub: 1`           -> mode "hub" (play.tournamental.com
 *     while no tournament is active)
 *   - otherwise                -> mode "live"
 *
 * Client components call useArchive() / useShellMode() to hide
 * sign-up, join, save and create affordances, swap raw counts for
 * percentages or ranks (Tim 2026-10-15), and trim the navigation.
 * Server components use lib/archive/server.ts instead.
 */

import { createContext, useContext, type ReactNode } from "react";

export type ShellMode = "live" | "archive" | "hub";

export interface ShellModeState {
  readonly mode: ShellMode;
  /** Archived tournament slug (e.g. "fwc2026") when mode is "archive". */
  readonly slug: string | null;
  /** Display name of the archived tournament, for banners. */
  readonly name: string | null;
  /** ISO end date of the archived tournament. */
  readonly endsUtc: string | null;
}

const ShellModeContext = createContext<ShellModeState>({
  mode: "live",
  slug: null,
  name: null,
  endsUtc: null,
});

export function ShellModeProvider({
  value,
  children,
}: {
  value: ShellModeState;
  children: ReactNode;
}) {
  return <ShellModeContext.Provider value={value}>{children}</ShellModeContext.Provider>;
}

/** Back-compat alias used by the first archive pass. */
export function ArchiveProvider({
  slug,
  children,
}: {
  slug: string | null;
  children: ReactNode;
}) {
  return (
    <ShellModeProvider
      value={{ mode: slug ? "archive" : "live", slug, name: null, endsUtc: null }}
    >
      {children}
    </ShellModeProvider>
  );
}

export function useShellMode(): ShellModeState {
  return useContext(ShellModeContext);
}

/** True when the current page is being served as a read-only archive. */
export function useArchive(): boolean {
  return useContext(ShellModeContext).mode === "archive";
}

/** True on the play hub (no active tournament). */
export function useHub(): boolean {
  return useContext(ShellModeContext).mode === "hub";
}

export function useArchiveSlug(): string | null {
  return useContext(ShellModeContext).slug;
}
