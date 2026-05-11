# 2026-05-11, molecule-viral-share-landing

status: in-progress
docs: docs/22-deployment-and-tunnels.md
refs: PR #157 (vs labels), PR #158 (capture button)

## Goal

Two coupled changes for the WC 2026 molecule page so the viral share image
matches the on-page composition Tim sketched on 2026-05-11:

1. Auto-land in the predicted-champion panel (no extra click needed) so the
   user sees a "story" from first paint, pyramid on the left, panel on the
   right.
2. Replace the server-side `renderMoleculeCaptureCard` composition with a
   literal DOM screenshot of the pyramid canvas plus the right-side panel,
   side-by-side at ~1600x900.

## Plan

1. `MoleculeScene.tsx`, auto-select the predicted champion once the layout
   resolves on first mount; fall back to the rank-sorted favourite if the
   user has no bracket yet. Initial-only, do not force-reselect on later
   renders or override the user's clicks.
2. New `apps/web/lib/molecule/dom-capture.ts`, a tiny DOM-to-PNG pipeline
   that uses `html-to-image` for the panel + the WebGL `canvas.toDataURL()`
   for the pyramid, then composes both onto an OffscreenCanvas at 1600x900
   with a small gold gutter and a Tournamental wordmark + `/s/<guid>` URL
   footer. Cache the QR-code data URL across captures.
3. `MoleculeCaptureButton.tsx`, swap its `captureAndCompose` call to the
   new DOM-faithful path. Server endpoint stays in place for now (any
   server-driven flows like email previews would still work) but the
   client no longer round-trips through it.
4. Hide the "Highlight on scene" toggle in the panel for the duration of
   the capture by toggling a `data-capturing="true"` attribute on
   `.molecule-panel`. Restore after.
5. `.molecule-panel` adopts `data-capture-mode` styling that pins the
   panel to a desktop-width 480x900 for the capture render, even on mobile.

Composition: 1100x900 pyramid PNG | gold 8px gutter | 460x900 panel PNG
stacked vertically with a 80px footer strip (wordmark + URL). 1600x900
total.

## Why Option A (DOM-faithful)

- Tim asked literally for "a screenshot of what I see right now". The
  server-recomposed Option B duplicates the panel's design surface in
  napi-rs/canvas which means every future panel tweak needs a parallel
  edit in `@vtorn/social-cards`. Option A snapshots the live DOM so the
  visual stays in sync automatically.
- The drei `<Html>` opponent badges on the canvas are already captured
  inside the WebGL canvas frame via the existing
  `preserveDrawingBuffer: true` config, *not* as DOM children. We
  separately snapshot the panel-only DOM into its own PNG and composite
  client-side.
- Bundle cost: `html-to-image` ships ~16 kB gzipped (its own bundle is
  ~13 kB; we don't import its `toJpeg` path). Within the +20 kB
  molecule-page-bundle budget called out in the brief.
- No server round-trip → 200-400 ms faster on mobile networks; capture
  completes well under the 1.2s budget.

## Next steps

- Wire QR cache (data URL keyed by guid) into module scope of
  `dom-capture.ts`.
- Test locally with `pnpm --filter @vtorn/web build` + typecheck.
- Open PR.
