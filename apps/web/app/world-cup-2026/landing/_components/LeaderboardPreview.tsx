/**
 * Leaderboard preview — 4 tabs (Global / Country / Friends / Affiliate).
 * Pre-launch all show "Be the first" placeholders. The "what it'll look
 * like" sample uses synthetic names + flags so visitors get a feel for
 * the in-flight UI.
 */

"use client";

import { useState } from "react";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { allTeams } from "../_lib/groups";
import { DataPlaceholder } from "./DataPlaceholder";

type Tab = "global" | "country" | "friends" | "affiliate";

const TABS: { id: Tab; label: string }[] = [
  { id: "global", label: "Global" },
  { id: "country", label: "Country" },
  { id: "friends", label: "Friends" },
  { id: "affiliate", label: "Affiliate cohort" },
];

const SAMPLE_NAMES = [
  "@bracket-king",
  "@office-pizza",
  "@nz-football-mum",
  "@late-locker",
  "@argentina-2026",
];

export function LeaderboardPreview() {
  const [tab, setTab] = useState<Tab>("global");
  const teams = allTeams();

  return (
    <div>
      <div className="wc-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`wc-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wc-leaderboard" data-testid={`wc-leaderboard-${tab}`}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            fontSize: 12,
            color: "var(--wc-text-dim)",
          }}
        >
          <span>What it&apos;ll look like mid-tournament</span>
          <DataPlaceholder>preview</DataPlaceholder>
        </div>
        {SAMPLE_NAMES.map((name, idx) => {
          const team = teams[idx % teams.length];
          return (
            <div className="wc-lb-row" key={name}>
              <span className="wc-lb-rank">{idx + 1}</span>
              <span className="wc-lb-name">
                <TeamFlag
                  code={team.code}
                  name={team.name}
                  accentColor={team.kit.primary}
                  size="sm"
                  sparkle={false}
                />
                {name}
              </span>
              <span className="wc-lb-points">
                {(1240 - idx * 90).toLocaleString()} pts
              </span>
            </div>
          );
        })}
        <div className="wc-lb-empty">
          0 picks locked yet. Be the first on the {tab} board.
        </div>
      </div>
    </div>
  );
}
