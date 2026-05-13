/**
 * `@tournamental/social-cards` -- share / OG card generator for Tournamental.
 *
 * Entry-point. Pure-TS, framework-free, runs in Node and any modern
 * server runtime that supports `satori` + `@resvg/resvg-js`.
 *
 * Common consumer pattern:
 *
 *   import { generateOG, type CardInput } from "@tournamental/social-cards";
 *
 *   const input: CardInput = {
 *     kind: "goal-clip",
 *     data: {
 *       userHandle: "messi-fan",
 *       userId: "u_01HXP4...",
 *       tournamentName: "World Cup 2026",
 *       matchLabel: "ARG vs FRA — Final",
 *       scorer: "Lionel Messi",
 *       scoreTeam0: 3, scoreTeam1: 2,
 *       team0Code: "ARG", team1Code: "FRA",
 *       minute: 78,
 *       predictedByUser: true,
 *     },
 *   };
 *
 *   const { og, story } = await generateOG(input);
 *   await fs.writeFile("goal-og.png", og.png);
 *   await fs.writeFile("goal-story.png", story.png);
 */

export type {
  CardKind,
  CardInput,
  CommonFooter,
  RenderOptions,
  BracketPredictionInput,
  GoalClipInput,
  MatchResultInput,
  LeaderboardRankInput,
  BadgeEarnedInput,
  ReferralInviteInput,
  TournamentRecapInput,
} from "./types.js";

export { palette, sizes, referralUrl, referralLabel, wordmark } from "./theme.js";
export type { CardSize } from "./theme.js";

export { buildCard } from "./cards/index.js";
export { maybePunditBadge, VERIFIED_PUNDIT_TEXT } from "./cards/pundit-badge.js";

export { renderToSVG, renderToPNG, generateOG } from "./render.js";
export type { RenderRequest, RenderedCard, SVGRenderResult } from "./render.js";

export { loadDefaultFonts, familyForLocale, isRtl } from "./fonts.js";
export type { FontSpec } from "./fonts.js";

// Canvas-rendered champion-centric bracket share card + animated MP4
// generator. Tim's brief 2026-05-11: viral-loop social shares.
// v2 (2026-05-11): adds pyramid silhouette, flags-in-cups + share-guid
// URL with QR code.
export {
  renderBracketShareCard,
  renderViralPodiumCard,
  paintBracketFrame,
  renderQrPng,
  resolveShareUrl,
  loadFlagPng,
  renderPlaceholderFlag,
  defaultFlagsDir,
  CANVAS_SIZES,
  STAGE_LABEL,
  PYRAMID_LAYERS,
  STAGE_TO_LAYER,
  renderMoleculeCaptureCard,
  decodeCaptureDataUrl,
} from "./canvas/index.js";
export type {
  BracketShareCardInput,
  BracketShareChampion,
  BracketShareEliminationTier,
  BracketSharePathEntry,
  BracketShareStage,
  CanvasCardSize,
  CanvasSizePreset,
  PyramidLayer,
  MoleculeCaptureCardInput,
  MoleculeCaptureChampion,
  MoleculeCapturePathEntry,
} from "./canvas/index.js";

export { renderBracketRevealVideo } from "./video/index.js";
export type {
  BracketRevealVideoInput,
  BracketRevealVideoResult,
  VideoFormat,
} from "./video/index.js";
