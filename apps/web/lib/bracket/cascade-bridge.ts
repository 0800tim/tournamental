/**
 * Cascade bridge. The conversion from the per-match `Bracket` to the
 * cascade's `BracketPrediction` now lives in `@tournamental/bracket-engine`
 * (`bridge.ts`) so the browser and the game service share one helper;
 * this module keeps the import path the nine callers use.
 */

export { bracketToCascadeInput } from "@tournamental/bracket-engine";
