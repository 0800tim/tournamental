/**
 * Market page. Surfaces live tournament-winner odds from Polymarket
 * (via the odds-ingest mirror in `apps/odds-ingest/data/`). Useful as
 * marketing fodder — "the market thinks X, our community thinks Y"
 * is the kind of social post that performs.
 *
 * Read-only. The Markets writes happen in apps/odds-ingest.
 */

import { requireAuth } from "@/lib/auth";
import { liveMarketFavourites } from "@/lib/live";
import { gameDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export default async function MarketPage() {
  await requireAuth();
  const favourites = liveMarketFavourites(12) ?? [];
  const gdb = gameDb();
  const totalBrackets = gdb
    ? (gdb.prepare("SELECT COUNT(*) AS c FROM brackets WHERE tournament_id = 'fifa-wc-2026'").get() as { c: number }).c
    : 0;

  const tickTs = favourites[0]?.tick_ts ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Market</h1>
        <p className="text-sm text-ink-200">
          Live Polymarket tournament-winner probabilities, mirrored every
          minute by apps/odds-ingest. Compare against what the Tournamental
          community is actually picking.
        </p>
      </header>

      {favourites.length === 0 ? (
        <div className="rounded-lg ring-1 ring-flame-500/40 bg-flame-500/10 p-4 text-sm">
          Odds DB has no tournament-winner rows. Check that{" "}
          <code className="font-mono">odds-ingest</code> is online (see the{" "}
          System health page) and that{" "}
          <code className="font-mono">SOURCE_POLYMARKET_ENABLED=true</code>.
        </div>
      ) : (
        <>
          <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
            <div className="flex items-end justify-between mb-3">
              <h2 className="text-sm uppercase tracking-wider text-ink-500">
                FIFA WC 2026 favourites (Polymarket)
              </h2>
              <span className="text-xs text-ink-500">
                {tickTs ? `Last tick ${new Date(tickTs).toLocaleString()}` : ""}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-200">
                <tr className="text-left">
                  <th className="text-xs uppercase pb-2">#</th>
                  <th className="text-xs uppercase pb-2">Team</th>
                  <th className="text-xs uppercase pb-2">Implied prob</th>
                  <th className="text-xs uppercase pb-2">Bar</th>
                </tr>
              </thead>
              <tbody>
                {favourites.map((f, idx) => {
                  const top = favourites[0]?.implied_prob ?? f.implied_prob;
                  const widthPct = top > 0 ? (f.implied_prob / top) * 100 : 0;
                  return (
                    <tr key={f.team_code} className="border-t border-ink-700">
                      <td className="py-2 font-mono text-xs text-ink-500">
                        {idx + 1}
                      </td>
                      <td className="py-2 font-mono font-semibold">
                        {f.team_code}
                      </td>
                      <td className="py-2 font-mono text-ink-50">
                        {pct(f.implied_prob)}
                      </td>
                      <td className="py-2">
                        <div className="bg-ink-700 rounded h-2 w-48 overflow-hidden">
                          <div
                            className="bg-accent-500 h-2"
                            style={{ width: `${widthPct.toFixed(1)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-sm text-ink-200">
            <p>
              <strong className="text-ink-50">Community picks vs market.</strong>{" "}
              We have <strong className="text-ink-50">{totalBrackets}</strong>{" "}
              FIFA WC 2026 brackets locked. The per-team consensus pick chart
              needs the bracket engine to cascade each saved bracket to a
              champion; that's wired up in apps/web but not yet imported here.
              Until then this page is "the market view"; the community
              comparison ships in the next iteration.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
