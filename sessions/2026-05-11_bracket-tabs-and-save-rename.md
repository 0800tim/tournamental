# 2026-05-11 — bracket tabs by round + Lock → Save rename

Branch: `feat/bracket-tabs-and-save-rename`
Worktree: `projects/vtorn-bracket-tabs`
Agent: builder (parallel with `feat/share-card-and-viral-loop`)
Status: done — ready for PR

## Plan

Two deliverables per Tim's spec.

### A — Bracket tabs by round

The existing `/world-cup-2026` page has three tabs: `Group stage`, `Knockouts`, `Lock + share`. The "Knockouts" tab is a single long column of every round, which is unusable on mobile.

Restructure into six tabs by round:

1. **Groups** — group stage matches grouped by group A–L (existing per-group cards, vertical stack)
2. **R32** — Round of 32 cards in CSS grid
3. **R16** — Round of 16 cards in CSS grid
4. **QF** — Quarter-finals
5. **SF + 3rd** — Semi-finals + 3rd-place playoff
6. **Final** — the Final match

Tab state is URL-hash-routable: `/world-cup-2026#groups`, `#r32`, `#r16`, `#qf`, `#sf`, `#final`.
Lock-summary content moves to a sticky/inline summary above the tab bar so it's always visible (or a 7th "Summary" tab — TBD as I build).

CSS grid per tab: 1/2/3 columns by viewport (mobile/tablet/desktop). Header per tab: title + progress counter + auto-pick CTA. Sticky tab bar.

Mobile: tab bar horizontally scrollable, floating "Save & Share" button at bottom. Share button is a TODO stub since the sibling agent owns `apps/web/components/share/`.

Reuse existing `KnockoutMatch` and per-group `GroupCard` components — minimal surgery; the change is structural in `BracketBuilder.tsx`.

### B — Lock → Save rename

Audit grep:

```
apps/web/app/world-cup-2026/landing/_components/HowItWorks.tsx
apps/web/app/match/[id]/preview/_components/PredictTab.tsx
apps/web/app/world-cup-2026/share/[bracketId]/page.tsx
apps/web/app/world-cup-2026/page.tsx
apps/web/app/world-cup-2026/landing/page.tsx
apps/web/components/bracket/LockSummary.tsx
apps/web/app/world-cup-2026/landing/_components/UpcomingMatches.tsx
apps/web/app/api/og/bracket/route.ts
apps/web/components/overlay/OverlayProvider.tsx
apps/web/components/bracket/BracketTree.tsx
apps/web/components/bracket/MatchPredictionRow.tsx
apps/web/components/match-pick/useMatchPick.ts
apps/web/components/bracket/BracketBuilder.tsx
apps/web/__tests__/kickoff-lockout.test.tsx
apps/web/components/match-pick/MatchPickPopup.tsx
apps/web/lib/bracket/history.ts
apps/web/__tests__/match-pick-popup.test.tsx
apps/web/__tests__/autopick-cascade.test.tsx
apps/web/__tests__/PillTabs.test.tsx
apps/web/__tests__/e2e/full-bracket-cascade.e2e.spec.ts
apps/web/__tests__/e2e/per-match-prediction.e2e.spec.ts
apps/web/__tests__/per-match-prediction.test.tsx
```

What stays as "Lock"/"lock":
- `lockedAt` field on MatchPrediction / Bracket (internal — used by scoring)
- `kickoff_lockout` deadline name + 409 `match_already_started` error code
- `oddsAtLock` field, `appendHistory({ type: ... ts: lockedAt })` payload internals
- `lockMultiplier()` function, `lockedKeys` in `BracketTree` props (rename to `savedKeys`? — yes, internal prop renames are fine; do these if cheap)
- Function/component names like `LockSummary` — keep, but the user-visible h4 etc. become "Save / Share" copy

User-visible rewrites (case-by-case):
- "Lock pick" → "Save pick"
- "Lock + share" → "Save & Share"
- "Lock final" → "Save bracket"
- "Lock in your prediction" → "Save your pick"
- "Lock it in" (button text) → "Save pick"
- "Picks locked" → "Picks saved"
- "Lock the bracket before kickoff for max points." → "Save your bracket before each match's kickoff. Earlier saves earn more."
- "0 picks locked. Be first." → "0 picks saved. Be first."
- "Picks locked, last 24h" → "Picks saved, last 24h"
- "Lock your bracket before kickoff. Long-shots locked early earn the most." → "Save your bracket. You can change any pick until that match kicks off."
- "Locked-in odds" label → "Saved odds"
- "locked {time}" status text → "saved {time}"
- "Top lock multipliers" → "Top early-save multipliers"
- ARIA: "Lock pick at current odds" → "Save pick"
- modal copy in autopick: "auto-pick is a starting point, not a lock" → "auto-pick is a starting point — you can change any pick afterwards"

Tests for the rename: add `apps/web/__tests__/save-not-lock-copy.test.tsx` that scans the component tree of `BracketBuilder` for any rendered text containing "Lock" / "lock" with a verb sense (allowlist "lockedAt" etc. via plain regex over rendered output — there's no rendered text with that token so the test is purely a positive grep).

Test files: update assertions where they check user-visible "Lock"-related copy. PillTabs.test.tsx hard-codes "Lock and share" — update to "Save & Share".

### Docs

- Update `docs/12-odds-and-predictions.md`, `docs/16-game-modes-and-scoring.md`, `docs/45-per-match-pick-popup-and-api.md` (best-effort — flag the renames + note internal field names).
- Add `docs/note-on-save-not-lock.md` explaining the rationale.

## Decisions

- Tab labels use the short forms (`Groups`, `R32`, `R16`, `QF`, `SF + 3rd`, `Final`) to keep mobile width budget small.
- Hash routing uses plain `window.location.hash` + a `hashchange` listener — no Next router. SSR-safe: the initial render defaults to `groups`; on mount we read the hash. (Matches the SSR pattern already used in `BracketBuilder` for `userLocalId`.)
- Floating "Save & Share" mobile CTA: Save persists the current draft (calls `saveDraft()`); Share renders a TODO placeholder text/button (`alert("share modal pending")` or noop) — wired by the sibling agent later. The button exists so layout/CSS lands now and avoids a second mobile-CSS PR.
- Sticky tab bar uses `position: sticky; top: 0` inside the bracket builder. AppShell's app-bar already pushes content; verify it doesn't double-stick.
- Lock-summary block was previously inside the "Lock + share" tab. Move into the `Final` tab (since that's the natural place for "this is your finished bracket — save and share") and into a small floating summary card above the tab bar on every other tab (just `committed / totalPicks` + countdown).

## Open questions

- Should `BracketTree` (the SVG knockout tree used elsewhere) be replaced by the per-round tabs view too? Spec says "Today the bracket page renders all matches in one long scroll. Restructure into a tabbed view" — focus is on the main `/world-cup-2026` page, not BracketTree which is an alternate visual. Leaving `BracketTree` alone for now; renaming its internal `lockedKeys` prop to `savedKeys` for consistency.
- The "Auto-pick" button: spec mentions an `auto-pick or "fill remaining" CTA + progress indicator` per tab. I'll surface a small "Auto-pick this round" sub-action where it makes sense; if scope balloons I'll leave the global Auto-pick alone.

## Outcome

Shipped both deliverables in one branch.

### A — Bracket tabs by round

`apps/web/components/bracket/BracketBuilder.tsx` rebuilt from 3 → 6 tabs:
`Groups | R32 | R16 | QF | SF + 3rd | Final`. Hash-routable via plain
`window.location.hash` + `hashchange` listener (no Next router); aliases
`#knockouts` → R32, `#lock` → Final so old deep-links still land sanely.

CSS added at the bottom of `apps/web/app/world-cup-2026/bracket.css`:

- Sticky tab bar with horizontal-scroll-on-overflow for mobile.
- Per-round responsive grid: 1 col / 2 cols at 640px / 3 cols at 1024px.
- Final tab uses single-column centred card up to 480px max-width.
- SF tab splits into "Semi-finals" + "3rd-place play-off" sub-sections.
- Floating "Save / Share" mobile CTA bar, hidden ≥900px (Share button is
  a TODO stub jumping to the Final tab — sibling agent owns the real
  share modal).

Per-tab header reads `<round name> — <picked> of <total> picked`.
Header sub-line shows total `<X> of 104 matches picked` always-on.

`LockSummary` (component name kept; tests + callers reference it) lives
inside the Final tab, side-by-side with the final-match card on desktop.

### B — Lock → Save rename

User-visible "Lock" → "Save" across:

- `apps/web/components/bracket/BracketBuilder.tsx` — Save bracket, Save
  draft locally, Save each pick … kickoff, auto-pick "starting point —
  you can change any pick afterwards".
- `apps/web/components/bracket/LockSummary.tsx` — "picks saved", "Save
  the rest before {deadline}", "Top early-save multipliers", share text
  "Save yours before kickoff →".
- `apps/web/components/bracket/BracketTree.tsx` — aria-label "Save pick
  at current odds" / "Remove save".
- `apps/web/components/match-pick/MatchPickPopup.tsx` — primary button
  "Save pick" (was "Lock it in"); odds-detail copy "Saving now
  snapshots these odds".
- `apps/web/app/match/[id]/preview/_components/PredictTab.tsx` —
  "Saved odds" (was "Locked-in odds"), "saved {time}".
- `apps/web/app/world-cup-2026/page.tsx` metadata (OG + Twitter).
- `apps/web/app/world-cup-2026/landing/page.tsx` — hero copy, "0 picks
  saved. Be first.", "Picks saved, last 24h", "Save your bracket. You
  can change any pick until that match kicks off."
- `apps/web/app/world-cup-2026/landing/_components/HowItWorks.tsx` —
  step 2 "Save early." + "you can still change any pick until that
  match kicks off, but every save resets the multiplier clock".
- `apps/web/app/world-cup-2026/landing/_components/UpcomingMatches.tsx`
  — ICS DESCRIPTION line.
- `apps/web/app/world-cup-2026/share/[bracketId]/page.tsx` — OG
  description "Save yours before kickoff."
- `apps/marketing/src/pages/index.astro`, `how-it-works.astro`,
  `world-cup-2026.astro`, `why.astro` — all user-facing "lock" replaced
  with "save".

What stays as "Lock"/"locked":

- `lockedAt` field on `MatchPrediction` / `Bracket` (scoring input).
- `oddsAtLock` field (snapshot for scoring).
- `lockMultiplier()` function in `@vtorn/bracket-engine`.
- `kickoff_lockout` deadline policy name.
- 409 `match_already_started` error code.
- `LockSummary` component name + `bracket-lock-summary` CSS class +
  every other `bracket-lock-*`, `is-locked`, `mpr-locked-banner`,
  `mp-locked-odds` selector.
- `BracketTreeProps.lockedKeys` + `onToggleLock` (unused live; renaming
  not needed and risks a future-tree-rewrite collision).
- Blog posts in `apps/marketing/src/content/blog/*.mdx` (historical).
- The OG image route at `apps/web/app/api/og/bracket/route.ts` —
  owned by sibling agent feat/share-card-and-viral-loop, not touched.

### Tests

- New `apps/web/__tests__/bracket-tabs.test.tsx` (26 tests):
  - All six tabs render + aria-selected toggling.
  - Each tab shows its slice of matches (R32 → 16, R16 → 8, QF → 4,
    SF+3rd → 3, Final → 1).
  - URL hash drives the active tab; alias hashes route sanely;
    click → replaceState; hashchange → tab updates.
  - Tab change preserves picks.
  - Header running-total reflects picks across all rounds.
  - Mobile Save & Share CTA exists; mobile Save persists draft.
  - Sticky tab bar CSS contract.
  - Auto-pick CTA still works.
  - Save-not-Lock user-visible copy assertions (header, primary CTA,
    secondary CTA, autopick modal text, rendered output Lock-free).
- New `apps/web/__tests__/save-not-lock-codebase-guard.test.ts`
  (5 tests): walks every .tsx/.ts under `apps/web/app` and
  `apps/web/components`, strips internal identifiers, fails if any
  capital-L `Lock` survives.
- Updated existing tests:
  - `__tests__/per-match-prediction.test.tsx` — reset URL hash in
    beforeEach; renamed "knockouts tab" / "lock tab" assertions to
    R32 / Final tabs.
  - `__tests__/bracket-mobile-gestures.test.tsx` — reset URL hash;
    R32 tab instead of "Knockouts".
  - `__tests__/PillTabs.test.tsx` — "Save and share" tab fixture.
  - `__tests__/match-pick-popup.test.tsx` — "Save pick" instead of
    "Lock it in".
  - `__tests__/autopick-cascade.test.tsx`,
    `__tests__/bracket-odds-integration.test.tsx` — URL hash reset.
  - `__tests__/e2e/per-match-prediction.e2e.spec.ts` — Final tab,
    "Save bracket" button.
  - `__tests__/e2e/full-bracket-cascade.e2e.spec.ts` — waitForHydration
    looks at the new tabs; tab navigation in step 3 + step 11.
  - `__tests__/e2e/_helpers/bracket-driver.ts` — `pickAllGroupMatches`
    uses `^Groups` regex; `pickAllKnockoutsForRound` navigates to the
    per-round tab; `getPickCounts` sums across R32+R16+QF+SF+Final.

### Quality gates

- `pnpm --filter @vtorn/web test` → 621 passed (60 files).
- `pnpm --filter @vtorn/web typecheck` → clean.
- `pnpm typecheck` (workspace) → clean.
- `pnpm --filter @vtorn/web build` → 172 static pages prerendered.
- `pnpm --filter @vtorn/web lint` → 0 new warnings (1 pre-existing
  `<img>` warning in `TeamFlag.tsx` is unrelated).

### Docs

- `docs/note-on-save-not-lock.md` — explainer for future agents.
- `docs/12-odds-and-predictions.md` — "Lock rules" section renamed +
  rewritten with header note about technical-vs-user vocabulary.
- `docs/45-per-match-pick-popup-and-api.md` — top-of-file "Save, not
  Lock" callout + PUT endpoint description updated.

## Next steps

- Sibling agent wires the floating mobile "Share" button to the real
  share-card modal once it lands. Today the button no-ops back to the
  Final tab.
- A follow-up could swap the unused `BracketTree.tsx` to use the
  per-round tabs view (currently lives orphan in the bundle), but it's
  not on the critical path.
- The OG image text inside `apps/web/app/api/og/bracket/route.ts`
  still reads "X picks locked. Lock yours before kickoff." — sibling
  agent owns it; flag the rename for their next pass.
