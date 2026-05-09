"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";

/**
 * Placeholder hook for the historic-odds HUD widget (sister issue, owner
 * TBD). When `public/data/wc2022-final-odds.json` is present this widget
 * shows the AR-FR Dec 2022 decimal odds at kickoff and after each goal.
 * If the file is absent it renders nothing — so this PR doesn't need to
 * ship odds data. Another PR will close that issue and add the JSON.
 *
 * Schema we expect (forward-compat — owner can change before the data
 * lands):
 *
 *   {
 *     "kickoff": { "home": 2.30, "draw": 3.10, "away": 3.50 },
 *     "after_goals": [
 *       { "home_score": 1, "away_score": 0, "odds": { "home": 1.50, ... } },
 *       ...
 *     ]
 *   }
 */
interface OddsSnapshot {
  home: number;
  draw: number;
  away: number;
}
interface OddsFile {
  kickoff?: OddsSnapshot;
  after_goals?: Array<{ home_score: number; away_score: number; odds: OddsSnapshot }>;
}

interface OddsHUDProps {
  store: StoreApi<MatchStore>;
}

export function OddsHUD({ store }: OddsHUDProps) {
  const score = useStore(store, (s) => s.score);
  const init = useStore(store, (s) => s.init);
  const [data, setData] = useState<OddsFile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/wc2022-final-odds.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((json: OddsFile) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing || !data || !init) return null;

  const snapshot = pickSnapshot(data, score.home, score.away);
  if (!snapshot) return null;

  return (
    <div className="odds-hud" data-testid="odds-hud">
      <div className="odds-hud-label">Live odds</div>
      <div className="odds-hud-row">
        <span>{init.teams[0].short_name ?? "Home"}</span>
        <span>{snapshot.home.toFixed(2)}</span>
      </div>
      <div className="odds-hud-row">
        <span>Draw</span>
        <span>{snapshot.draw.toFixed(2)}</span>
      </div>
      <div className="odds-hud-row">
        <span>{init.teams[1].short_name ?? "Away"}</span>
        <span>{snapshot.away.toFixed(2)}</span>
      </div>
    </div>
  );
}

function pickSnapshot(data: OddsFile, home: number, away: number): OddsSnapshot | null {
  if (data.after_goals && (home > 0 || away > 0)) {
    // Pick the latest snapshot whose score has been reached.
    const candidates = data.after_goals.filter(
      (snap) => snap.home_score <= home && snap.away_score <= away,
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.home_score + b.away_score - (a.home_score + a.away_score));
      return candidates[0].odds;
    }
  }
  return data.kickoff ?? null;
}
