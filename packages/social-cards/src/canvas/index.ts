/**
 * Canvas-rendered share cards.
 *
 * The `satori`-based card builders in `../cards/` produce OG and story
 * images for every card kind (goal-clip, leaderboard, badge, etc.).
 *
 * This canvas pipeline is purpose-built for one job: a champion-centric
 * bracket share PNG in three social aspect ratios (portrait, landscape,
 * square), driven by team flag rasters with a kit-coloured radial glow.
 * Bricks for the 6-second animated MP4 (`../video/bracket-reveal.ts`)
 * live here too — the video pipeline calls `paintBracketFrame` once
 * per frame with a varying progress value.
 */

export {
  renderBracketShareCard,
  paintBracketFrame,
  renderQrPng,
  resolveShareUrl,
} from "./bracket-share-card.js";

export {
  renderMoleculeCaptureCard,
  decodeCaptureDataUrl,
} from "./molecule-capture-card.js";
export type {
  MoleculeCaptureCardInput,
  MoleculeCaptureChampion,
  MoleculeCapturePathEntry,
} from "./molecule-capture-card.js";

export {
  loadFlagPng,
  renderPlaceholderFlag,
  defaultFlagsDir,
  _resetFlagCache,
} from "./flags.js";

export {
  CANVAS_SIZES,
  STAGE_LABEL,
  PYRAMID_LAYERS,
  STAGE_TO_LAYER,
} from "./types.js";

export type {
  BracketShareCardInput,
  BracketShareChampion,
  BracketShareEliminationTier,
  BracketSharePathEntry,
  BracketShareStage,
  CanvasCardSize,
  CanvasSizePreset,
  PyramidLayer,
} from "./types.js";
