"use client";

/**
 * MoleculeSharePreview, the live "what you'll share" preview frame
 * on /world-cup-2026/save-share.
 *
 * v6.1, "viral share landing" follow-up (2026-05-11). Tim's brief:
 * the visible preview on Save & share must MATCH the share image
 * pixel-for-pixel. The way we guarantee that is to mount the actual
 * MoleculeScene + panel inline here — the preview IS the capture
 * source. When the user hits "Download" or "Share", we run the same
 * `captureDomComposition` helper the floating capture button on
 * /world-cup-2026/molecule uses, and the resulting PNG is a literal
 * snapshot of what they're looking at.
 *
 * Implementation path B from the brief (live inline + client-side
 * capture). Path A was rejected because the existing
 * `/api/share/molecule-capture` endpoint requires a client-rendered
 * canvas dataURL upload, so a server-rendered preview would require
 * a brand-new molecule renderer on the server (headless Chrome) — a
 * non-starter for this PR.
 *
 * Why live mount rather than a placeholder `<img>` until capture:
 *   1. The user sees a moving 3D pyramid, which is far more engaging
 *      than a static thumbnail and matches the "viral hook" framing
 *      from Tim's 2026-05-11 brief.
 *   2. The molecule-page and save-share-page now look identical when
 *      viewed side-by-side, so the "what does my share image look
 *      like?" question has an obvious answer: it looks like THIS.
 *   3. The cost of running the R3F scene twice (molecule page +
 *      save-share page) is acceptable, this page is visited
 *      infrequently and the user is actively engaged. Hidden behind
 *      a `<Suspense>` boundary that defers the WebGL mount until the
 *      page has paint-ready DOM, so the initial LCP stays in budget.
 *
 * Cache: capture output is per-pose (the user can rotate the molecule
 * before clicking Share), so we don't cache the resulting blob across
 * format switches — we re-capture per click. The QR PNG fetched
 * during composition IS cached for the page session by
 * `dom-capture.ts`'s module-scope `qrCache`, keyed by `share_guid`.
 * The share_guid itself is stable per (user × bracketId × locked_at)
 * so re-saves bust the QR cache transparently.
 */

import { useEffect, useState } from "react";

import type { Bracket, Tournament } from "@tournamental/bracket-engine";

import { MoleculeScene } from "@/components/molecule/MoleculeScene";

import "@/components/molecule/molecule.css";
import "./molecule-share-preview.css";

export interface MoleculeSharePreviewProps {
  readonly tournament: Tournament;
  /** The user's persisted bracket. Null until localStorage hydrates. */
  readonly bracket: Bracket | null;
}

export function MoleculeSharePreview({
  tournament,
  bracket,
}: MoleculeSharePreviewProps): JSX.Element {
  // Deferred mount: WebGL takes ~200ms to spin up on a cold device,
  // we keep the first paint cheap and hand control over to the R3F
  // canvas a tick later.
  const [shouldMount, setShouldMount] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(() => setShouldMount(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="vt-ss-molecule-preview"
      data-testid="vt-ss-molecule-preview"
      aria-label="Your bracket as a 3D molecule, live preview"
    >
      {shouldMount && bracket ? (
        <MoleculeScene
          tournament={tournament}
          bracketOverride={bracket}
          layoutMode="stable"
          /* 2026-05-13 (Tim): the auto-opened champion panel was
           * overlapping the molecule in this preview frame. We're
           * about to replace this whole preview with a static podium
           * card; meanwhile suppress the auto-select so users at least
           * see the molecule cleanly. */
          suppressAutoSelect
          hideSidePanel
        />
      ) : (
        <div className="vt-ss-molecule-preview-placeholder" role="status">
          {bracket
            ? "Loading molecule…"
            : "No bracket saved yet. Pick at least one knockout match to see the live preview."}
        </div>
      )}
    </div>
  );
}

