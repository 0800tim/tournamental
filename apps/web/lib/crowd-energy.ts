/**
 * Crowd-energy reactor — pure logic, hookable.
 *
 * The renderer publishes events to a singleton via
 * `crowdEnergyBus.pulse(kind)`. The hook reads the smoothed value
 * via `useCrowdEnergy().value()` and decays it over time.
 *
 * Energy ranges 0 (idle) to 1.0 (frenzied celebration). Different
 * event types push to different target peaks:
 *   - `goal`        → 1.0, decay 3 s
 *   - `tackle`      → 0.35, decay 0.6 s (small ripple)
 *   - `chant`       → 0.6, decay 6 s (sustained)
 *
 * The decay is exponential: `value -= rate * dt`.
 */

export type CrowdPulseKind = "goal" | "tackle" | "chant";

interface PulseSpec {
  peak: number;
  /** Decay-per-second once the peak is reached. */
  decayRate: number;
}

const SPEC: Record<CrowdPulseKind, PulseSpec> = {
  goal: { peak: 1.0, decayRate: 1 / 3 },
  tackle: { peak: 0.35, decayRate: 1 / 0.6 },
  chant: { peak: 0.6, decayRate: 1 / 6 },
};

/**
 * The reactor — testable and singleton-friendly.
 */
export class CrowdEnergyReactor {
  private current = 0;
  private target = 0;
  /**
   * Active decay rate (per-second). Once `current` reaches `target`,
   * we decay back toward zero at this rate.
   */
  private decayRate = 0;
  /** Used to ramp toward target on a pulse. */
  private rampRate = 4; // 1.0 -> ~250 ms

  /** Push a pulse — bumps target up to (but not past) the spec peak. */
  pulse(kind: CrowdPulseKind): void {
    const spec = SPEC[kind];
    if (spec.peak > this.target) this.target = spec.peak;
    // Use the loudest active pulse's decay rate (slowest decay wins
    // when many pulses overlap, so a chant doesn't kill a goal-roar).
    if (this.decayRate === 0 || spec.decayRate < this.decayRate) {
      this.decayRate = spec.decayRate;
    }
  }

  /** Advance the simulation by `dtSec`. */
  tick(dtSec: number): void {
    if (dtSec <= 0) return;
    if (this.current < this.target) {
      this.current = Math.min(
        this.target,
        this.current + this.rampRate * dtSec,
      );
      return;
    }
    // We've hit the target — decay.
    this.target = Math.max(0, this.target - this.decayRate * dtSec);
    this.current = this.target;
    if (this.current === 0) this.decayRate = 0;
  }

  value(): number {
    return this.current;
  }

  reset(): void {
    this.current = 0;
    this.target = 0;
    this.decayRate = 0;
  }
}

/**
 * Module-level singleton bus + hook so any component can pulse the
 * crowd from anywhere (e.g. the Director on goal events) and the
 * `<Crowd>` component can read the smoothed value.
 */
const reactor = new CrowdEnergyReactor();

export const crowdEnergyBus = {
  pulse(kind: CrowdPulseKind) {
    reactor.pulse(kind);
  },
  reset() {
    reactor.reset();
  },
  value(): number {
    return reactor.value();
  },
};

/** Hook used by the renderer. Returns the singleton reactor. */
export function useCrowdEnergy(): CrowdEnergyReactor {
  return reactor;
}
