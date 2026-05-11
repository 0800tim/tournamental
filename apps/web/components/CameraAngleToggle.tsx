"use client";

import type { CameraMode } from "./CameraRig";

interface CameraAngleToggleProps {
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
}

interface CamOption {
  mode: CameraMode;
  label: string;
  icon: React.ReactNode;
  testid: string;
}

/**
 * Camera-angle row — four pill-buttons sitting just above the timeline
 * scrubber. Replaces the old `.camera-toggle` cluster that was hidden
 * behind the (newer) scrubber. Icons render at all viewport sizes;
 * labels collapse out below 640px so the row stays compact on phones.
 */
export function CameraAngleToggle({ mode, onChange }: CameraAngleToggleProps) {
  return (
    <div
      className="camera-angle-row"
      data-testid="camera-angle-row"
      role="radiogroup"
      aria-label="Camera angle"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          className="cam-pill"
          data-active={mode === opt.mode ? "1" : "0"}
          data-cam={opt.mode}
          data-testid={opt.testid}
          role="radio"
          aria-checked={mode === opt.mode}
          onClick={() => onChange(opt.mode)}
        >
          <span className="cam-pill-icon" aria-hidden>
            {opt.icon}
          </span>
          <span className="cam-pill-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

/* Inline minimalist line-art icons — they sit in `currentColor` so the
 * active-state colour drives them automatically. Sized 14×14 to match
 * the pill text. */

const DirectorIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

const BroadcastIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="9" height="6.5" rx="1" />
    <path d="M11 8 L14 6 L14 10.5 L11 8.5" />
  </svg>
);

const TacticalIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M8 3 L8 13" />
    <circle cx="8" cy="8" r="1.6" />
  </svg>
);

const FollowIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.6 L8 3.6 M8 12.4 L8 14.4 M1.6 8 L3.6 8 M12.4 8 L14.4 8" />
  </svg>
);

const OPTIONS: CamOption[] = [
  { mode: "director", label: "Director", icon: DirectorIcon, testid: "cam-director" },
  { mode: "broadcast", label: "Broadcast", icon: BroadcastIcon, testid: "cam-broadcast" },
  { mode: "tactical", label: "Top-down", icon: TacticalIcon, testid: "cam-tactical" },
  { mode: "follow", label: "Follow ball", icon: FollowIcon, testid: "cam-follow" },
];
