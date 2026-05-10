/**
 * Animated share-video pipeline. Currently a single producer:
 *
 *   - `bracket-reveal.ts` — 6-second MP4 of the user's bracket pick.
 *
 * Follow-ups (tracked in IDEAS.md): per-match reveal, golden-goal
 * highlight, "I called it" prediction-correct burst.
 */

export {
  renderBracketRevealVideo,
} from "./bracket-reveal.js";

export type {
  BracketRevealVideoInput,
  BracketRevealVideoResult,
  VideoFormat,
} from "./bracket-reveal.js";
