/**
 * Public input types for the canvas-rendered bracket share card.
 *
 * The canvas renderer is intentionally separate from the satori card
 * builders in `src/cards/`: it accepts a richer, knockout-path-shaped
 * input that mirrors the @tournamental/bracket-engine cascade output rather
 * than the legacy "list of (round, pick)" tuples. Includes optional
 * runner-up and third-place fields so the card can render the
 * gold-silver-bronze podium next to the champion centrepiece.
 *
 * The output is a PNG buffer ready to send back over HTTP or write to
 * disk. Three size presets are produced by the same render function:
 *
 *  - `portrait`  (1080 × 1350)  — Instagram feed portrait, Facebook
 *                                  feed, generic share-sheet preview.
 *  - `landscape` (1200 × 630)   — Twitter / X / Facebook OpenGraph,
 *                                  LinkedIn / Telegram link unfurl.
 *  - `square`    (1080 × 1080)  — Instagram square post / carousel,
 *                                  Slack / WhatsApp link unfurl.
 *
 * The 9:16 (1080 × 1920) "story" format is produced by the *video*
 * pipeline, per the docs/14 split: static stories are dead, animated
 * stories convert. See `../video/bracket-reveal.ts`.
 */

export type CanvasCardSize = "portrait" | "landscape" | "square";

export interface CanvasSizePreset {
  readonly size: CanvasCardSize;
  readonly width: number;
  readonly height: number;
}

export const CANVAS_SIZES: Readonly<Record<CanvasCardSize, CanvasSizePreset>> = {
  portrait: { size: "portrait", width: 1080, height: 1350 },
  landscape: { size: "landscape", width: 1200, height: 630 },
  square: { size: "square", width: 1080, height: 1080 },
} as const;

/** Stage label used by the knockout-path strip beneath the champion. */
export type BracketShareStage = "r16" | "qf" | "sf" | "tp" | "final";

export const STAGE_LABEL: Readonly<Record<BracketShareStage, string>> = {
  r16: "R16",
  qf: "QF",
  sf: "SF",
  tp: "3rd",
  final: "Final",
} as const;

/**
 * The seven pyramid layers the v2 share card draws (matches the 3D
 * molecule v4 schema in `apps/web/lib/molecule/layout.ts`).
 *
 * The card's vertical axis maps:
 *   - group    → base (Y 0%)     widest ring, 32px atoms
 *   - r32      → 17%               16 atoms wide
 *   - r16      → 33%               8 atoms wide
 *   - qf       → 50%               4 atoms wide
 *   - sf       → 67%               3 atoms wide
 *   - final    → 83%               2 atoms wide
 *   - champion → apex (Y 100%)    1 atom (the crown jewel)
 */
export type PyramidLayer = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion";

export const PYRAMID_LAYERS: ReadonlyArray<PyramidLayer> = [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "final",
  "champion",
] as const;

/**
 * Map a knockout-path stage onto a pyramid layer. The 3rd-place playoff
 * (`tp`) is dropped because the molecule pyramid has no slot for it —
 * tp does not advance anyone.
 */
export const STAGE_TO_LAYER: Readonly<Record<BracketShareStage, PyramidLayer | null>> = {
  r16: "r16",
  qf: "qf",
  sf: "sf",
  final: "final",
  tp: null,
} as const;

export interface BracketSharePathEntry {
  readonly stage: BracketShareStage;
  readonly teamCode: string;
  readonly teamName: string;
}

export interface BracketShareChampion {
  readonly code: string;
  readonly name: string;
  readonly kit?: { readonly primary?: string | null } | null;
}

/**
 * Context atoms scattered along the pyramid's base ring + lower tiers.
 * `stage` is the *layer* where the team is drawn (its elimination tier);
 * `teamCodes` is the list of 3-letter codes to scatter at that layer.
 *
 * Only the layers `group` / `r32` / `r16` / `qf` / `sf` are honoured by
 * the renderer — `final` and `champion` are reserved for the user's
 * champion column.
 *
 * If omitted, the renderer draws only the champion's column.
 */
export interface BracketShareEliminationTier {
  readonly stage: Extract<PyramidLayer, "group" | "r32" | "r16" | "qf" | "sf">;
  readonly teamCodes: ReadonlyArray<string>;
}

export interface BracketShareCardInput {
  readonly user: {
    readonly handle: string;
    readonly displayName?: string | null;
  };
  readonly champion: BracketShareChampion;
  /** Optional runner-up (silver) — the team the user picked to lose the final. */
  readonly runnerUp?: BracketShareChampion | null;
  /** Optional third-place (bronze) — winner of the user's predicted 3rd-place playoff. */
  readonly thirdPlace?: BracketShareChampion | null;
  readonly knockoutPath: ReadonlyArray<BracketSharePathEntry>;
  readonly tournamentName: string;
  readonly pundit?: { readonly level: number } | null;
  readonly size?: CanvasCardSize;
  /**
   * Optional override for where flag SVGs live on disk. Defaults to
   * `apps/web/public/flags` resolved relative to the monorepo root.
   * Tests pass a fixture directory; production passes the prod path.
   */
  readonly flagsDir?: string;
  /** Optional override for the "view it" footer URL. */
  readonly footerUrl?: string;
  /**
   * Optional share GUID — when set, the footer URL is rendered as
   * `play.tournamental.com/s/<shareGuid>` and the QR code encodes the
   * same. Wins over `footerUrl` when both are present.
   */
  readonly shareGuid?: string | null;
  /**
   * Optional context atoms for the pyramid silhouette — the teams the
   * user predicted to be eliminated at each non-path stage. Drawn as
   * dim flag discs on their elimination tier so the pyramid has visual
   * weight beyond the champion column.
   */
  readonly allEliminatedByStage?: ReadonlyArray<BracketShareEliminationTier>;
  /**
   * Optional absolute URL or path-relative URL to the user's avatar.
   * The v3 viral podium card composites this top-left as a circular
   * crop next to the handle. Older renderers ignore the field. Falls
   * back to a silhouette if the fetch fails or the URL is missing.
   */
  readonly avatarUrl?: string | null;
  /**
   * Renderer variant selector. Defaults to `"v2-pyramid"` (the existing
   * pyramid + podium card). `"v3-podium"` selects the viral redesign:
   * big 3-flag podium, avatar + handle, champion-kit gradient, no
   * pyramid silhouette.
   */
  readonly style?: "v2-pyramid" | "v3-podium";
}
