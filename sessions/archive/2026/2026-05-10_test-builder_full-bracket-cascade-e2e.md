# 2026-05-10 — full bracket cascade e2e (test-only)

**Status**: complete — test runs end-to-end, fails loudly on the bugs it
finds (per the orchestrator brief).

**Branch**: `test/bracket-cascade-e2e`
**Scope**: tests only. No application code changed.

## Plan

Tim wants overnight proof that the bracket builder lets a user predict
every match — group stage through the Final — and that every cascade
step populates downstream slots correctly.

Built a Playwright e2e that:

1. Hits `https://2026wc.vtourn.com/world-cup-2026` (override via
   `PLAYWRIGHT_BASE_URL`).
2. Clears localStorage, picks home-win on every group match, then
   home-side on every knockout from R32 → Final + the third-place
   playoff.
3. Verifies after each round that the next round has no `Winner xxx`
   placeholders — the cascade actually resolves real teams.
4. Asserts both tab counters read `72/72` and `32/32`, and that the
   draft persisted to localStorage holds 104 picks (72 group + 32
   knockout).
5. Hard-reloads and re-verifies persistence.
6. Saves 10 named screenshots under `apps/web/test-fixtures/visual/cascade/`.

## Key design decisions

- **Live deployment, not local dev.** Spec said "live deployed
  environment". Default base URL is `https://2026wc.vtourn.com`; CI can
  override with `PLAYWRIGHT_BASE_URL`. Playwright's webServer hook
  stays off (no autostart) when `VTORN_AUTOSTART_DEV` is unset.
- **Helper module**: `__tests__/e2e/_helpers/bracket-driver.ts` —
  `pickAllGroupMatches`, `pickAllKnockoutsForRound`,
  `assertNoPlaceholders`, `getPickCounts`,
  `clearBracketLocalStorage`. Pure thin wrappers; no assertions inside,
  so the spec is the single source of truth for what's being proved.
- **Stage mapping**: the bracket-engine encodes the third-place playoff
  as a `sf` stage match with id `tp_01`; the helper splits "sf"
  (excludes `tp_*`) from "third_place" (only `tp_*`). The R32 stage in
  this engine is 16 matches (32 teams), not 32 — the brief's "R32: 32
  matches" was interpreted as "the R32 round, all 16 cards".
- **Soft expectations** for surfaces the brief describes that the
  current UI does not implement (predicted winner panel, multiplier
  table, "Back your boldest pick" CTA). Soft fails surface the bug to
  the orchestrator without aborting the rest of the run; persistence
  checks downstream still execute and pass.
- **Skip on pixel-7**: cascade flow is identical across viewports.
  Skipping the mobile project halves the runtime and avoids
  duplicating screenshots.

## Test result

`PLAYWRIGHT_BASE_URL=https://2026wc.vtourn.com pnpm exec playwright test
__tests__/e2e/full-bracket-cascade.e2e.spec.ts --reporter=list`

```
1 failed   [desktop-chromium] full-bracket-cascade.e2e.spec.ts
1 skipped  [pixel-7]          (skipped by design)
```

The single hard "failure" is the *aggregate* of three soft expectations,
each documenting a missing UI surface (see Bugs).

Critical-path assertions that PASSED:

- 0/72 → 72/72 group counter
- 0/32 → 32/32 knockout counter
- R32 → R16 cascade (no placeholders in R16)
- R16 → QF cascade
- QF → SF cascade
- SF → Final cascade (real teams in both Final slots)
- SF → third-place cascade (real teams in `tp_01`)
- Final card has the picked side marked `.is-winner`
- localStorage holds 72 group + 32 knockout = 104 predictions
- After a hard reload, the counters and the localStorage payload still
  hold 104 predictions

## Bugs found

1. **`LockSummary` reports "64 of 64 picks committed" — should be 104.**
   The component computes `cascaded.committed_teams.length +
   knockoutsWithPredictedWinner.length`. `committed_teams` is a Set of
   *team-ids* that the user committed to (top-2 of 12 groups + 8
   third-placers + 32 knockout winners), so duplicates collapse and
   group fixtures aren't counted. The lock-summary display is
   conflating "teams committed to" with "match picks made". The inline
   counts inside `.bracket-lock-counts` (`72 / 72 group matches`, `32 /
   32 knockout picks`) are correct.
   - Repro: pick all 72 group + 32 knockout matches, switch to Lock +
     share. Top-line reads `Locked-in: 64 of 64 picks committed` —
     should read `104 of 104 match picks made` (or similar).
   - Suggested fix: in `apps/web/components/bracket/LockSummary.tsx`,
     change the headline to use `Object.keys(matchPredictions).length +
     Object.keys(knockoutPredictions).length` (passed in alongside
     `cascaded`) — or relabel so it reads "teams locked in" so the
     existing maths matches the words.

2. **No "Predicted tournament winner" panel.**
   The brief required the Lock + share tab to show the predicted winner
   (the team that wins the Final per the cascade). The cascade exposes
   it as `cascaded.knockouts.find(k => k.id === 'final').predicted_winner`,
   but the UI never surfaces it.
   - Repro: pick the full bracket, open Lock + share. No winner team is
     displayed.
   - Suggested fix: add a "Your predicted champion: {team}" line to
     `LockSummary`, or a new `PredictedChampionCard` component above
     the counts grid.

3. **No lock-multiplier table.**
   The brief required the Lock + share tab to show the lock multiplier
   table (early picks earn higher multipliers). Not present.
   - Repro: open Lock + share — no table, no multiplier copy.
   - Suggested fix: pull the multiplier curve from
     `@vtorn/bracket-engine` (it lives in `score.ts`) and render it
     under the counts grid.

4. **No "Back your boldest pick" CTA (or "view market" fallback).**
   The brief required this CTA to be present in the lock panel. Not
   present.
   - Repro: open Lock + share — only "Save draft" / "Lock final"
     buttons exist.
   - Suggested fix: add an anchor styled as a CTA, deep-linking to the
     Polymarket market for the predicted champion (NZ region falls back
     to `view market` text per Tim's brief).

## Screenshots

Saved to `apps/web/test-fixtures/visual/cascade/`:

- `01-empty-groups.png` — fresh bracket, 0/72.
- `02-groups-72-72.png` — every group match picked.
- `03-knockouts-tab-empty.png` — knockouts tab right after group fill;
  R32 slots already populated by the cascade.
- `04-r32-picked.png` — R16 column populated with real teams.
- `05-r16-picked.png` — QF column populated.
- `06-qf-picked.png` — SF column populated.
- `07-sf-picked.png` — Final and third-place slots populated.
- `08-final-picked.png` — Final pick committed (`.is-winner` on home).
- `09-lock-summary.png` — Lock + share panel (shows the missing UI).
- `10-after-reload-persisted.png` — Group tab after a hard reload.

## Next steps (for the orchestrator, follow-up PRs)

1. Fix the LockSummary "64 of 64" headline (Bug 1). Add a unit test in
   `apps/web/__tests__/lock-summary.test.tsx` that asserts the headline
   number matches `matchPredictions.length + knockoutPredictions.length`
   for a fully-picked bracket.
2. Add the predicted-champion + multiplier table + CTA UI (Bugs 2–4).
   Once shipped, flip the soft expectations in
   `full-bracket-cascade.e2e.spec.ts` from `expect.soft` to `expect`.
3. Wire this spec into CI once the deployed env is stable enough to
   gate on (it currently runs against the live site, so transient
   prod-side blips would fail CI).

Refs: docs not changed. Brief: orchestrator message "End-to-end Playwright
test that programmatically completes a full World Cup 2026 bracket".
