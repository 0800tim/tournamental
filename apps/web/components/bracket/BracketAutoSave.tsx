"use client";

/**
 * Floating save + autosave UX for the bracket page.
 *
 * Three states it renders:
 *
 *   "dirty"  - gold pill labelled "Save". The user has pending picks
 *              that haven't reached the server yet. Click to save now.
 *              Also shows while the 30s autosave timer is counting down.
 *   "saving" - same pill, disabled, label "Saving...".
 *   "saved"  - green pill labelled "Saved ✓". Fades out after ~3s.
 *
 * When the bracket is clean and not freshly saved, the component
 * renders nothing so the corner is empty.
 *
 * The interval / dirty-detect logic lives in BracketBuilder; this
 * component is presentational and just exposes a click handler.
 *
 * Tim 2026-06-05: brackets weren't saving when users navigated away
 * because the only persist trigger was the explicit Save button at
 * the end. This is the safety net.
 */

import "./bracket-autosave.css";

export type AutoSaveUiState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface BracketAutoSaveProps {
  readonly state: AutoSaveUiState;
  readonly onSaveClick: () => void;
}

export function BracketAutoSave({
  state,
  onSaveClick,
}: BracketAutoSaveProps): JSX.Element | null {
  if (state === "idle") return null;
  return (
    <div
      className="vt-bracket-autosave"
      data-state={state}
      role={state === "saved" || state === "error" ? "status" : undefined}
      aria-live={state === "saved" || state === "error" ? "polite" : undefined}
    >
      {state === "saved" ? (
        <span className="vt-bracket-autosave-toast" data-tone="ok">
          Saved <span aria-hidden="true">✓</span>
        </span>
      ) : state === "error" ? (
        <span className="vt-bracket-autosave-toast" data-tone="err">
          Save failed
        </span>
      ) : (
        <button
          type="button"
          className="vt-bracket-autosave-btn"
          onClick={onSaveClick}
          disabled={state === "saving"}
          aria-label="Save bracket"
        >
          {state === "saving" ? "Saving..." : "Save"}
        </button>
      )}
    </div>
  );
}
