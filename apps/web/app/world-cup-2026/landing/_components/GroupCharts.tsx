/**
 * Per-group "winner probability today" mini-chart. Synthetic data derived
 * from FIFA rank (deterministic, see _lib/groups.ts). Live odds will swap
 * in once docs/29 Polymarket integration ships.
 *
 * Visual: list of teams in the group, each with a horizontal bar and a
 * percentage. Uses kit colour for accent. Pure SSR — no client JS.
 */

import { TeamFlag } from "@/components/bracket/TeamFlag";
import {
  buildGroups,
  syntheticGroupProbabilities,
} from "../_lib/groups";
import { DataPlaceholder } from "./DataPlaceholder";

export function GroupCharts() {
  const groups = buildGroups();
  return (
    <div className="wc-charts-grid">
      {groups.map((g) => {
        const probs = syntheticGroupProbabilities(g);
        return (
          <div className="wc-chart" key={g.id}>
            <h4>
              Group {g.id} <DataPlaceholder>mock</DataPlaceholder>
            </h4>
            {probs.map(({ team, pct }) => (
              <div className="wc-chart-bar" key={team.code}>
                <TeamFlag
                  code={team.code}
                  name={team.name}
                  accentColor={team.kit.primary}
                  size="sm"
                  sparkle={false}
                />
                <div className="wc-chart-track">
                  <div
                    className="wc-chart-fill"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${team.kit.primary}, var(--wc-amber))`,
                    }}
                  />
                </div>
                <span className="wc-chart-pct">{pct}%</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
