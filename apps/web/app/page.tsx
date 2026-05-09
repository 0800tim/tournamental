import Link from "next/link";

const DEMO_MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

export default function LandingPage() {
  return (
    <main className="landing">
      <div>
        <h1>VTourn</h1>
        <p>
          The 3D match watch-along, prediction game, and verified-receipt protocol.
          Coming soon. The renderer is open source under Apache 2.0.
        </p>
        <Link className="landing-cta" href={`/match/${DEMO_MATCH_ID}`}>
          Watch the demo (AR-FR 2022)
        </Link>
      </div>
    </main>
  );
}
