/**
 * Comparison block: Tournamental vs the household-name bracket games.
 *
 * Surfaces the four differentiators that everyday bracket-prediction users
 * actually feel: lock-in behaviour, in-tournament engagement, 3D
 * watch-along, and the open-source/contributor-revenue posture. The
 * traditional products (Telegraph Predictor, ESPN Bracket Challenge,
 * Yahoo Tournament Pick'em) all lock the bracket at first kickoff and
 * have zero between-match touchpoints. We don't.
 *
 * Rendered as a responsive table on >=768px and as stacked feature cards
 * on small screens (a real comparison table is unreadable on a phone).
 */

import Link from "next/link";

type Row = {
  axis: string;
  competitors: string;
  ours: string;
};

const ROWS: readonly Row[] = [
  {
    axis: "Change picks after first kickoff",
    competitors: "Locked",
    ours: "Yes, until each match kicks off",
  },
  {
    axis: "Daily engagement during the tournament",
    competitors: "None",
    ours: "Daily quizzes, line bets, score-input games",
  },
  {
    axis: "3D match watch-along",
    competitors: "No",
    ours: "Yes, in-browser, no app install",
  },
  {
    axis: "Blockchain-verified prediction receipts",
    competitors: "No",
    ours: "Yes, every pick signed and anchored",
  },
  {
    axis: "Open source",
    competitors: "No",
    ours: "Apache 2.0 from day one",
  },
  {
    axis: "Contributors share platform revenue",
    competitors: "No",
    ours: "Yes, on-chain via Drips Network",
  },
];

export function WhyDifferent() {
  return (
    <div className="wc-compare">
      <p className="wc-compare-intro">
        Telegraph Predictor, ESPN Bracket Challenge, and Yahoo Tournament
        Pick&apos;em all use the same shape: fill out the form before the
        tournament starts, then spectate for four to six weeks. We are
        built the opposite way.
      </p>

      <div className="wc-compare-table-wrap" role="region" aria-label="Tournamental vs household bracket games">
        <table className="wc-compare-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Telegraph / ESPN / Yahoo</th>
              <th scope="col" className="wc-compare-us">Tournamental</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.axis}>
                <th scope="row">{r.axis}</th>
                <td>{r.competitors}</td>
                <td className="wc-compare-us">{r.ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wc-compare-cards" aria-hidden="false">
        {ROWS.map((r) => (
          <div key={r.axis} className="wc-compare-card">
            <h4>{r.axis}</h4>
            <div className="wc-compare-card-row">
              <span className="wc-compare-card-label">Them</span>
              <span className="wc-compare-card-value wc-compare-card-them">{r.competitors}</span>
            </div>
            <div className="wc-compare-card-row">
              <span className="wc-compare-card-label">Us</span>
              <span className="wc-compare-card-value wc-compare-us">{r.ours}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="wc-compare-foot">
        The lock-and-spectate model made sense when a bracket pool lived
        on a paper sheet passed around the office. It does not make
        sense now.{" "}
        <Link href="https://tournamental.com/why">Read the full why →</Link>
      </p>
    </div>
  );
}
