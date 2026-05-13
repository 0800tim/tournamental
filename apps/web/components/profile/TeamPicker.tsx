"use client";

/**
 * Favourite-team picker: a responsive grid of all 48 WC 2026 flags
 * ordered by world rank, with the 3-letter code overlaid. Tapping a
 * flag selects it; the parent saves on the next Save click.
 *
 * Why a grid rather than a dropdown: international teams have
 * recognisable flags; a flag grid recognises faster than a list of
 * 48 names, especially for non-English-speaking users.
 *
 * Why world-rank order: power-law of football fan preferences — top-10
 * teams account for the majority of "favourite" picks. Putting them
 * first means one tap for most users.
 */

import { useMemo, useState } from "react";

import { TEAMS, type Team, flagPath } from "@/lib/profile/teams";

export interface TeamPickerProps {
  /** Currently selected team code. Empty string / null = none. */
  readonly value: string | null;
  /** Called when the user taps a flag. Pass null to clear. */
  readonly onChange: (code: string | null) => void;
  /** Optional max grid height; the grid scrolls internally past it. */
  readonly maxHeight?: number;
}

export function TeamPicker({ value, onChange, maxHeight = 320 }: TeamPickerProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return TEAMS;
    return TEAMS.filter(
      (t) =>
        t.code.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q),
    );
  }, [filter]);

  // Pin the selected team at the top of the grid so it's always
  // visible even after a search filter. Visual reinforcement of
  // "you've picked this one".
  const ordered = useMemo(() => {
    if (!value) return filtered;
    const selected = filtered.find((t) => t.code === value);
    if (!selected) return filtered;
    return [selected, ...filtered.filter((t) => t.code !== value)];
  }, [filtered, value]);

  return (
    <div className="vt-team-picker">
      <div className="vt-team-picker-head">
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          placeholder="Filter teams…"
          className="auth-input vt-team-picker-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="vt-team-picker-clear"
            onClick={() => onChange(null)}
            aria-label="Clear favourite team"
          >
            Clear
          </button>
        )}
      </div>
      <div
        className="vt-team-picker-grid"
        style={{ maxHeight }}
        role="radiogroup"
        aria-label="Favourite team"
      >
        {ordered.map((t) => (
          <TeamTile
            key={t.code}
            team={t}
            selected={t.code === value}
            onPick={() => onChange(t.code)}
          />
        ))}
        {ordered.length === 0 && (
          <p className="vt-team-picker-empty">No teams match.</p>
        )}
      </div>
    </div>
  );
}

interface TeamTileProps {
  readonly team: Team;
  readonly selected: boolean;
  readonly onPick: () => void;
}

function TeamTile({ team, selected, onPick }: TeamTileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${team.name} (${team.code})`}
      data-selected={selected ? "1" : "0"}
      className="vt-team-tile"
      onClick={onPick}
      title={`${team.name} · world rank ${team.fifaRank}`}
    >
      <img
        src={flagPath(team.code)}
        alt=""
        className="vt-team-flag"
        loading="lazy"
        width={64}
        height={42}
      />
      <span className="vt-team-code">{team.code}</span>
    </button>
  );
}
