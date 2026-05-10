/**
 * /leaderboard — top-100 prediction-IQ leaderboard.
 * Mock data for v0.1; the verified-pundit and humanness-score
 * integrations land in adjacent PRs.
 */

"use client";

import { useState } from "react";

import { AppShell, PillTabs } from "@/components/shell";

import "./leaderboard.css";

export default function LeaderboardPage() {
  const [tab, setTab] = useState<"global" | "friends" | "country">("global");
  return (
    <AppShell
      title="Leaderboard"
      subHeader={
        <PillTabs
          ariaLabel="Leaderboard scope"
          tabs={[
            { id: "global", label: "Global" },
            { id: "friends", label: "Friends" },
            { id: "country", label: "Country" },
          ]}
          active={tab}
          onChange={(id) => setTab(id as typeof tab)}
        />
      }
    >
      <div className="vt-page-content">
        <ol className="vt-leaderboard-list">
          {MOCK_ROWS.map((row, idx) => (
            <li
              key={row.handle}
              className="vt-leaderboard-row"
              data-active={row.handle === "you-nz" ? "1" : undefined}
            >
              <span className="vt-lb-rank">{idx + 1}</span>
              <span className="vt-lb-avatar" aria-hidden="true">
                {row.handle.slice(0, 2).toUpperCase()}
              </span>
              <span className="vt-lb-handle">@{row.handle}</span>
              <span className="vt-lb-points">{row.points.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}

const MOCK_ROWS = [
  { handle: "bracket-king", points: 3450 },
  { handle: "argentina-2026", points: 3440 },
  { handle: "office-pizza", points: 3210 },
  { handle: "lazy-pundit", points: 2980 },
  { handle: "you-nz", points: 2210 },
  { handle: "deep-state", points: 2010 },
];
