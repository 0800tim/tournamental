/**
 * 12 group cards (A-L), 4 teams each. Click a team -> opens a detail
 * drawer with the team's first 3 fixtures + a Polymarket placeholder.
 */

"use client";

import { useState, useCallback, useEffect } from "react";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import {
  buildGroups,
  firstFixturesForTeam,
  type Team,
  type Fixture,
} from "../_lib/groups";
import { DataPlaceholder } from "./DataPlaceholder";

interface DrawerState {
  readonly team: Team;
  readonly groupId: string;
  readonly fixtures: readonly Fixture[];
}

export function TeamGroupGrid() {
  const groups = buildGroups();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const open = useCallback((team: Team, groupId: string) => {
    setDrawer({
      team,
      groupId,
      fixtures: firstFixturesForTeam(team.code, 3),
    });
  }, []);

  const close = useCallback(() => setDrawer(null), []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, close]);

  return (
    <>
      <div className="wc-groups-grid" data-testid="wc-groups-grid">
        {groups.map((g) => (
          <div className="wc-group-card" key={g.id}>
            <h4>Group {g.id}</h4>
            <ul>
              {g.teams.map((t) => (
                <li key={t.code}>
                  <button
                    type="button"
                    className="wc-team-row"
                    onClick={() => open(t, g.id)}
                    data-testid={`wc-team-${t.code}`}
                    aria-label={`Open ${t.name} detail (Group ${g.id})`}
                  >
                    <TeamFlag
                      code={t.code}
                      name={t.name}
                      accentColor={t.kit.primary}
                      size="md"
                    />
                    <span className="wc-team-name">{t.name}</span>
                    <span className="wc-team-rank">FIFA #{t.fifa_ranking_at_2026}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {drawer && (
        <div
          className="wc-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${drawer.team.name} detail`}
          onClick={close}
        >
          <div
            className="wc-drawer"
            onClick={(e) => e.stopPropagation()}
            data-testid="wc-team-drawer"
          >
            <button
              className="wc-drawer-close"
              type="button"
              aria-label="Close team detail"
              onClick={close}
            >
              ×
            </button>
            <h3>
              <TeamFlag
                code={drawer.team.code}
                name={drawer.team.name}
                accentColor={drawer.team.kit.primary}
                size="lg"
              />
              {drawer.team.name}
            </h3>
            <div className="wc-drawer-meta">
              Group {drawer.groupId} &middot; FIFA #{drawer.team.fifa_ranking_at_2026}
              {" "}
              &middot; {drawer.team.confederation}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--wc-text-dim)" }}>
                Tournament-winner odds:
              </span>
              <DataPlaceholder>—</DataPlaceholder>
              <span style={{ fontSize: 11, color: "var(--wc-text-dim)" }}>
                live via Polymarket (coming soon)
              </span>
            </div>
            <h4 style={{ margin: "16px 0 4px", fontSize: 13, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--wc-amber)" }}>
              First fixtures
            </h4>
            <ul className="wc-drawer-fixtures">
              {drawer.fixtures.map((f) => {
                const opponent =
                  f.home_team_slot === drawer.team.code
                    ? f.away_team_slot
                    : f.home_team_slot;
                const home = f.home_team_slot === drawer.team.code;
                const date = new Date(f.kickoff_utc);
                return (
                  <li key={f.match_number}>
                    <span className="wc-fixture-time">
                      {date.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span>
                      {home ? "vs" : "at"} <strong>{opponent}</strong>
                    </span>
                    <span className="wc-fixture-time">
                      {date.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
