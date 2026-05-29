/**
 * The three-step explainer: predict, save early, watch the world react.
 *
 * Tim 2026-05-29: dropped the early-save multiplier story (and the
 * 5.0×→1.0× decay bars). Scoring is now pure count-of-correct: one
 * point per right call, no time bonus, no multiplier. Step 2 is now
 * just "save early so you don't forget; you can change picks any time
 * before kickoff."
 */

import Link from "next/link";

export function HowItWorks() {
  return (
    <div className="wc-steps">
      <div className="wc-step" data-step="1">
        <h3>Predict every match.</h3>
        <p>
          Win, draw, or lose for all 72 group games; winner for every
          knockout match through the final. Reorder your group standings
          and your knockout bracket cascades downstream automatically.{" "}
          <Link href="/world-cup-2026">Open the bracket builder →</Link>
        </p>
      </div>

      <div className="wc-step" data-step="2">
        <h3>Save early. Change any time.</h3>
        <p>
          Unlike Telegraph, ESPN or Yahoo bracket games, nothing locks
          at first kickoff. You can change any pick until that specific
          match kicks off. Save early so you don&apos;t forget, then
          tweak match-by-match as form and team news shift.
        </p>
      </div>

      <div className="wc-step" data-step="3">
        <h3>One point per correct pick.</h3>
        <p>
          Group-stage win/lose/draw scores a point; knockout-stage
          winner scores a point. That&apos;s it. If you call 16 of the
          first 18 right and nobody&apos;s on 18, you sit equal-first on
          the leaderboard. Simple, transparent, and very hard to top.
        </p>
      </div>
    </div>
  );
}
