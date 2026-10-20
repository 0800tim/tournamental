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

import {
  chromeTournament,
  summarise,
  tournamentBySlug,
  upcomingTournament,
  type TournamentSummary,
} from "@/lib/tournaments/registry";

export type ShellMode = "live" | "archive" | "hub";

export interface ShellModeState {
  readonly mode: ShellMode;
  /** Archived tournament slug (e.g. "fwc2026") when mode is "archive". */
  readonly slug: string | null;
  /** Display name of the archived tournament, for banners. */
  readonly name: string | null;
  /** ISO end date of the archived tournament. */
  readonly endsUtc: string | null;
  /**
   * The tournament this request is about: the archived entry on an
   * archive host, the active (or newest archived) entry on the live
   * host, null on the hub. Chrome reads names, codes and route bases
   * from here instead of naming a tournament (2026-10-20).
   */
  readonly current: TournamentSummary | null;
  /** The upcoming entry, for hub labels and "what's next" links. */
  readonly upcoming: TournamentSummary | null;
}

/** State for a plain live render with no provider (tests, previews). */
export function defaultShellMode(): ShellModeState {
  return {
    mode: "live",
    slug: null,
    name: null,
    endsUtc: null,
    current: summarise(chromeTournament()),
    upcoming: summarise(upcomingTournament()),
  };
}

const ShellModeContext = createContext<ShellModeState>(defaultShellMode());

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
  const entry = slug ? tournamentBySlug(slug) : null;
  return (
    <ShellModeProvider
      value={{
        mode: slug ? "archive" : "live",
        slug,
        name: entry?.name ?? null,
        endsUtc: entry?.endsUtc ?? null,
        current: summarise(entry ?? chromeTournament()),
        upcoming: summarise(upcomingTournament()),
      }}
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
