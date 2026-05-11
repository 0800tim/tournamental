"use client";

/**
 * DraftPreviewBanner — yellow honesty pill that sits above any mock-
 * data surface. The visual contract for the whole "draft leaderboard"
 * system: every mock page MUST mount this once, near the top of the
 * card grid, so a viewer can never mistake placeholder rows for real
 * standings.
 *
 * Dismissable via localStorage flag `tournamental:draft-banner-dismissed:v1`.
 * If we change the message materially, bump the version suffix so
 * everyone sees it once more.
 */

import { useEffect, useState } from "react";

import "./draft.css";

const STORAGE_KEY = "tournamental:draft-banner-dismissed:v1";

export interface DraftPreviewBannerProps {
  /**
   * Override the default message. Use sparingly — the default is
   * carefully worded for "honest by default".
   */
  readonly message?: string;
  /**
   * Tournament kickoff date used in the default message. Default is
   * 11 Jun 2026.
   */
  readonly kickoffLabel?: string;
  /**
   * Make the banner sticky to the top of its containing scroll
   * region. Default false — most pages let it flow with the content.
   */
  readonly sticky?: boolean;
}

export function DraftPreviewBanner({
  message,
  kickoffLabel = "11 Jun 2026",
  sticky = false,
}: DraftPreviewBannerProps) {
  const [hidden, setHidden] = useState(true);

  // SSR: render nothing until we've checked localStorage, then show.
  // Avoids the flash-of-banner that hydration mismatch would cause.
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(STORAGE_KEY) === "1";
      setHidden(dismissed);
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;

  const text =
    message ??
    `Preview data. Real leaderboards activate at kickoff (${kickoffLabel}). Names, avatars, and points shown are illustrative.`;

  return (
    <div
      className="vt-draft-banner"
      data-sticky={sticky ? "1" : undefined}
      role="status"
      aria-live="polite"
    >
      <span className="vt-draft-banner-icon" aria-hidden="true">
        📊
      </span>
      <span className="vt-draft-banner-text">
        <strong>Preview data.</strong>{" "}
        {text.replace(/^Preview data\.\s*/, "")}
      </span>
      <button
        type="button"
        className="vt-draft-banner-dismiss"
        aria-label="Dismiss preview-data notice"
        onClick={() => {
          try {
            window.localStorage.setItem(STORAGE_KEY, "1");
          } catch {
            /* localStorage unavailable — still hide for this session */
          }
          setHidden(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
