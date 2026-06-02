"use client";

/**
 * Favourite-team picker.
 *
 * Default state is a single compact pill: selected team's flag + name
 * + chevron, or "Pick your favourite team" when nothing's chosen.
 * Tapping the pill opens a modal with the full 48-team grid (search,
 * world-rank order, selected-first pin). Tim 2026-06-02: the previous
 * always-open grid took up the bulk of the profile page; a closed
 * dropdown is far more compact and still gives the grid affordance
 * when the user actively wants to change.
 *
 * Why a flag grid (when the modal opens) rather than a dropdown list:
 * international teams have recognisable flags; a flag grid recognises
 * faster than a list of 48 names, especially for non-English-speaking
 * users.
 *
 * Why world-rank order: power-law of football fan preferences — top-10
 * teams account for the majority of "favourite" picks. Putting them
 * first means one tap for most users.
 */

import { useEffect, useMemo, useState } from "react";

import { TEAMS, type Team, flagPath } from "@/lib/profile/teams";

export interface TeamPickerProps {
  /** Currently selected team code. Empty string / null = none. */
  readonly value: string | null;
  /** Called when the user taps a flag. Pass null to clear. */
  readonly onChange: (code: string | null) => void;
  /** Optional max grid height in the modal; grid scrolls past it. */
  readonly maxHeight?: number;
}

export function TeamPicker({ value, onChange, maxHeight = 480 }: TeamPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedTeam = useMemo(
    () => (value ? TEAMS.find((t) => t.code === value) ?? null : null),
    [value],
  );

  // Close the modal on Escape and lock the body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const handlePick = (code: string | null): void => {
    onChange(code);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="vt-team-picker-pill"
        data-empty={selectedTeam ? undefined : "1"}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          selectedTeam
            ? `Favourite team: ${selectedTeam.name}. Tap to change.`
            : "Pick your favourite team"
        }
      >
        {selectedTeam ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="vt-team-picker-pill-flag"
              src={flagPath(selectedTeam.code)}
              alt=""
              width={32}
              height={22}
            />
            <span className="vt-team-picker-pill-name">{selectedTeam.name}</span>
            <span className="vt-team-picker-pill-code">{selectedTeam.code}</span>
          </>
        ) : (
          <span className="vt-team-picker-pill-placeholder">
            Pick your favourite team
          </span>
        )}
        <span className="vt-team-picker-pill-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <TeamPickerModal
          value={value}
          onPick={handlePick}
          onClose={() => setOpen(false)}
          maxHeight={maxHeight}
        />
      )}
    </>
  );
}

interface TeamPickerModalProps {
  readonly value: string | null;
  readonly onPick: (code: string | null) => void;
  readonly onClose: () => void;
  readonly maxHeight: number;
}

function TeamPickerModal({ value, onPick, onClose, maxHeight }: TeamPickerModalProps): JSX.Element {
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

  // Pin the currently selected team at the top of the grid so it's
  // always immediately visible (even after a search filter).
  const ordered = useMemo(() => {
    if (!value) return filtered;
    const selected = filtered.find((t) => t.code === value);
    if (!selected) return filtered;
    return [selected, ...filtered.filter((t) => t.code !== value)];
  }, [filtered, value]);

  return (
    <div
      className="vt-team-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Pick your favourite team"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vt-team-picker-modal">
        <header className="vt-team-picker-modal-head">
          <h3 className="vt-team-picker-modal-title">Pick your favourite team</h3>
          <button
            type="button"
            className="vt-team-picker-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="vt-team-picker-head">
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            placeholder="Filter teams…"
            className="auth-input vt-team-picker-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {value && (
            <button
              type="button"
              className="vt-team-picker-clear"
              onClick={() => onPick(null)}
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
              onPick={() => onPick(t.code)}
            />
          ))}
          {ordered.length === 0 && (
            <p className="vt-team-picker-empty">No teams match.</p>
          )}
        </div>
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
