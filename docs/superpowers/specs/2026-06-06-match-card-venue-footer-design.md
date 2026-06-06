# Match card venue/time footer + extended match overlay — design

**Date:** 2026-06-06
**Author:** Tim (via brainstorming session)
**Touches:** `apps/web/components/bracket/MatchPredictionRow.tsx`, `apps/web/components/overlay/MatchOverlay.tsx`, `apps/web/components/overlay/overlay.css`, `apps/web/app/world-cup-2026/bracket.css`, `apps/web/app/match/[id]/preview/_lib/match-data.ts`. New files: `apps/web/components/bracket/MatchVenueFooter.tsx`, `apps/web/lib/host-cities.ts`.

## Why

The "ADD SCORE" toggle at the foot of every match row is not used during the FIFA World Cup 2026 prediction game (predictions are W/D/L only, scores are decorative for now). The space is more valuable showing the user *when* the match kicks off in their own timezone and *where* it's played, with a tap into more detail.

The existing top-right `⋯` link on each row opens a `MatchOverlay` bottom sheet, but is too small to tap on mobile and is easily missed. Replacing the score toggle with a full-bleed lozenge that opens the same overlay gives one clear, accessible affordance per row.

## Scope

In scope:

- Remove the "Add score / Hide scores" toggle and score inputs from `MatchPredictionRow`.
- Remove the top-right `⋯` link from `MatchPredictionRow` (now redundant).
- Add a new `MatchVenueFooter` component as the row's bottom element: a neutral charcoal lozenge showing date + user-local time + TZ abbreviation + gold info icon, full-width tappable, opening the existing `MatchOverlay`.
- Extend `MatchOverlay` with: a stage / matchday chip, a "When" block (user-local time + venue-local time + full date), a "Where" block (city, country, country flag, real stadium name, FIFA tournament name, capacity). Fix the existing `formatKickoff` bug that hard-codes `en-NZ` + UTC.
- New `apps/web/lib/host-cities.ts` lookup module over the existing `data/fifa-wc-2026/host-cities.json`.
- Plumb `hostCityId` from canonical fixtures through `resolveMatch()` and as a new prop on `MatchPredictionRow`.

Out of scope (parked for `IDEAS.md` if needed):

- Removing `homeScore` / `awayScore` from the `MatchPrediction` spec — cross-package, useless now, future tournaments may want it back.
- A "Related matches" tab in the overlay (FIFA reference has one).
- A map pin / coords visualisation.
- Internationalising the overlay caption strings ("your time", "local kickoff") — existing overlay copy isn't i18n'd; out of scope for this PR.

## Data available

Already in the repo:

- `data/fifa-wc-2026/fixtures.json` — every fixture has `host_city_id`, `kickoff_utc`.
- `data/fifa-wc-2026/host-cities.json` — for each `host_city_id`: `city`, `country` (ISO-2), `stadium` (real name), `stadium_tournament_name` (FIFA-imposed name), `capacity`, `timezone` (IANA), `coords`.
- `packages/bracket-engine/data/fifa-wc-2026-fixtures.json` — the engine's view of fixtures, currently carries `venue` as the stadium name string (not the city id).
- `apps/web/app/match/[id]/preview/_lib/match-data.ts` — exports `resolveMatch()` returning a `ResolvedMatch`. Already includes `kickoffUtc` and `venue` (stadium name string). Will be extended with `hostCityId`.

## Architecture decision

Approach **A** (chosen, see brainstorming dialog): direct prop + small lookup module.

- New prop `hostCityId?: string` on `MatchPredictionRow`, mirroring how `kickoffIso` is already plumbed from `GroupCard` / `KnockoutMatch`.
- New `apps/web/lib/host-cities.ts` exposes a synchronous `hostCityById(id)` lookup.
- `MatchVenueFooter` and `MatchOverlay` both read host-city data through the same helper.
- Time formatting handled inline via `Intl.DateTimeFormat`; no new date library.

Approaches B (`MatchFixtureProvider` context) and C (resolve host-city from `matchId` inside the row) were considered and rejected — B adds a new abstraction with one consumer, C couples the bracket row to canonical FIFA-2026 data and breaks the row's "pure controlled component" contract.

## Footer (row-level lozenge)

### Layout

```
┌────────────────────────────────────────────────┐
│      Sat 13 Jun · 11:00 AM (NZT)          ⓘ    │
└────────────────────────────────────────────────┘
```

- Single line, centred, full-width tap target inside the row.
- Date + middle-dot + time + small TZ abbreviation in parens + gold info icon at the right end.
- No "Tap for details" text — the icon plus tap-feedback covers it.

### Styling

Matches the visual vocabulary of the unselected DRAW pill (`.mpr-pick-draw-pill`) and the team chips in the predicted-standings panel.

- `border-radius: 999px`
- `background: #1c1c22`
- `border: 1px solid rgba(82, 82, 92, 0.55)`
- Inner padding `8px 16px`. Min-height `36px` desktop, `40px` mobile (gives a ~44px tap target with border).
- Centred horizontally, ~80% of row width up to `420px` max.

Typography:

- Date + time: 12px, colour `#cbd5e1`, `font-variant-numeric: tabular-nums`.
- TZ abbreviation: 11px, colour `rgba(148, 163, 184, 0.75)`.
- Middle-dot separator with 8px margins.

Info icon:

- 14×14 inline SVG, `i` glyph inside a circle.
- Fill `var(--vt-gold-400, #dca94b)` at rest; `--vt-gold-300` on hover/focus.
- Small `0 0 6px rgba(220, 169, 75, 0.35)` drop-shadow.
- `aria-hidden="true"` — the button's accessible name carries the meaning.

States:

- Hover: border `rgba(220, 169, 75, 0.45)`, background `#22222a`, cursor pointer.
- Focus-visible: 2px gold ring `box-shadow: 0 0 0 2px var(--vt-gold-400)`.
- Active: `transform: scale(0.99)`.
- Match started / locked: lozenge stays interactive (viewing details is always allowed after kickoff).

### Behaviour

- Single `<button type="button">` element wrapping the whole lozenge.
- Accessible name: `"View match details for {homeName} vs {awayName}, kicks off {dateLabel}, {timeLabel} {tzAbbr}"`.
- Element: always an `<a href="/match/${matchId}/preview">` styled as a button, mirroring the same pattern the removed `.mpr-view-link` used. When `useOptionalOverlay()` returns a router, `onClick` calls `e.preventDefault()` and then `overlay.open("match", { id: matchId })`. When it doesn't (tests, pages outside the bracket shell), the link navigates normally. This gives us a single DOM element that behaves correctly in both contexts and degrades to a real link without JS.

### SSR / hydration

The component formats date/time once with the venue timezone (`hostCity.timezone`, e.g. `America/Mexico_City`) and the venue locale fallback (`en-US`). On the client, a `useEffect` reads `Intl.DateTimeFormat().resolvedOptions().timeZone` and re-renders with the user's TZ. The markup structure is identical pre/post hydration; only the formatted text changes. React tolerates this without a hydration warning.

When `hostCity` is missing (defensive — never happens for FIFA 2026), the SSR fallback uses `UTC` and renders `UTC` as the abbreviation.

### Props

```ts
interface MatchVenueFooterProps {
  readonly matchId: string;
  readonly homeName: string;
  readonly awayName: string;
  readonly kickoffIso: string;
  readonly hostCity?: HostCity;
}
```

## Row changes (`MatchPredictionRow.tsx`)

- Remove the entire `mpr-scores-wrap` block (lines ~347–387 in the current file): the "Add score / Hide scores" toggle, the two score `<input type="number">` elements, the `showScores` state, the `setScore` helper.
- Remove the top-right `<a className="mpr-view-link">` (lines ~252–263) and its overlay-router call.
- Add the new `<MatchVenueFooter>` element in the same `grid-area: scores` cell (renamed to `grid-area: venue` in CSS for clarity).
- Add a new optional prop `hostCity?: HostCity` (parent supplies the lookup result so the row stays pure / controlled). `GroupCard` and `KnockoutMatch` both gain a one-line lookup: `const hostCity = hostCityById(f.host_city_id);`.

`MatchPickPopup` continues to work — its trigger was the `⋯` link; now both that link's behaviour and the score-toggle row are replaced by the lozenge, which routes through the overlay. The popup itself isn't deleted.

CSS rename: `.mpr-scores-wrap`, `.mpr-scores-toggle`, `.mpr-scores` → removed. New `.mpr-venue-footer` rule set in `apps/web/app/world-cup-2026/bracket.css` covering the lozenge styles above.

## Overlay extension (`MatchOverlay.tsx`)

### New layout

```
┌──────────────────────────────────────────────────────┐
│  [chip] Group A · Match 1                            │
│                                                       │
│         🇲🇽 MEX            VS            🇿🇦 RSA       │
│         Mexico                            South Africa │
│                                                       │
│  ────────────────────────────────────────────────    │
│                                                       │
│  Sat 13 Jun 2026                                     │
│  11:00 AM NZT  ←  your time                          │
│  4:00 PM CDT   ←  local kickoff                      │
│                                                       │
│  ────────────────────────────────────────────────    │
│                                                       │
│  🇲🇽  Mexico City, Mexico                             │
│  Estadio Azteca                                       │
│  Officially "Estadio Banorte" · 87,523 seats         │
└──────────────────────────────────────────────────────┘
```

### Blocks

**Stage chip.** Replaces the bare `<span>` at the top. Small lozenge: `background: rgba(220, 169, 75, 0.08)`, `border: 1px solid rgba(220, 169, 75, 0.4)`, gold text. Content: `"{stageLabel} · Match {matchNo}"` (e.g. `Group A · Match 1`, `Round of 32 · Match 73`).

**Team row.** Unchanged. Existing `SideCard` with `TeamFlag` size `lg`, name + code, tappable into the team overlay via `overlay.replace("team", { code })`.

**When block.** Replaces the current single-line `<time>` element.

- **Date line**: `Sat 13 Jun 2026`, via `Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })`.
- **Primary kickoff (user-local)**: large (22px, weight 600). Format: `Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })`. Caption below in muted grey: `your time`. The TZ abbreviation is whatever `Intl` resolves to for the runtime locale — typically a 3–4 letter code (`NZST`, `CDT`, `BST`) but occasionally a GMT-offset string (`GMT+12`). We accept either; the goal is "what does the user's system call this zone", not a hand-curated label.
- **Secondary kickoff (venue-local)**: normal size (14px). Same format options but `timeZone: hostCity.timezone`. Caption: `local kickoff`.
- If user TZ resolves to the same IANA name as `hostCity.timezone`, collapse to a single line (no `your time` / `local kickoff` split — show `kickoff` as the caption).
- SSR fallback: both lines render in venue TZ. The user-local line swaps after hydration via `useEffect`. Structure is identical pre/post hydration.

**Where block.** Replaces the current single-line venue span.

- **City + country line**: country flag emoji (derived from `hostCity.country` ISO-2 → regional indicator characters via `String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65)`) + `{city}, {countryName}`. `countryName` is resolved via `new Intl.DisplayNames(undefined, { type: "region" }).of(hostCity.country)`, which returns the user-locale name (e.g. `Mexico`, `Estados Unidos`). Muted secondary colour.
- **Stadium real name line**: `{hostCity.stadium}`, 16px, weight 600.
- **Tournament name + capacity line**: `Officially "{stadium_tournament_name}" · {capacity formatted} seats`. If the two stadium names happen to be equal, drop the "Officially …" prefix and just show `{capacity formatted} seats`. Capacity formatted via `Intl.NumberFormat(undefined).format(capacity)`.

### Missing-data fallbacks

- No `hostCity` (host-city lookup miss): render When block in UTC, omit the Where block entirely.
- No `kickoffUtc`: omit the When block. Defensive; every FIFA 2026 fixture has one.
- TBD teams (knockouts pre-resolution): side-cards continue to render TBD. When/Where unaffected.

### `formatKickoff` bug fix

The existing helper hard-codes `en-NZ` locale and `UTC` timezone but labels the output as if it's user-local. Remove the helper and inline `Intl.DateTimeFormat(undefined, {...})` calls in the new When block — these use the runtime-resolved user locale + timezone. The venue line uses `timeZone: hostCity.timezone` explicitly.

## Data plumbing

### `apps/web/lib/host-cities.ts` (new)

```ts
import raw from "../../../data/fifa-wc-2026/host-cities.json";

export interface HostCity {
  readonly id: string;
  readonly city: string;
  readonly country: string; // ISO-2
  readonly stadium: string;
  readonly stadium_tournament_name: string;
  readonly capacity: number;
  readonly timezone: string; // IANA
  readonly coords: readonly [number, number];
}

const ALL = (raw as { host_cities: HostCity[] }).host_cities;
const BY_ID = new Map<string, HostCity>(ALL.map((c) => [c.id, c]));

export function hostCityById(id: string): HostCity | undefined {
  return BY_ID.get(id);
}

export function allHostCities(): readonly HostCity[] {
  return ALL;
}
```

### `ResolvedMatch` extension

Add `readonly hostCityId?: string;`. Populate it in both `resolveGroupFixture` and `resolveKnockoutFixture` via:

```ts
const cf = canonicalFixtureByMatchNumber(f.match_no);
return {
  ...,
  hostCityId: cf?.host_city_id,
};
```

`canonicalFixtureByMatchNumber` already exists in `match-data.ts`.

### `MatchPredictionRow` prop additions

```ts
readonly hostCity?: HostCity;
```

`GroupCard` and `KnockoutMatch` resolve and pass it:

```ts
const hostCity = f.host_city_id ? hostCityById(f.host_city_id) : undefined;
<MatchPredictionRow ... hostCity={hostCity} />
```

This requires `GroupCard` / `KnockoutMatch` to also have access to the fixture's `host_city_id`. The bracket engine's `GroupFixture` carries `venue: string` (stadium name) but not city id today. Two options:

1. **Read the canonical fixture by `match_no` in `GroupCard`** — same pattern as `MatchOverlay` already does. One-liner, no engine change. **Chosen.**
2. Extend the bracket engine's `GroupFixture` / `KnockoutFixture` to carry `host_city_id`. Cleaner long-term but a cross-package spec change that requires orchestrator approval per CLAUDE.md.

We pick (1) and leave (2) as a future cleanup in `IDEAS.md`.

## Testing

### Unit tests

1. **`MatchVenueFooter.test.tsx`** (new)
   - Renders date + venue-local time + venue TZ on first paint.
   - After `useEffect` runs, swaps to user-local time (stub `Intl.DateTimeFormat().resolvedOptions().timeZone`).
   - Renders gold info icon as inline SVG with `aria-hidden="true"`.
   - Accessible name carries match teams + kickoff label.
   - Click fires `overlay.open("match", { id })` when overlay is present; falls back to a same-tab navigation otherwise.
   - With `hostCity` undefined: renders UTC + `UTC` abbreviation, still tappable.
   - At a mobile viewport, computed `min-height` ≥ 44px (touch target).

2. **`MatchOverlay.test.tsx`** (extend or add)
   - Stage chip text for group + knockout fixtures.
   - When block: two timezones with the expected captions; collapses to one line when user TZ equals venue TZ.
   - Where block: city, country flag emoji, country name, real stadium name, FIFA tournament name in quotes, formatted capacity.
   - Missing `hostCity`: Where block hidden, When block falls back to UTC.
   - TBD teams: side-cards show TBD; When/Where unaffected.

3. **`MatchPredictionRow.test.tsx`** (extend)
   - No "Add score" / "Hide scores" text. No `<input type="number">` for scores.
   - No `.mpr-view-link` rendered.
   - Renders a `MatchVenueFooter` at the bottom.
   - Existing keyboard handling (1/H/D/A/arrows) still works.

4. **`host-cities.test.ts`** (new)
   - `hostCityById("mexico_city")` returns expected record.
   - `hostCityById("nope")` returns `undefined`.

5. **`match-data.test.ts`** (extend if present)
   - `resolveMatch` populates `hostCityId` from canonical fixtures for group + knockout matches.

### Visual smoke (Playwright, only if existing e2e suite covers the bracket)

- Open `/world-cup-2026`. First group auto-expands. First row shows a single neutral lozenge containing date + time + TZ + gold info icon.
- Tap lozenge → `MatchOverlay` opens with stage chip, both flags, When block with two times, Where block with stadium and capacity.
- Tap lozenge from a knockout match → same overlay opens with `Round of N` chip.

### Manual verification before sign-off

- `pnpm --filter @vtorn/web lint && pnpm --filter @vtorn/web typecheck && pnpm --filter @vtorn/web test`
- `pnpm --filter @vtorn/web dev`, visit `http://localhost:3300/world-cup-2026`, confirm a row's lozenge shows NZT (dev box is in NZ) and the overlay shows both NZT + venue-local times.
- `grep -rn "Add score\|mpr-scores-toggle\|mpr-view-link" apps/web/` returns nothing.

## File touch summary

| File | Change |
|---|---|
| `apps/web/components/bracket/MatchPredictionRow.tsx` | Remove score toggle/inputs + `⋯` link. Render `<MatchVenueFooter>`. New `hostCity` prop. |
| `apps/web/components/bracket/MatchVenueFooter.tsx` | New file. The lozenge component. |
| `apps/web/components/bracket/GroupCard.tsx` | One-line host-city lookup, pass to row. |
| `apps/web/components/bracket/KnockoutMatch.tsx` | Same. |
| `apps/web/components/overlay/MatchOverlay.tsx` | Stage chip, When block, Where block. Drop `formatKickoff`. |
| `apps/web/components/overlay/overlay.css` | Add `.vt-match-overlay-when`, `.vt-match-overlay-where`, `.vt-match-overlay-stage-chip` rules. |
| `apps/web/app/world-cup-2026/bracket.css` | Remove `.mpr-scores-*`. Add `.mpr-venue-footer` + states. Rename grid area `scores` → `venue`. |
| `apps/web/app/match/[id]/preview/_lib/match-data.ts` | Add `hostCityId` to `ResolvedMatch`; populate in both resolvers. |
| `apps/web/lib/host-cities.ts` | New file. `HostCity` type, `hostCityById`, `allHostCities`. |
| `apps/web/__tests__/MatchVenueFooter.test.tsx` | New. |
| `apps/web/__tests__/MatchOverlay.test.tsx` | New or extended. |
| `apps/web/__tests__/MatchPredictionRow.test.tsx` | Extended. |
| `apps/web/__tests__/host-cities.test.ts` | New. |
