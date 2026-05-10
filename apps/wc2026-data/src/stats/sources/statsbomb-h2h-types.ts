/**
 * Type-only sub-module for the StatsBomb local-corpus source. Keeps the
 * cyclic-import boundary clean (the main `statsbomb-h2h.ts` file
 * implements `H2HSourceLocal`; both export the same `H2HMeeting`
 * shape from `../types.ts`).
 */

import type { H2HMeeting } from "../types.js";

export type { H2HMeeting };

export interface H2HSourceLocal {
  /** Synchronous: the corpus is loaded once at construction. */
  fetchH2H(aCode: string, bCode: string): readonly H2HMeeting[];
}
