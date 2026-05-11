# 2026-05-12 — Match replay UI polish

Owner: code-agent (Clawd)
Branch: `feat/match-ui-polish`
Worktree: `/home/clawdbot/clawdia/projects/vtorn-match-ui`
Status: ready-for-review

## Goal

Tim flagged the AR-FR 2022 match replay UI as "very clunky and ugly":
- score banner not centred,
- top-right scorers panel + bottom-left stats panel were dense and never
  collapsed,
- a debug overlay bleeding into the bottom-left visible to end users,
- camera-angle toggle missing from screen (it was behind the timeline
  scrubber that shipped later), and
- subs panel overflowing.

Instruction was "improve it as much as you can for the prototype" — i.e.
treat it as a flagship surface and design a polished match HUD that
wouldn't look out of place on a production sports app.

## What changed

### New components

| File | Purpose |
| --- | --- |
| `apps/web/components/MatchScoreboard.tsx` | Centred broadcast scoreboard (top of canvas). Flag + name + score on each side, period above clock in the centre, shootout score under the clock when active. Glassy backdrop-filter blur, dark navy + gold palette matching the molecule view. |
| `apps/web/components/CollapsibleHUDCard.tsx` | Single source of truth for the right-edge collapsible panels. Persists open/collapsed state per-card in `localStorage` under `tournamental.match.hud.<id>`. Animates with a `grid-template-rows` height transition (`200ms cubic-bezier(0.4,0,0.2,1)`); honours `prefers-reduced-motion`. |
| `apps/web/components/MatchPanelsStack.tsx` | Right-edge stack of three CollapsibleHUDCards (Scorers, Match Stats, Subs) plus the goal-burst centre overlay. |
| `apps/web/components/CameraAngleToggle.tsx` | Polished cam-angle row sitting just above the timeline. Four pill buttons with inline line-art SVG icons (Director, Broadcast, Top-down, Follow ball). Mobile collapses labels to icons only; active mode keeps its label. |
| `apps/web/lib/team-flag.ts` | FIFA-3 → ISO-2 → Unicode flag emoji helper covering the 32 WC 2022 entrants + a handful of 2026 qualifiers. Returns `null` for unknown codes so callers fall back gracefully. |

### Behaviour changes

- **`MatchStatsHUD`** is now a thin orchestration shell — composes the
  centred `MatchScoreboard` + the `MatchPanelsStack`. Returns `null` until
  `match.init` has arrived so first-paint doesn't ship empty scaffolding.
  The old top-left scoreboard, top-right scorers ticker, bottom-left
  stats table, bottom-right subs ticker, and bottom-drawer mobile tabs
  are all gone.
- **`DebugPanel`** is now hidden by default. A small `i` corner pill in
  the bottom-right opens it; pressing `~` (or the legacy `D` key, but
  not when typing in an input) also toggles it. Panel itself disappears
  when closed.
- **`MatchScene`** wraps the camera-angle row + timeline scrubber in a
  single `.match-bottom-dock` container centred at the bottom of the
  canvas, so the cam-angle controls are visible above the scrubber
  instead of being hidden behind it.
- **`ReplayHUD`** score chip moves under the centred scoreboard during
  replays AND is hidden via CSS when not in replay mode (it was
  duplicating the centred score during normal play).
- **`OddsHUD`** moves to the upper-left and is hidden on mobile so it
  doesn't fight either the scoreboard or the new right-edge stack.

### CSS

`apps/web/app/globals.css`: roughly 350 lines of HUD CSS rewritten with
the molecule polish bar — dark navy `#0a0e1a` / `#101626` backgrounds,
`#cdd5e7` body text, `#f5c542` gold accents on focused / active state,
backdrop-filter blur on every glassy surface, `cubic-bezier(0.4,0,0.2,1)`
transitions, full `prefers-reduced-motion` honoring.

New rule blocks (in order):
- `.match-scoreboard` + `.msb-*` (centred top scoreboard)
- `.match-hud-stack` + `.hud-card-*` (right-edge collapsible cards)
- `.msh-scorers-list`, `.msh-stats-table`, `.msh-subs-list`
- `.msh-goal-burst` (kept, refined; restyled with gold gradient)
- `.match-bottom-dock`, `.camera-angle-row`, `.cam-pill`
- `.debug-pill`, `.debug-panel` (compact)

Mobile (≤ 640px): scoreboard scales to 92%, the right-edge stack moves
to a horizontal bottom band above the dock so the canvas keeps the full
upper viewport, cam-pill labels collapse to icons.

### Tests

New tests:
- `__tests__/CollapsibleHUDCard.test.tsx` — collapse/expand toggle,
  localStorage persistence under the namespaced key, restore on mount.
- `__tests__/CameraAngleToggle.test.tsx` — four expected `data-cam`
  values, active state honours selected mode, onChange wiring.
- `__tests__/match-scene-hud-wiring.test.ts` — MatchScene source
  inspection (R3F won't mount in jsdom): confirms MatchStatsHUD,
  CameraAngleToggle, `.match-bottom-dock`, DebugPanel are all wired in;
  the legacy `.camera-toggle` cluster is gone.
- `__tests__/team-flag.test.ts` — ISO-2 + FIFA code conversion.

Updated tests:
- `__tests__/MatchStatsHUD.test.tsx` — points at the new
  `match-scoreboard` / `msb-*` test ids; expands cards before
  asserting on body contents; replaces the gone mobile-tabs
  assertions with the new card-shell + empty-state tests.

All 66 test files / 653 tests pass.

## Camera-toggle root cause

The brief asked for diagnosis. The CSS at `globals.css:275` positioned
`.camera-toggle { position: absolute; bottom: 18px; right: 18px }` while
`.timeline-scrubber { position: absolute; bottom: 70px; left: 50% }` —
both bottom-pinned but on different axes. The scrubber's `box-shadow` +
`min(880px, 92vw)` width was wide enough to *visually* cover the
right-corner camera cluster at 1440px viewports. Tim said "I can't see
the cam angles anymore, which we used to have" — they were on screen
but lost in the scrubber's halo.

Fix: extract `CameraAngleToggle` and move it into a single
`.match-bottom-dock` container together with the scrubber. The dock is
centred at the bottom edge and `display: flex; flex-direction: column;`,
so the cam-angle row sits *above* the scrubber rather than next to it.

## Design choices made without asking

- **Gold accent on active cam-pill** rather than the legacy blue
  (`#6cabdd`). Matches the molecule view, the marketing palette, and the
  bracket-share PNG. The legacy blue is now used only for "home" team
  highlights (kit primary), to free up gold as the universal accent.
- **Default-collapsed** for all three cards on first visit. The brief
  asked for this. Persist toggles per-card.
- **Mobile drawer dropped.** The old `msh-mobile-tabs` bottom drawer is
  gone — the right-edge collapsible stack works on mobile too (relocated
  to a horizontal band above the cam dock). Saves ~80 lines of `@media`
  CSS and removes the tab/drawer state.
- **DebugPanel toggle includes legacy `D` key** alongside `~`/`/`/`i`
  pill. Several e2e tests press `D` to expose stats; keeping the alias
  avoids breaking those.

## What's deferred to v2

- Real flag *images* (PNG / SVG) instead of emoji. Emoji fall back
  inconsistently across OSes; for a flagship surface we'd want SVGs from
  `country-flag-icons` (already a dep). Not in this PR because the
  emoji form is unambiguously better than the no-flag state we ship
  today, and SVG sourcing needs a sprite-sheet pass.
- Possession bar on the scoreboard top edge (currently only renders
  inside the expanded stats card). Trivial follow-up.
- Per-team accent ribbon along the bottom edge of each scorer card row
  to give a team-coloured strip without the bordering left bar (more
  modern look). Designed but not built — would add ~30 lines of CSS and
  needs a kit-colour pull, easier as a small follow-up.

## Screenshots

- Desktop (1440 × 900): `sessions/screenshots/2026-05-12_match-ui_desktop.png`
- Mobile (375 × 812): `sessions/screenshots/2026-05-12_match-ui_mobile.png`

Both captured via headless Chrome (the Playwright MCP screenshot tool's
5-second font-load wait kept timing out on an actively-rendering Canvas,
so I drove screenshots with a tiny Node + playwright-core script
instead).

## Quality gates

- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/web test` — 66 files / 653 tests pass.
- `pnpm --filter @vtorn/web build` — succeeds, `/match/[id]` route
  bundle at 250 B / 390 kB First Load JS (unchanged from main).

## Files touched

```
 apps/web/app/globals.css                   ( ~350 lines rewritten )
 apps/web/components/CameraAngleToggle.tsx  ( new )
 apps/web/components/CollapsibleHUDCard.tsx ( new )
 apps/web/components/DebugPanel.tsx         ( rewritten )
 apps/web/components/MatchPanelsStack.tsx   ( new )
 apps/web/components/MatchScene.tsx         ( cam-toggle extraction )
 apps/web/components/MatchScoreboard.tsx    ( new )
 apps/web/components/MatchStatsHUD.tsx      ( now thin orchestrator )
 apps/web/lib/team-flag.ts                  ( new )
 apps/web/__tests__/CameraAngleToggle.test.tsx   ( new )
 apps/web/__tests__/CollapsibleHUDCard.test.tsx  ( new )
 apps/web/__tests__/MatchStatsHUD.test.tsx       ( updated )
 apps/web/__tests__/match-scene-hud-wiring.test.ts ( new )
 apps/web/__tests__/team-flag.test.ts            ( new )
```

## Next steps for Tim

Open the PR, review the two screenshots, and merge when happy. CI will
be red because the GitHub Actions billing account is failing (same as
PRs #127, #129, #130, #131 — Tim merges those via `--admin --squash`).
