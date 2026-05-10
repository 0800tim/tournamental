/**
 * LeaderboardEntryOverlay — placeholder bottom-sheet for a leaderboard
 * row. Wires into the Verified-Pundit + share flow once the
 * leaderboard service is live (see docs/12-odds-and-predictions.md +
 * the share/[bracketId] route).
 *
 * For now this is a minimal card with the entry's display info plus
 * "Share" + "View bracket" CTAs. Future agents can flesh this out
 * without touching the overlay router.
 */

"use client";

import Link from "next/link";

import { Sheet } from "./Sheet";
import { useOverlay } from "./OverlayProvider";

interface LeaderboardEntryOverlayProps {
  readonly bracketId: string;
  readonly displayName?: string;
  readonly score?: string;
  readonly depth?: number;
}

export function LeaderboardEntryOverlay(props: LeaderboardEntryOverlayProps) {
  const { bracketId, displayName, score, depth = 0 } = props;
  const overlay = useOverlay();

  const fullPageHref = `/world-cup-2026/share/${bracketId}`;

  return (
    <Sheet
      title={displayName ?? `Bracket ${bracketId}`}
      depth={depth}
      onClose={overlay.close}
      idHint={`lb-${bracketId}`}
    >
      <div className="vt-lb-overlay">
        {score && (
          <p className="vt-lb-overlay-score">
            <strong>{score}</strong> pts
          </p>
        )}
        <p>This entry was locked before kickoff.</p>
        <div className="vt-lb-overlay-actions">
          <Link
            href={fullPageHref}
            className="vt-overlay-fullpage-cta"
            onClick={() => overlay.closeAll()}
          >
            View their bracket →
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
