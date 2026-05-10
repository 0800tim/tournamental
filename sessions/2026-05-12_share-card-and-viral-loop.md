# Session — Share Card + Viral Loop

- **Date**: 2026-05-12 (NZ)
- **Agent**: share-card-and-viral-loop builder
- **Branch**: `feat/share-card-and-viral-loop`
- **Worktree**: `/home/clawdbot/clawdia/projects/vtorn-share-cards`
- **Status**: in-progress
- **Refs**: docs/52-share-cards-and-viral-loops.md, packages/social-cards

## Plan

1. Add new `bracket-pick` card kind to `@vtorn/social-cards` (focused on
   Final winner + R16/QF/SF route + handle, distinct from the existing
   `bracket-prediction` which dumps a long list of picks).
2. New Next route `/api/og/[bracketId]` that returns a 1200×630 PNG —
   uses `satori` + `@resvg/resvg-js` directly (mirrors existing
   `/api/og/bracket` query-param route but uses the path-based form per
   spec).
3. New public share-target page `/share/[bracketId]/page.tsx` with full
   OG + Twitter Card metadata.
4. `components/share/` package: `ShareModal`, `ShareCard`, `ShareButtons`,
   `useShareModal` hook + `ShareModalProvider` context so the sibling
   bracket-tabs agent can call `openShareModal(bracketId)` from the
   Save & Share button.
5. Mock analytics endpoint `POST /v1/analytics/share` (in
   `apps/web/app/api/analytics/share/route.ts`) accepts `{bracketId,
   target, ts}` and 204s — wired to fire from the modal.
6. Tests: og-route test (~10), share-modal test (~15).
7. Docs: `docs/52-share-cards-and-viral-loops.md`.

## Decisions

- The mission says NEW `/share/[bracketId]/page.tsx` but a
  `/world-cup-2026/share/[bracketId]/page.tsx` exists. I'm keeping the
  WC-namespaced one (it's referenced from the bracket page) AND adding
  a generic `/share/[bracketId]` that delegates to the same metadata
  + rendering — so future tournaments get one canonical share URL.
- The mission says NEW `/api/og/[bracketId]/route.ts`. Existing
  `/api/og/bracket?bracket_id=…` uses query params. I'm adding the
  path-based route; both coexist (existing route used by current
  metadata-shape, new route is the canonical clean URL).
- Bracket data fetching: there's no real persisted bracket service yet
  (PR #27 hasn't landed). Path: read `searchParams` (handle, winner,
  route) as the "bracket payload" for both the OG route and share
  page. When the API lands a follow-up agent swaps the query-string
  payload for a server-side fetch by bracket id.
- Web Share API: feature-detected with `'share' in navigator`. Falls
  back to deep-link buttons row when not present.
- Caption format: `My @VTourn World Cup 2026 prediction: <Winner> to
  lift the trophy 🏆 — make yours at <url>`.

## Out of scope (queued)

- Animated 6-sec MP4 generator — sketched in doc 52 §"Future: animated
  shares".
- Real analytics persistence — endpoint is a 204 stub.

## Next steps

- Write code + tests.
- `pnpm --filter @vtorn/web test`, `pnpm --filter @vtorn/web typecheck`,
  build.
- Open PR.
