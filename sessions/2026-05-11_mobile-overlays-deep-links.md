# 2026-05-11 — mobile-overlays-deep-links

**status**: complete
**branch**: feat/mobile-overlays-deep-links
**docs**: docs/44-overlay-router-and-mobile-overlays.md, docs/22-deployment-and-tunnels.md
**owner**: mobile-overlays builder agent

## Plan

1. Build an overlay system in `apps/web/components/overlay/` with
   provider, sheet UI, link wrapper, server-shim for SEO, and breadcrumb.
2. Wire `MatchPredictionRow` and `KnockoutMatch` so:
   - "View match" → match overlay (Cmd-click → real route)
   - Small "i" badge per team → team overlay (Cmd-click → /team/[code])
3. Bracket page wraps in `BracketOverlayShell` + emits the
   `OverlayServerShim` for SEO.
4. Marketing site mobile menu → slide-in drawer with backdrop scrim,
   Esc + swipe-right + close-button + backdrop-click dismiss.
5. ~30 unit tests for the overlay system, ~6 Playwright cases for the
   marketing drawer.
6. Document the URL scheme + caching policy.

## Files added

```
apps/web/components/overlay/types.ts
apps/web/components/overlay/url.ts
apps/web/components/overlay/OverlayProvider.tsx
apps/web/components/overlay/Sheet.tsx
apps/web/components/overlay/OverlayLink.tsx
apps/web/components/overlay/OverlayRoot.tsx
apps/web/components/overlay/OverlayBreadcrumb.tsx
apps/web/components/overlay/BracketOverlayShell.tsx
apps/web/components/overlay/OverlayServerShim.tsx
apps/web/components/overlay/TeamOverlay.tsx
apps/web/components/overlay/MatchOverlay.tsx
apps/web/components/overlay/LeaderboardEntryOverlay.tsx
apps/web/components/overlay/overlay.css
apps/web/components/overlay/team-overlay.css
apps/web/components/overlay/index.ts
apps/web/__tests__/overlay-router.test.tsx
apps/marketing/e2e/mobile-drawer.spec.ts
docs/44-overlay-router-and-mobile-overlays.md
sessions/2026-05-11_mobile-overlays-deep-links.md
```

## Files edited

```
apps/web/app/world-cup-2026/page.tsx           # wrap in BracketOverlayShell + server shim; force-dynamic
apps/web/components/bracket/MatchPredictionRow.tsx # team-info chip + overlay routing on "View match"
apps/web/components/bracket/KnockoutMatch.tsx  # ditto for knockouts
apps/web/app/world-cup-2026/bracket.css        # team-info chip styles
apps/marketing/src/components/Header.astro     # slide-in drawer markup + script
apps/marketing/src/styles/globals.css          # drawer + scrim CSS
docs/22-deployment-and-tunnels.md              # overlay caching row
```

## Key decisions

1. **Plain `history.pushState`, not Next.js router.** The overlay
   never changes the underlying route — that's by design (SEO,
   analytics, share-preview). We bolt onto the `popstate` event and
   keep our own state machine in `OverlayProvider`.

2. **Param flattening in URL.** Two stacked overlays share one
   query-string. Each component reads only its own params. Means we
   lose the ability to encode two overlays of the same kind with
   different params, but that pattern doesn't exist in the bracket UX
   (tapping a second team replaces the first).

3. **Force-dynamic on the bracket page.** The `OverlayServerShim`
   reads `searchParams`, so the page can no longer be `force-static`.
   The cache is restored by the standing edge-cache policy (5min
   s-maxage + SWR), not by the framework's static optimisation.

4. **No framer-motion.** The Sheet animates with hand-rolled CSS
   keyframes + a CSS transition on `transform` for the drag-down
   gesture. Adds no bytes to the bundle. `prefers-reduced-motion`
   disables the animations.

5. **Team-info badge instead of "tap flag = overlay".** The original
   spec said flag taps should open team overlays, but the flag tap on
   `MatchPredictionRow` is the team-pick action (load-bearing UX).
   Compromise: keep the pick action, add a small "i" badge in the
   corner of each pick button that opens the overlay. Cmd-click on
   the badge still hits the real `/team/[code]` page.

6. **Marketing drawer is plain HTML + inline script, no React.** The
   marketing site is Astro with no React island story for the
   header. Inline script keeps the JS payload tiny (~1.5 KB gz).

## Test results

```
$ pnpm --filter ./apps/web test
Test Files  45 passed (45)
     Tests  462 passed (462)

$ pnpm --filter ./apps/web typecheck
(clean)

$ pnpm --filter ./apps/marketing build
12 page(s) built in 3.61s

$ pnpm typecheck   # workspace-wide
all packages clean
```

## Sample deep-link URLs

- `https://2026wc.vtourn.com/world-cup-2026?overlay=team&code=NZL`
- `https://2026wc.vtourn.com/world-cup-2026?overlay=match&id=55`
- `https://2026wc.vtourn.com/world-cup-2026?overlay=team,match&code=ARG&id=55`
- `https://2026wc.vtourn.com/world-cup-2026/share/abc123?overlay=leaderboard-entry&bracketId=abc123`

## Next steps

- Wait for #106 (PWA shell) to land, then teach the BottomNav about
  the overlay state (badge pulse / preserve-tab-on-overlay-open).
- Once the blog PR (#105) lands, add Related-cards + sticky TOC per
  the original spec. Skipped here because the blog directory doesn't
  exist on `main` yet.
- Consider hash-based deep links for non-Next environments.
- Wire LeaderboardEntryOverlay to the actual share-preview API once
  Verified Pundit + share routes are live (`apps/web/app/world-cup-2026/share/[bracketId]/page.tsx`).

## Open questions

- BottomNav z-index: I budgeted overlay at 1000+ and bottom-nav at
  900–999, per the doc. If the merged PWA shell uses a different
  range, we'll need to reconcile in the PWA-shell merge PR.
- Should the breadcrumb be sticky? Currently it scrolls with the
  page. Tim's spec says "above the AppBar" so it's likely fine to
  keep it inline; revisit after the PWA shell merge.
