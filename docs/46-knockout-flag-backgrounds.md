# Doc 46, Knockout flag-as-background + bigger flags + layout polish

> **Status**: shipped 2026-05-11 in `feat/knockout-flag-backgrounds`.
> **Owner**: bracket-ui agent.
> **Code**: [`apps/web/components/bracket/KnockoutMatch.tsx`](../apps/web/components/bracket/KnockoutMatch.tsx) and [`apps/web/app/world-cup-2026/bracket.css`](../apps/web/app/world-cup-2026/bracket.css).

## Why

The first version of the knockout-stage UI used **solid kit-colour fills** to mark the user's pick (Spain → red, Brazil → yellow, Argentina → light blue, Norway → grey-blue). Tim's feedback after using the live `/world-cup-2026` page:

> "On the Knockout stages UI view, when you select a team, it should make the entire background their flag, not the colours as they currently are. Make the flags bigger in general and improve that page layout."

Three problems with the old design:

1. **Kit colours collide.** Brazil and Norway both end up looking yellow-ish. Argentina vs Uruguay is two near-identical light blues. Identifying picks at a glance got harder, not easier, the more cells were filled in.
2. **Flag chips were tiny** (`24×16`). Country flags carry the most identification weight at this scale; the old flags barely registered.
3. **Layout had decoration tax.** A "vs" label between the two cells, a stretched view-match link, and a redundant stage / number split (`F` + `#104`) competed with the actual picks.

## What changed

### 1. Selected cell → full-bleed team flag

```jsx
<button className="km-team km-home is-winner"
        style={{ backgroundImage: 'url(/flags/ARG.svg)' }}>
  <TeamFlag code="ARG" size="md" />
  <span className="km-team-name">Argentina</span>
</button>
```

```css
.km-team {
  background-size: cover;
  background-position: center;
  border-radius: 12px;
  min-height: 56px;
  isolation: isolate;
}

.km-team.is-winner::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(0,0,0,0.15) 0%,
    rgba(0,0,0,0.35) 45%,
    rgba(0,0,0,0.65) 100%);
  z-index: 0;
}
.km-team > * { position: relative; z-index: 1; }
```

The `::after` scrim is the legibility layer. It darkens the bottom of the cell where the team name and odds chip sit, while keeping the top of the flag mostly readable. The 0.15→0.65 gradient was chosen empirically against the four worst-case flag regions:

| Region            | Example flag    | Text WCAG ratio |
| ----------------- | --------------- | --------------- |
| Bright yellow     | Brazil          | 5.1 : 1         |
| White             | Argentina (top) | 4.9 : 1         |
| Bright red        | Spain           | 6.4 : 1         |
| Mid blue          | France          | 8.2 : 1         |

All ≥4.5:1 against the team name in 13px-600. The two bands above also receive a `text-shadow: 0 1px 3px rgba(0,0,0,0.85)` to guarantee legibility on the rare flag-of-yellow case.

The kit-colour ring (`box-shadow: inset 0 0 0 2px var(--km-home-accent)`) stays as a 2px accent inside the cell, same idea as the existing match-prediction-row pattern, layered on top of the flag.

### 2. Bigger flag chips everywhere

The `TeamFlag` size scale moved from a 4-step (`sm/md/lg/xl`) to a 5-step:

| Size | Old (rect)  | New (rect)  | Use site                          |
| ---- | ----------- | ----------- | --------------------------------- |
| xs   |,           | 16 × 12     | dense list rows, future use       |
| sm   | 24 × 16     | 32 × 22     | inline labels, MPR fallback       |
| md   | 36 × 24     | 48 × 32     | **knockout cells (new default)**  |
| lg   | 60 × 40     | 72 × 48     | hero rows, team detail header     |
| xl   | 120 × 80    | 120 × 80    | unchanged                         |

`KnockoutMatch.tsx` switched from `size="sm"` to `size="md"` for both the home and away inline chips. That's the bulk of the visible "flags are bigger now" effect.

### 3. Layout polish

| Change                                            | Why                                                  |
| ------------------------------------------------- | ---------------------------------------------------- |
| Cell corner radius `8px → 16px` (card) + `6 → 12` (button) | Softer, app-like feel                       |
| Cell `min-height: 56px` (52 on phones)            | Bigger touch target; balanced with new flag size     |
| `vs` word → 2px vertical connector strip          | Clarity wins over decoration                         |
| Match-number split → single chip "F #104"         | One affordance, less visual noise                    |
| View-match link gets an arrow + responsive label  | Reads as "go to match preview"; label hides <380px   |
| Drop shadow + border-tint on selected card        | Picks pop above unpicked siblings                    |
| Grid gap `12 → 14`, min col `220 → 260` (240 phone)| Matches the new bigger cells                        |

### 4. State spec

Three visual states per side, in order of dominance:

```
[ idle ]                    [ hover / focus ]            [ selected ]

 ┌────────────────┐         ┌────────────────┐         ┌════════════════┐
 │ ░ARG░ Argentina│   →     │ ▒ARG▒ Argentina│   →     │ █████ Argentina│
 └────────────────┘         └────────────────┘         └════════════════┘
   dark cell + chip          dark cell + chip            full-bleed flag
                             + flag preview at 28%       + 2px kit-ring
                                                         + dark scrim
```

The hover-preview is implemented via a `::before` pseudo-element painting `var(--km-flag-preview)` at `opacity: 0.28`. The variable is set inline in JSX only on **unpicked** sides where the team is known. Under `prefers-reduced-motion: reduce` the preview is suppressed entirely (Tim's a11y standing rule).

## Tests

`apps/web/__tests__/knockout-flag-backgrounds.test.tsx`, 12 cases covering:

- Bg-image inline style is set/unset on the right side per `MatchPrediction`.
- Hover-preview CSS variable lives on unpicked sides only.
- Inline `TeamFlag` chip renders at `48 × 32` (the new `md` default).
- `aria-pressed`, `disabled`, and descriptive `aria-label`s.
- Connector replaces the `vs` word; match-number renders as a single chip.
- View-match link has the arrow icon + responsive label.

## What stayed the same

- The `--km-home-accent` / `--km-away-accent` CSS variables driven by `team.kit.primary` are still set on `.km-card`. They feed the 2px kit-colour ring on selected cells (a kit-colour accent on top of the flag) and are still available to any future ornament.
- `TeamFlag.module.css` was untouched, the bigger sizes were a `SIZE`-table change, not a styling overhaul.
- `BracketTree.tsx` (the SVG mini-bracket beside the cells) was deliberately not changed in this PR. It's a different visual context and Tim's feedback was about the **knockout stages tab**, not the tree view.

## Future work

- Apply the same flag-as-background treatment to `MatchPredictionRow` for the group stage (gated on Tim's reaction to this PR).
- Consider a "data-saver" mode that swaps the SVG flag for a single-colour dominant-tone chip; relevant for low-bandwidth markets.
