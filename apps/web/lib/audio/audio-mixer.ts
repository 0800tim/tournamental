/**
 * Audio mixer — pure logic, testable in jsdom.
 *
 * Owns the gain curves for the commentary track. The renderer's
 * `<CommentaryAudio />` component reads `commentaryGain()` once per
 * frame and writes it into the `GainNode`.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md` § "Mixer":
 *
 *   - Duck commentary by -8 dB during crowd-roar moments (goal scored).
 *   - Boost commentary by +4 dB at half time / pre-match.
 *   - Crossfade on scrub: 100 ms.
 *
 * The Director's `cutAtMs()` hook (Phase-2) tells us when a goal
 * sequence starts. Phase-3 wiring: when the Director reports a
 * `goal-replay` cut, we duck commentary; when it returns to
 * `broadcast`, we ramp back to nominal.
 */

export type MixState =
  | "nominal"
  | "ducked-goal"
  | "boosted-half-time"
  | "scrub-fade";

export interface MixerOpts {
  /** Provider for "now" in ms. Default: `performance.now()`. */
  now?: () => number;
  /** Crossfade duration on scrub (ms). Default 100. */
  scrubFadeMs?: number;
  /** Default gain ramp duration on state change (ms). Default 250. */
  rampMs?: number;
}

const DUCK_DB = -8;
const BOOST_DB = 4;
/** Convert dB → linear gain. */
function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

interface Ramp {
  startMs: number;
  endMs: number;
  fromGain: number;
  toGain: number;
}

export class AudioMixer {
  private now: () => number;
  private scrubFadeMs: number;
  private rampMs: number;
  private currentGain = 1;
  private targetGain = 1;
  private ramp: Ramp | null = null;
  private state: MixState = "nominal";

  constructor(opts: MixerOpts = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.scrubFadeMs = opts.scrubFadeMs ?? 100;
    this.rampMs = opts.rampMs ?? 250;
  }

  getState(): MixState {
    return this.state;
  }

  /**
   * Tell the mixer the director cut to a goal-replay. Commentary
   * should duck so the crowd roar is foregrounded.
   */
  duckForGoal(): void {
    if (this.state === "ducked-goal") return;
    this.state = "ducked-goal";
    this.beginRamp(dbToGain(DUCK_DB), this.rampMs);
  }

  /** Boost commentary by +4 dB at half-time / pre-match. */
  boostForHalfTime(): void {
    if (this.state === "boosted-half-time") return;
    this.state = "boosted-half-time";
    this.beginRamp(dbToGain(BOOST_DB), this.rampMs);
  }

  /** Return to nominal gain after a duck/boost finishes. */
  returnToNominal(): void {
    if (this.state === "nominal") return;
    this.state = "nominal";
    this.beginRamp(1, this.rampMs);
  }

  /**
   * Trigger a 100ms crossfade, e.g. when the user scrubs the timeline
   * — we want a quick fade-out on the old commentary line and a
   * fade-in on the new one.
   */
  scrub(): void {
    this.state = "scrub-fade";
    // Drop to silent over scrubFadeMs/2, then ramp back to nominal.
    this.beginRamp(0, this.scrubFadeMs / 2);
    // Schedule the second leg.
    const leg2Start = this.now() + this.scrubFadeMs / 2;
    setTimeout(() => {
      this.state = "nominal";
      this.beginRamp(1, this.scrubFadeMs / 2, leg2Start);
    }, this.scrubFadeMs / 2);
  }

  private beginRamp(toGain: number, durMs: number, startMsOverride?: number): void {
    const start = startMsOverride ?? this.now();
    this.ramp = {
      startMs: start,
      endMs: start + durMs,
      fromGain: this.currentGain,
      toGain,
    };
    this.targetGain = toGain;
  }

  /**
   * Compute the current gain. Pure — call this once per frame from
   * the audio component to write to the actual `GainNode`.
   */
  commentaryGain(): number {
    const r = this.ramp;
    if (!r) return this.currentGain;
    const t = this.now();
    if (t >= r.endMs) {
      this.currentGain = r.toGain;
      this.ramp = null;
      return this.currentGain;
    }
    const a = (t - r.startMs) / (r.endMs - r.startMs);
    // Cosine ease (smoothstep would be fine too).
    const eased = 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, a)) * Math.PI);
    this.currentGain = r.fromGain + (r.toGain - r.fromGain) * eased;
    return this.currentGain;
  }

  /** For tests. */
  getTargetGain(): number {
    return this.targetGain;
  }
}

/**
 * Helper: dB → linear gain.
 */
export const dB = dbToGain;
