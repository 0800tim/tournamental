/**
 * LockSummary — running "X of 104 picks saved" + countdown + predicted
 * champion + share CTA. Pure render; takes per-match bracket + cascade
 * output.
 *
 * 2026-05-29 (Tim): dropped the user-visible multiplier table and the
 * boldest-pick CTA. Scoring is now simple: count of correct picks. The
 * scoring-engine helpers still exist for now (they're untouched), but
 * we don't surface any multiplier language to users on this panel.
 *
 * Naming note: the file + exported symbol are `LockSummary` for now —
 * callers and tests reference it. All user-visible copy in this
 * component reads as "Save" / "Saved".
 */

"use client";

import { useEffect, useState } from "react";

import {
  type Bracket,
  type CascadedBracket,
  type Tournament,
} from "@tournamental/bracket-engine";

import { useUser } from "@/lib/auth/useUser";
import { localUserId } from "@/lib/bracket/storage";
import { useCountUp } from "@/lib/motion";
import { shareContent, tapFeedback } from "@/lib/native";
import { loadStoredShareGuid } from "@/lib/share/share-guid-storage";
import { slugifyDisplayName } from "@/lib/share/handle-slug";
import {
  buildShareText,
  buildShareTextBody,
  buildShareTitle,
  resolveShareGuid,
  shareUrlFor,
} from "@/lib/share/share-text";

export interface LockSummaryProps {
  readonly bracket: Bracket;
  readonly cascaded: CascadedBracket;
  readonly tournament: Tournament;
  readonly deadline_utc: string;
  /** Optional: when present, used to build the share URL. */
  readonly bracketId?: string;
  /** Optional handle/display name for the share text. */
  readonly handle?: string;
}

function formatCountdown(now: number, deadline: number): string {
  const diff = Math.max(0, deadline - now);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

function teamName(tournament: Tournament, code: string | null | undefined): string {
  if (!code) return "—";
  return tournament.teams.find((t) => t.id === code)?.name ?? code;
}

export function LockSummary(props: LockSummaryProps) {
  const { bracket, cascaded, tournament, deadline_utc, bracketId, handle } = props;
  const [now, setNow] = useState<number>(() => Date.parse(tournament.start_utc) - 1000);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const deadline = Date.parse(deadline_utc);

  // Per-match counts (group + knockout = up to 104 for World Cup 2026).
  // Tim 2026-06-05: knockout picks are counted off the cascaded view
  // (both slots resolved AND engine has a valid effective_winner), not
  // off the raw bracket.knockoutPredictions map. The raw map keeps
  // stored picks for matches whose other side is still TBD (e.g. a
  // Best-3rd opponent the user hasn't picked), and those should not
  // count toward "X of 104 picks saved".
  const totalGroup = tournament.group_fixtures.length;
  const totalKnockout = tournament.knockouts.length;
  const totalPicks = totalGroup + totalKnockout;
  const groupPicks = Object.keys(bracket.matchPredictions).length;
  const knockoutPicks = cascaded.knockouts.reduce(
    (n, k) =>
      n +
      (k.home.team !== null && k.away.team !== null && k.effective_winner !== null
        ? 1
        : 0),
    0,
  );
  const committed = groupPicks + knockoutPicks;

  // Predicted champion: cascade's effective_winner of the Final.
  const final = cascaded.knockouts.find((k) => k.stage === "f");
  const champion = teamName(tournament, final?.effective_winner ?? final?.predicted_winner ?? null);

  // Build the canonical share URL for the user's bracket. Uses the
  // play.tournamental.com/s/<guid> short-link form, which matches the
  // public landing route owned by the s-guid agent (parallel #67).
  // resolveShareGuid prefers the server-returned share guid (persisted
  // at last save, see lib/share/share-guid-storage.ts) over the auth
  // user id and the bracket's stable `bracketId`. This guarantees the
  // share URL resolves to the user's REAL saved bracket — not the
  // synthetic stub that PR #140 generated before the backend lookup
  // existed.
  const shareWinner = champion === "—" ? "TBD" : champion;
  // Same cascade-aware semantics as `committed` above: the bracket is
  // complete only when every group AND every knockout match has a
  // genuine pick that the engine accepts.
  const isComplete = committed >= totalPicks;
  const [storedShareGuid, setStoredShareGuid] = useState<string | null>(null);
  useEffect(() => {
    setStoredShareGuid(loadStoredShareGuid(tournament.id, localUserId()));
  }, [tournament.id]);
  // Hook auth here (and reuse below) so we can mint the friendly
  // `/s/<handle>` URL when the user is signed in and their
  // display_name slugifies to a clean handle (Tim 2026-05-24).
  const auth = useUser();
  const authHandle = slugifyDisplayName(auth.profile?.display_name ?? null);
  const guid = resolveShareGuid({
    serverShareGuid: storedShareGuid,
    authUserId: null,
    authHandle,
    bracketId,
  });
  const shareUrl = shareUrlFor(guid);
  // Body for navigator.share (URL passed separately so we don't render
  // the link twice in WhatsApp / iMessage). buildShareText (with the
  // URL inline) is still used for the deep-link fallbacks below.
  const shareTextBody = buildShareTextBody({
    champion: shareWinner,
    guid,
    isComplete,
  });
  void buildShareText; // referenced by deep-link helpers, kept for fallbacks

  const handleShare = async (): Promise<void> => {
    void tapFeedback("medium");
    if (typeof window !== "undefined") {
      type DL = Window & { dataLayer?: Array<Record<string, unknown>> };
      const w = window as DL;
      if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
      w.dataLayer.push({
        event: "share_clicked",
        platform: "redirect-save-share",
        surface: "lock-summary",
      });
    }
    // Tim 2026-06-01: all in-page share buttons now route to the
    // curated /world-cup-2026/save-share surface rather than firing
    // navigator.share inline. The save-share page owns the visual
    // preview, the format toggle (Portrait/Landscape/Square), the
    // open-in-new-tab download, the platform-specific deep links,
    // and the canonical /s/<guid> URL the recipient lands on. Doing
    // it from there means every share originates from a consistent,
    // proof-read surface rather than from whatever page the user
    // happened to be on. The shareUrl + shareTextBody plumbing below
    // is retained because the public surface props haven't changed;
    // the body builders are also still consumed by the deep-link
    // helpers in the save-share page.
    if (typeof window !== "undefined") {
      window.location.href = "/world-cup-2026/save-share";
    }
  };
  void shareUrl;
  void shareTextBody;
  void shareContent;
  void buildShareTitle;

  // Suppress the no-unused-vars warning — `handle` is still part of the
  // public prop surface for forward-compat with the auth/handle wiring,
  // even though the new share-url builder doesn't need it.
  void handle;

  // Count-up the committed-picks total when the lock summary scrolls
  // into view (final tab on mobile, footer on desktop). Single motion
  // grammar: 0.9s power2.out via the shared `useCountUp` hook so the
  // bracket-page and share-landing scoreboard tween read the same.
  const committedRef = useCountUp<HTMLElement>({ value: committed });

  return (
    <aside className="bracket-lock-summary" data-testid="lock-summary">
      <div data-testid="lock-summary-headline">
        <strong ref={committedRef as React.RefObject<HTMLElement>}>{committed}</strong> of {totalPicks} picks saved
        <span aria-hidden="true"> — {groupPicks}/{totalGroup} group, {knockoutPicks}/{totalKnockout} knockout.</span>
      </div>
      <div>
        Save the rest before {new Date(deadline_utc).toUTCString().replace("GMT", "UTC")}. Tweak any pick game-by-game until kickoff.
      </div>
      <div className="bracket-countdown">
        <span aria-label="time-to-deadline">{formatCountdown(now, deadline)}</span> remaining
      </div>

      <hr className="bracket-lock-divider" />

      <div className="bracket-predicted-champion" data-testid="predicted-champion">
        <span className="bracket-predicted-champion__label">Your predicted champion: </span>
        <strong className="bracket-predicted-champion__team">{champion}</strong>
      </div>

      <div className="bracket-share-actions">
        {/* Primary share CTA now navigates to the curated save-share
          * page rather than firing navigator.share inline. The
          * secondary "More share options" link was removed (same
          * destination, redundant). Tim 2026-06-01. */}
        <a
          className="bracket-share-cta-primary"
          data-testid="share-bracket-cta"
          href="/world-cup-2026/save-share"
          onClick={() => {
            void handleShare();
          }}
        >
          <span aria-hidden="true" className="bracket-share-cta-icon">↗</span>
          Share my bracket
        </a>
      </div>
    </aside>
  );
}
