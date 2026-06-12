/**
 * CalendarPicksContext, the surface the per-row Pick Bar uses to
 * read the user's current bracket and write new picks back.
 *
 * Decoupled from the provider component so per-row consumers can
 * default to a no-op when the calendar is rendered outside the
 * picker (which today never happens, but keeps the row component
 * resilient + testable in isolation).
 *
 * Tim 2026-06-12: see CalendarPicksProvider for the state machine.
 */

"use client";

import { createContext, useContext } from "react";

import type { Bracket, MatchPrediction } from "@tournamental/bracket-engine";

import type { ResultedMatch } from "./types";

export type Outcome = MatchPrediction["outcome"];

export interface CalendarPickRequest {
  /** matchId — stringified match_no for groups, slot id ("r32_01") for knockouts. */
  readonly matchId: string;
  readonly outcome: Outcome;
  /** "group" or any of the knockout stages. */
  readonly stage: "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";
}

export interface CalendarPicksContextValue {
  /** Current merged bracket — local + server, past-kickoff = server wins. */
  readonly bracket: Bracket;
  /** Apply a pick. The provider handles state + autosave. */
  readonly setPick: (req: CalendarPickRequest) => void;
  /** Recorded match results, by matchId. */
  readonly resultsByMatch: ReadonlyMap<string, ResultedMatch>;
  /**
   * Cascade-resolved team codes by matchId, for knockouts. Falls back
   * to the row's static placeholder (TBD) until enough group picks
   * exist for the slot to resolve.
   */
  readonly cascadeCodes: ReadonlyMap<string, { home?: string; away?: string }>;
  /** Whether the picks have been hydrated from the server yet. */
  readonly hydrated: boolean;
  /**
   * Client clock, in epoch ms. ZERO before mount so the SSR pass
   * renders every row as "future" (no lock state) and the client
   * first paint agrees. After mount, the provider re-renders with
   * the real `Date.now()` and the locked / live / future split
   * applies. Avoids the SSR-vs-client clock-skew hydration error.
   */
  readonly nowMs: number;
}

const NULL: CalendarPicksContextValue = {
  bracket: {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 1,
  } as Bracket,
  setPick: () => {
    /* no-op */
  },
  resultsByMatch: new Map(),
  cascadeCodes: new Map(),
  hydrated: false,
  nowMs: 0,
};

export const CalendarPicksContext =
  createContext<CalendarPicksContextValue>(NULL);

export function useCalendarPicks(): CalendarPicksContextValue {
  return useContext(CalendarPicksContext);
}
