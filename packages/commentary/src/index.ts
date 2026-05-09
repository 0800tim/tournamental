/**
 * @vtorn/commentary — match commentary text generation + TTS scheduling.
 *
 * Two layers:
 *   1) `generateCommentary(event, ctx)` — pure function from spec event +
 *      lookup context to one or more lines of commentary text. Deterministic.
 *   2) `CommentaryScheduler` — consumes the live message stream and decides
 *      WHEN to play WHICH lines, with cooldowns and contention rules so the
 *      voice doesn't talk over itself during scrambles.
 *
 * Audio is the renderer's concern. It picks a backend:
 *   - browser SpeechSynthesis (zero cost, default)
 *   - ElevenLabs via apps/api/src/routes/commentary (paid, premium voices)
 * and plays the URI returned by `scheduler.next()`.
 */

export {
  generateCommentary,
  type CommentaryContext,
  type CommentaryLine,
} from "./templates.js";

export {
  CommentaryScheduler,
  type SchedulerOptions,
  type ScheduledLine,
} from "./scheduler.js";

export { __version } from "./version.js";
