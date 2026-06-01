"use client";

/**
 * BracketSharePreview — what the save-share visitor sees as their
 * "this is the image that gets shared" preview.
 *
 * 2026-05-14: Tim swapped the live-mounted 3D molecule for a static
 * preview of the OG image. The new viral renderer (v3-podium) produces
 * a captivating podium-flag composition; that's the same PNG social
 * platforms unfurl AND the same PNG the user downloads. Showing it as
 * an `<img>` keeps the page-side preview pixel-identical to the share
 * bytes, no DOM-to-canvas dance required.
 *
 * File kept under the old name `MoleculeSharePreview` so existing
 * import sites continue to resolve while the rest of the share
 * pipeline is refactored. A future rename to `BracketSharePreview`
 * is cosmetic only.
 */

import { useMemo } from "react";

import type { Bracket, Tournament } from "@tournamental/bracket-engine";
import { cascade } from "@tournamental/bracket-engine";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";

import { buildOgImageUrl, resolveShareGuid, type OgSize } from "@/lib/share/share-text";

import "./molecule-share-preview.css";

export interface MoleculeSharePreviewProps {
  readonly tournament: Tournament;
  /** The user's persisted bracket. Null until localStorage hydrates. */
  readonly bracket: Bracket | null;
  /** Auth user id when signed in — used as the share guid. */
  readonly authUserId?: string | null;
  /** Display handle for the card header. */
  readonly handle?: string | null;
  /** Avatar URL (absolute or /avatars/<id>.jpg). */
  readonly avatarUrl?: string | null;
  /** Which aspect ratio to request from the OG endpoint AND apply to the
   * on-page preview frame. Drives the Portrait/Landscape/Square toggle
   * in ShareSavePage so the preview matches what the user downloads.
   * Defaults to "landscape" for back-compat with embed surfaces. */
  readonly size?: OgSize;
}

export function MoleculeSharePreview({
  tournament,
  bracket,
  authUserId,
  handle,
  avatarUrl,
  size = "landscape",
}: MoleculeSharePreviewProps): JSX.Element {
  // Re-run the cascade locally so we can pass the predicted podium
  // codes to the OG endpoint. The renderer can also derive these from
  // the knockoutPath fallback, but doing it here yields a faster card
  // because the endpoint's optional game-service fetch can short-circuit.
  const podium = useMemo(() => {
    if (!bracket) return { champion: null, runnerUp: null, third: null };
    return resolvePodium(tournament, bracket);
  }, [tournament, bracket]);

  const guid = useMemo(
    () =>
      resolveShareGuid({
        serverShareGuid: null,
        authUserId,
        bracketId: bracket?.bracketId ?? null,
      }),
    [authUserId, bracket?.bracketId],
  );

  const ogUrl = useMemo(() => {
    return buildOgImageUrl({
      bracketId: guid,
      handle: handle ?? null,
      winner: podium.champion,
      runnerUp: podium.runnerUp,
      third: podium.third,
      avatarUrl: avatarUrl ?? null,
      size,
    });
  }, [guid, handle, podium, avatarUrl, size]);

  // Native pixel dimensions per aspect ratio. Used as the <img> width/height
  // attributes so the browser reserves the correct aspect-ratio slot before
  // the PNG arrives (no layout shift when the toggle switches).
  const dims = (() => {
    if (size === "portrait") return { w: 1080, h: 1350 };
    if (size === "square") return { w: 1080, h: 1080 };
    return { w: 1200, h: 630 };
  })();

  return (
    <div
      className="vt-ss-bracket-preview"
      data-testid="vt-ss-bracket-preview"
      data-size={size}
      aria-label="Your share card preview"
    >
      {bracket ? (
        // The OG endpoint always responds with a renderable PNG even
        // when fields are sparse, so the preview never sits on a
        // broken-image icon during early hydration. Loading=eager so
        // the preview slot doesn't flash empty. The key forces a fresh
        // <img> on size change so the browser doesn't reuse the old
        // landscape bitmap while the new aspect ratio fetches.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={size}
          src={ogUrl}
          alt="Your bracket share card"
          width={dims.w}
          height={dims.h}
          loading="eager"
          decoding="async"
          className="vt-ss-bracket-preview-img"
        />
      ) : (
        <div className="vt-ss-bracket-preview-placeholder" role="status">
          No bracket saved yet. Pick at least one knockout match to see
          your shareable card.
        </div>
      )}
    </div>
  );
}

/** Cascade + extract champion / runner-up / bronze codes. */
function resolvePodium(
  tournament: Tournament,
  bracket: Bracket,
): { champion: string | null; runnerUp: string | null; third: string | null } {
  const userId = "preview";
  const legacy = bracketToCascadeInput(tournament, bracket, userId);
  let result = cascade(tournament, legacy);
  for (let pass = 0; pass < 6; pass += 1) {
    const overlays = Object.values(bracket.knockoutPredictions)
      .map((p) => {
        const k = result.knockouts.find((x) => x.id === p.matchId);
        if (!k) return null;
        const team = p.outcome === "home_win" ? k.home.team : k.away.team;
        return team ? { match_id: p.matchId, winner: team } : null;
      })
      .filter((x): x is { match_id: string; winner: string } => x !== null);
    const before = result.knockouts.filter((k) => k.effective_winner).length;
    result = cascade(tournament, { ...legacy, knockouts: overlays });
    const after = result.knockouts.filter((k) => k.effective_winner).length;
    if (after === before) break;
  }
  const final = result.knockouts.find((k) => k.stage === "f");
  const tp = result.knockouts.find((k) => k.stage === "tp");
  const champion = final?.effective_winner ?? final?.predicted_winner ?? null;
  const runnerUp = final
    ? final.effective_winner === final.home.team
      ? final.away.team
      : final.effective_winner === final.away.team
        ? final.home.team
        : null
    : null;
  const third = tp?.effective_winner ?? tp?.predicted_winner ?? null;
  return { champion, runnerUp, third };
}
