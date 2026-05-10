/**
 * OverlayRoot — renders every active overlay frame as a portalled
 * sheet, in stack order. Lives once per page (mounted by the page that
 * owns the bracket UI), and reads the stack from the surrounding
 * `<OverlayProvider>` via `useOverlay()`.
 *
 * The renderer is a small registry: kind → component. Adding a new
 * overlay kind is two steps:
 *   1. Add the kind to `OverlayKind` in `types.ts`.
 *   2. Implement a renderer + register it here.
 *
 * All components are mounted as plain children (not via `createPortal`)
 * because the sheet itself is `position: fixed` — there's no clipping
 * concern. We do, however, render a top-level wrapper with `aria-live`
 * so assistive tech announces the overlay opening.
 */

"use client";

import { useOptionalOverlay } from "./OverlayProvider";
import { TeamOverlay } from "./TeamOverlay";
import { MatchOverlay } from "./MatchOverlay";
import { LeaderboardEntryOverlay } from "./LeaderboardEntryOverlay";
import type { OverlayFrame } from "./types";

import "./overlay.css";
import "./team-overlay.css";

function renderFrame(frame: OverlayFrame, depth: number): React.ReactNode {
  switch (frame.kind) {
    case "team": {
      const code = frame.params.code ?? "";
      return <TeamOverlay key={`team-${code}`} code={code} depth={depth} />;
    }
    case "match": {
      const id = frame.params.id ?? "";
      return <MatchOverlay key={`match-${id}`} id={id} depth={depth} />;
    }
    case "leaderboard-entry": {
      const bracketId = frame.params.bracketId ?? "";
      return (
        <LeaderboardEntryOverlay
          key={`lb-${bracketId}`}
          bracketId={bracketId}
          displayName={frame.params.name}
          score={frame.params.score}
          depth={depth}
        />
      );
    }
    default: {
      // Unknown kind — render nothing. The provider already filters
      // these on parse, so this should be unreachable in practice.
      return null;
    }
  }
}

export function OverlayRoot() {
  const overlay = useOptionalOverlay();
  if (!overlay) return null;
  if (overlay.stack.length === 0) return null;
  return (
    <div className="vt-overlay-root" role="presentation" aria-live="polite">
      {overlay.stack.map((frame, i) => renderFrame(frame, i))}
    </div>
  );
}
