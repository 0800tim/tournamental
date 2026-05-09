/**
 * Public-facing types for the clip-pipeline service. Kept narrow on purpose —
 * the spec stream's full EventMessage union lives in @vtorn/spec; we only
 * touch the discriminator + minimum fields needed for highlight scoring.
 */

export type ClipFormat = "9:16" | "1:1" | "16:9";

export interface ClipOverlay {
  /** e.g. "ARG 3 - 2 FRA" */
  scoreline?: string;
  /** Player name shown above the scoreline. */
  scorer?: string;
  /** Match minute, free-form (e.g. "108'"). */
  minute?: string;
  /** ISO 639-1 code; defaults to "en". Reserved for future i18n; not yet used. */
  language?: string;
}

export interface ClipRequest {
  match_id: string;
  start_ms: number;
  end_ms: number;
  format: ClipFormat;
  overlay?: ClipOverlay;
  /** Optional source video URL or local fixture path. Required for an actual encode; without it the job will fail. */
  src?: string;
}

export type ClipStatus = "queued" | "rendering" | "done" | "failed";

export interface ClipJob {
  clip_id: string;
  request: ClipRequest;
  status: ClipStatus;
  /** Local on-disk path once the encode finishes. */
  output_path?: string;
  /** Public URL (if CLIP_STORAGE_URL is set), else file:// to output_path. */
  url?: string;
  thumbnail?: string;
  error?: string;
  created_at: number;
  updated_at: number;
}

/**
 * Highlight kinds — the detector tags each merged window with the most
 * important event in that window. Mirrors a subset of @vtorn/spec event types
 * but normalised for the social/clip surface.
 */
export type HighlightKind =
  | "goal"
  | "shot_on_target"
  | "save"
  | "yellow"
  | "red"
  | "penalty"
  | "match_end";

export interface Highlight {
  start_ms: number;
  end_ms: number;
  kind: HighlightKind;
  /** Higher = more important; goals score 10, shots 2, etc. */
  importance: number;
  /** Optional player ID associated with the moment, if known. */
  player?: string;
  /** Optional team ID. */
  team?: string;
}

/**
 * Minimal event shape the highlight detector consumes. The full
 * @vtorn/spec EventMessage is a wider discriminated union, but the detector
 * only needs `t`, `type`, and a few discriminator-specific fields. This
 * lets the detector accept either a real spec stream or a synthetic one
 * without dragging the whole spec types in.
 */
export interface DetectorEvent {
  t: number;
  type: string;
  player?: string;
  team?: string;
  on_target?: boolean;
  saved?: boolean;
  severity?: "soft" | "yellow" | "red";
  restart?:
    | "throw_in"
    | "corner"
    | "goal_kick"
    | "free_kick"
    | "penalty";
  outcome?: "scored" | "missed" | "saved";
}
