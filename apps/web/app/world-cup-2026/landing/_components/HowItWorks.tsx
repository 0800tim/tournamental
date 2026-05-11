/**
 * The three-step explainer: predict, save early, watch the world react.
 * Step 2 has a tiny inline bar chart showing the early-save multiplier
 * decay (5.0× -> 1.0×). Pure SVG; no JS animation.
 */

import Link from "next/link";

const DECAY: readonly number[] = [5.0, 4.2, 3.4, 2.7, 2.1, 1.6, 1.3, 1.1, 1.0];
const DECAY_MAX = 5.0;

export function HowItWorks() {
  return (
    <div className="wc-steps">
      <div className="wc-step" data-step="1">
        <h3>Predict every match.</h3>
        <p>
          Win, draw, or lose for all 104 games, group stage to final.
          Reorder your group standings and your knockout bracket cascades
          downstream automatically.{" "}
          <Link href="/world-cup-2026">Open the bracket builder →</Link>
        </p>
      </div>

      <div className="wc-step" data-step="2">
        <h3>Save early.</h3>
        <p>
          Tweak picks game by game right up to kickoff. The earlier you save
          a long-shot, the bigger the multiplier when it pays off, wait
          until kickoff and you score flat. Every save resets the multiplier
          clock, so changing your mind costs you a little of that early
          conviction bonus.
        </p>
        <div className="wc-step-decay" aria-label="Early-save multiplier decay 5x to 1x">
          {DECAY.map((m, i) => (
            <span
              key={i}
              className="wc-step-decay-bar"
              style={{ height: `${(m / DECAY_MAX) * 100}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
        <p style={{ marginTop: 6, fontSize: 11 }}>
          5.0× today &nbsp;&middot;&nbsp; 1.0× by kickoff.
        </p>
      </div>

      <div className="wc-step" data-step="3">
        <h3>Watch the world react.</h3>
        <p>
          Every Polymarket tick streams into the app. Compare your saved
          picks against global consensus, pile-on early underdog stories,
          and watch your country&apos;s leaderboard climb in real time.
        </p>
      </div>
    </div>
  );
}
