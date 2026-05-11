/**
 * Overlay system shared types.
 *
 * The overlay router lives entirely in the URL: any deep-link to a page
 * with `?overlay=<kind>[,<kind>...]&<param>=<value>...` rehydrates the
 * stack on cold load, and any push/pop replays through `history.pushState`
 * so the back button unwinds it before navigating away from the page.
 *
 * Each overlay is identified by a stable `kind` plus a flat `params` bag.
 * Kinds are an extensible string-literal union, additional overlay
 * kinds can be added by builder agents without touching the router core,
 * so long as a `<kind>Overlay>` component is registered in the registry.
 */

/**
 * Known overlay kinds. Add new kinds here AND register a renderer in
 * `OverlayRegistry.tsx` to surface them. Unknown kinds are ignored at
 * runtime (with a console warning) to keep cold-load deep-links robust
 * against URL drift.
 */
export type OverlayKind =
  | "team"
  | "match"
  | "leaderboard-entry";

/** A single frame on the overlay stack. */
export interface OverlayFrame {
  readonly kind: OverlayKind;
  /**
   * Flat key→string params bag. Numeric / boolean params should be
   * encoded as strings; the consumer parses them. URL-safe, must
   * survive `encodeURIComponent` round-trip.
   */
  readonly params: Readonly<Record<string, string>>;
}

/** Public Overlay API, what `useOverlay()` returns. */
export interface OverlayApi {
  /** Stack snapshot, top-of-stack last. */
  readonly stack: readonly OverlayFrame[];
  /** Push a new overlay onto the stack and update the URL. */
  open(kind: OverlayKind, params?: Record<string, string>): void;
  /** Pop the top overlay (no-op if stack empty). */
  close(): void;
  /** Pop everything. */
  closeAll(): void;
  /** Replace the top overlay with a new one (history is replaced, not pushed). */
  replace(kind: OverlayKind, params?: Record<string, string>): void;
}
