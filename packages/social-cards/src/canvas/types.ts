/**
 * Public input types for the canvas-rendered bracket share card.
 *
 * The canvas renderer is intentionally separate from the satori card
 * builders in `src/cards/`: it accepts a richer, knockout-path-shaped
 * input that mirrors the @vtorn/bracket-engine cascade output rather
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
}
