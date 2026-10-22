# Share card v2 — pyramid molecule + flags-in-cups + share-guid URL + QR

- task: v2 polish of the OG share card landed in PR #144.
- branch: `feat/share-card-v2-pyramid-and-flag-cups`
- assigned doc(s): `packages/social-cards/src/canvas/bracket-share-card.ts`,
  the molecule v3/v4 source in `apps/web/components/molecule/*`, and the
  `/api/og/bracket` route.

## Plan

1. Extend the canvas card with a 2D isometric pyramid silhouette on the
   left replacing the legacy "PATH TO GOLD" strip. Seven layers, champion
   column highlighted with a gold trail + glow, base ring scattered with
   greyed flag discs for context atoms (if `allEliminatedByStage` is set).
2. Move the flag *inside* each podium cup bowl — clip the flag PNG to
   the bowl ellipse, tinted by the medal colour. Country code text stays
   below the cup.
3. Replace the footer URL with `play.tournamental.com/s/<guid>` (uses
   the new optional `shareGuid` input) and render a small 50×50 QR code
   next to it (gold-on-navy).
4. Update the inline-query input builder to take `share_guid`,
   `eliminated` and pass them through. Add an `eliminated_by_stage` shape
   to the route enrichment.
5. Tests:
   - Pyramid drawing path renders cleanly for empty + populated
     `allEliminatedByStage`.
   - In-cup flag mask renders cleanly and survives missing flags.
   - QR encoding outputs a valid PNG sub-rect with the share URL.
   - Existing tests stay green.

## Open questions

- None for now; making judgment calls on visual proportions.

## Outcome

Shipped v2 of the bracket share card. Key changes:

- **Pyramid silhouette** on the LEFT half (landscape) / TOP half (portrait,
  square) — 7 layers `group → r32 → r16 → qf → sf → final → champion`
  matching molecule v4. The champion's flag rises through every layer
  with a 3px `#fbbf24` Bezier trail (shadow-blur 14, gold glow). Atoms
  on the champion path get a gold rim; off-path scatter atoms (from
  optional `allEliminatedByStage`) are dimmed with a navy overlay.
- **Flags inside cup bowls.** The bowl is now an ellipse-clipped region
  containing the flag PNG, a 0.45-alpha medal tint (gold/silver/bronze),
  and a re-drawn rim on top so the cup still reads "gold"/"silver"/
  "bronze". Rank label (1ST / 2ND / 3RD) painted on top of the flag in
  white with a soft drop-shadow.
- **Share URL + QR.** New `shareGuid` input renders the URL as
  `play.tournamental.com/s/<guid>`, mono-spaced gold; a 50×64×72 px
  QR code (gold-on-navy, error-correction M) sits next to the URL. QR
  encodes the same URL so a viewer can scan from their phone.
- **Input additions** (non-breaking): `shareGuid?: string | null` and
  `allEliminatedByStage?: Array<{ stage, teamCodes }>`. Both optional;
  the card falls back to v1 layout + legacy footer if unset.
- **Performance.** Warm render ~250-300 ms across all three sizes.
  Cold first-request ~500 ms. QR + flag-image caches keep video-frame
  pipeline well inside its budget (~4.7 s for the 16-frame mock test,
  up from 4.3 s on v1).
- **Tests.** Added 10 new tests covering pyramid context atoms,
  shareGuid URL resolution (including injection rejection), QR PNG
  output + cache behaviour, and full 3-size rendering with v2 inputs.
  Total social-cards suite: 110 / 110 green. Web suite: 938 / 938
  green. Both packages typecheck + build clean.

## Files touched

- `packages/social-cards/src/canvas/bracket-share-card.ts` — full v2
  renderer (pyramid, flags-in-cups, footer QR, caches).
- `packages/social-cards/src/canvas/types.ts` — new types:
  `PyramidLayer`, `PYRAMID_LAYERS`, `STAGE_TO_LAYER`,
  `BracketShareEliminationTier`, plus `shareGuid`,
  `allEliminatedByStage` on `BracketShareCardInput`.
- `packages/social-cards/src/canvas/flags.ts` — added `loadFlagImage`
  that caches decoded `Image` objects, used by both the pyramid
  scatter and cup-bowl mask.
- `packages/social-cards/src/canvas/index.ts` — re-exports.
- `packages/social-cards/src/index.ts` — public API re-exports for
  the v2 helpers.
- `packages/social-cards/test/bracket-share-card.test.ts` — 10 new
  test cases (22 in this file total now).
- `packages/social-cards/package.json` — added `qrcode` +
  `@types/qrcode` deps.
- `apps/web/lib/share/bracket-share-input.ts` — accepts
  `share_guid=` + `eliminated=group:AAA|BBB,r16:CCC` query params.
- `apps/web/app/api/og/bracket/route.ts` — merge new fields from the
  game-service enrichment payload.

## Sample render outputs

- `screenshots/2026-05-11-share-card-v2/v2-landscape.png` (1200×630, 216 kB)
- `screenshots/2026-05-11-share-card-v2/v2-portrait.png` (1080×1350, 303 kB)
- `screenshots/2026-05-11-share-card-v2/v2-square.png` (1080×1080, 263 kB)

